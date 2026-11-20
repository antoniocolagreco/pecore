import { constants } from "node:fs";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { harnessVersion, listOptions, satisfies } from "@pecore/agents";
import type { ResolvedConnector, Spawn } from "@pecore/agents";
import { BuiltInHarness, ModelAccount, Profiles, TierName } from "@pecore/schemas";
import type { Profile, SetupView } from "@pecore/schemas";
import { spawnFor } from "../accounts/agents";
import type { AgentServices, LoginInfo } from "../accounts/agents";
import { loadGlobal } from "../definitions/load";
import type { Global } from "../definitions/load";
import { appUser, baseEnv, run } from "../runners/process";
import type { RunResult } from "../runners/process";
import { commitDefinition } from "./git-commit";
import { homePaths } from "./layout";

type Harness = SetupView["harnesses"][number];
type Options = NonNullable<Awaited<ReturnType<typeof listOptions>>>;
type ProfileOffer = Record<TierName, { model: string; effort: string | null | undefined }>;
type EffortProbe = Pick<Parameters<typeof listOptions>[0], "connector" | "login" | "spawn" | "allowUnknownIdentity">;
type Finding = { harness: Harness; title: string; account: ModelAccount | undefined; provider: string; offer: ProfileOffer | null };
type SetupFile = keyof Global | "autoSetup";
type File = { before: string | null; value: Record<string, unknown> };
type FileChange = [kind: SetupFile, before: File, value: Record<string, unknown>];
type Changes = { message: string; files: Partial<Record<keyof Global, string>> };
type SetupResult = { harnesses: SetupView["harnesses"]; changes: Changes | null };

async function readOptional(file: string): Promise<string | null> {
  return readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
}

function configModel(text: string): string | null {
  const json: string = text.replace(/"(?:[^"\\]|\\[\s\S])*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g, (token) => token.startsWith('"') ? token : " ")
    .replace(/"(?:[^"\\]|\\[\s\S])*"|,(?=\s*[\]}])/g, (token) => token === "," ? "" : token);
  try {
    const value: { model?: unknown } | null = JSON.parse(json.replace(/^\uFEFF/, ""));
    return typeof value?.model === "string" ? value.model : null;
  } catch {
    return null;
  }
}

export async function openCodeModels(connector: ResolvedConnector, login: LoginInfo): Promise<Options | null> {
  const env: Record<string, string> = await baseEnv(login.osUser);
  const configHome: string = login.osUser === appUser ? (process.env.XDG_CONFIG_HOME || join(login.home, ".config")) : join(login.home, ".config");
  if (login.osUser === appUser && process.env.XDG_CONFIG_HOME) env.XDG_CONFIG_HOME = configHome;
  const result: RunResult = await run({ user: login.osUser, argv: [connector.harnessPath, "models"], env, cwd: "/", timeoutMs: 10_000 });
  if (result.code !== 0 || result.timedOut) return null;
  const models: string[] = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^[\w.-]+\/\S+$/.test(line));
  if (models.length === 0) return null;
  for (const name of ["opencode.jsonc", "opencode.json"]) {
    const text: string | null = await readOptional(join(configHome, "opencode", name)).catch(() => null);
    const model: string | null = text === null ? null : configModel(text);
    if (model && models.includes(model)) return { models, efforts: [], defaultModel: model };
  }
  return { models, efforts: [], defaultModel: models[0]! };
}

function modelRank(model: string): number {
  const words: string[] = (model.split("/").at(-1) ?? "").toLowerCase().split(/[^a-z0-9]+/);
  if (words.some((word) => ["opus", "pro", "max", "ultra"].includes(word))) return 3;
  if (words.includes("sonnet")) return 2;
  if (words.some((word) => ["haiku", "mini", "flash", "lite", "nano"].includes(word))) return 1;
  return 0;
}

async function profileOffer(options: Options, base: Options | null, probe: EffortProbe | null): Promise<ProfileOffer | null> {
  if (options.defaultModel === null) return null;
  let frontier: string = options.defaultModel;
  let cheap: string = options.defaultModel;
  let highest: number = 0;
  let lowest: number = Infinity;
  for (const model of options.models) {
    const rank: number = modelRank(model);
    if (rank > highest) {
      highest = rank;
      frontier = model;
    }
    if (rank > 0 && rank < lowest) {
      lowest = rank;
      cheap = model;
    }
  }
  const models: string[] = [...new Set([frontier, options.defaultModel, cheap])];
  const efforts: Map<string, string[] | undefined> = new Map(await Promise.all(models.map(async (model): Promise<[string, string[] | undefined]> => {
    const selected: Options | null = probe && model !== base?.defaultModel
      ? await listOptions({ ...probe, model, normalizeModelVariants: true }).catch(() => null) : base;
    const offered: string[] | undefined = selected?.efforts ?? base?.efforts;
    return [model, offered && [...new Set(offered.filter((effort) => effort && effort !== "default"))]];
  })));
  const frontierEfforts: string[] | undefined = efforts.get(frontier);
  const defaultEfforts: string[] | undefined = efforts.get(options.defaultModel);
  const cheapEfforts: string[] | undefined = efforts.get(cheap);
  return {
    frontier: { model: frontier, effort: frontierEfforts && (frontierEfforts.at(-1) ?? null) },
    strong: { model: options.defaultModel, effort: defaultEfforts && (defaultEfforts.at(-1) ?? null) },
    standard: { model: options.defaultModel, effort: defaultEfforts && (defaultEfforts[Math.floor((defaultEfforts.length - 1) / 2)] ?? null) },
    cheap: { model: cheap, effort: cheapEfforts && (cheapEfforts[0] ?? null) },
  };
}

async function findHarness(agents: AgentServices, name: BuiltInHarness, accounts: Global["accounts"]): Promise<Finding> {
  const account: ModelAccount | undefined = accounts.accounts.find((a): a is ModelAccount => a.kind === "model" && a.connector === name);
  const harness: Harness = { connector: name, installed: false, version: null, loggedIn: false };
  const finding: Finding = { harness, title: name, provider: name === "claude-code" ? "anthropic" : name === "codex" ? "openai" : "opencode", account, offer: null };
  const connector: ResolvedConnector | null = await agents.resolve(name).catch(() => null);
  if (!connector) return finding;
  finding.title = connector.title;
  harness.installed = await access(connector.harnessPath, constants.X_OK).then(() => true, () => false);
  if (!harness.installed) return finding;
  const login: LoginInfo | null = await agents.setupLogin(name).catch(() => null);
  if (!login) return finding;
  const spawn: Spawn = spawnFor(login.osUser);
  harness.version = await harnessVersion(connector, spawn);
  if (harness.version === null || !satisfies(harness.version, connector.harness.versionRange)) return finding;
  if (name === "opencode") {
    const options: Options | null = await openCodeModels(connector, login).catch(() => null);
    harness.loggedIn = options !== null;
    if (options) {
      const ready: boolean = await agents.ensureProbeDir(login).then(() => true, () => false);
      const probe: EffortProbe | null = ready ? { connector, login, spawn, allowUnknownIdentity: true } : null;
      const base: Options | null = probe ? await listOptions(probe).catch(() => null) : null;
      finding.offer = await profileOffer(options, base, probe);
    }
  } else {
    const state: LoginInfo["state"] | null = await agents.check(login).catch(() => null);
    harness.loggedIn = state?.state === "logged_in";
    if (harness.loggedIn) {
      const options: Options | null = await listOptions({ connector, login, spawn, normalizeModelVariants: true }).catch(() => null);
      if (options) finding.offer = await profileOffer(options, options, { connector, login, spawn });
    }
  }
  return finding;
}

async function writeChanges(home: string, files: FileChange[], message: string): Promise<Changes> {
  const paths: ReturnType<typeof homePaths> = homePaths(home);
  const written: FileChange[] = [];
  const contents: Changes["files"] = {};
  try {
    for (const entry of files) {
      const [kind, before, value] = entry;
      if (await readOptional(paths[kind]) !== before.before) throw new Error(`${paths[kind]} changed during auto-setup`);
      const content: string = JSON.stringify(value, null, 2) + "\n";
      written.push(entry);
      await writeFile(paths[kind], content);
      if (kind !== "autoSetup") contents[kind] = content;
    }
    const loaded: Awaited<ReturnType<typeof loadGlobal>> = await loadGlobal(home);
    if (!loaded.value) throw new Error(loaded.errors.map((error) => error.message).join("\n"));
    await commitDefinition(home, files.map(([kind]) => paths[kind]), `auto-setup: ${message}`);
    return { message, files: contents };
  } catch (error) {
    for (const [kind, { before }] of written.reverse()) {
      if (before === null) await rm(paths[kind], { force: true });
      else await writeFile(paths[kind], before);
    }
    throw error;
  }
}

export async function autoSetup(home: string, agents: AgentServices): Promise<SetupResult> {
  const root: string = resolve(home);
  const paths: ReturnType<typeof homePaths> = homePaths(root);
  const kinds: (keyof Global)[] = ["accounts", "profiles", "tiers", "settings"];
  const files: Map<SetupFile, File> = new Map(await Promise.all(kinds.map(async (kind): Promise<[SetupFile, File]> => {
    const before: string | null = await readOptional(paths[kind]);
    return [kind, { before, value: JSON.parse(before ?? "{}") as Record<string, unknown> }];
  })));
  const loaded: Awaited<ReturnType<typeof loadGlobal>> = await loadGlobal(root);
  if (!loaded.value) throw new Error(loaded.errors.map((error) => error.message).join("\n"));
  const { accounts, profiles, tiers, settings }: Global = loaded.value;
  const findings: Finding[] = await Promise.all(BuiltInHarness.options.map((name) => findHarness(agents, name, accounts)));
  const harnesses: Harness[] = findings.map((finding) => finding.harness);
  const eligible: Finding[] = findings.filter(({ harness, account }) => harness.loggedIn && (account || !accounts.accounts.some((a) => a.id === harness.connector)));
  if (!eligible.length) return { harnesses, changes: null };
  let trackingFile: File;
  let tracking: Profiles;
  try {
    const before: string | null = await readOptional(paths.autoSetup);
    trackingFile = { before, value: JSON.parse(before ?? "{}") as Record<string, unknown> };
    tracking = Profiles.parse(trackingFile.value);
  } catch (error) {
    console.error(`auto-setup: could not read ${paths.autoSetup}:`, error);
    return { harnesses, changes: null };
  }
  files.set("autoSetup", trackingFile);
  const lastWritten: Map<string, Profile> = new Map(tracking.profiles.map((profile) => [profile.id, profile]));
  const rawProfiles: unknown[] = (files.get("profiles")!.value.profiles ?? []) as unknown[];
  const newAccounts: ModelAccount[] = [];
  const newProfiles: Profile[] = [];
  const refreshedProfiles: Map<number, Profile> = new Map();
  const additions: Record<TierName, string[]> = { frontier: [], strong: [], standard: [], cheap: [] };
  const titles: Set<string> = new Set();
  let assistant: string | null = settings.assistant.profile;
  for (const { harness, title, account, provider, offer } of eligible) {
    const name: BuiltInHarness = harness.connector;
    const id: string = account?.id ?? name;
    if (!account) {
      newAccounts.push(ModelAccount.parse({ id, kind: "model", provider, connector: name, login: "subscription" }));
      titles.add(title);
    }
    if (offer) {
      for (const tier of TierName.options) {
        const profileId: string = `${name}-${tier}`;
        const index: number = profiles.profiles.findIndex((profile) => profile.id === profileId);
        const previous: Profile | undefined = lastWritten.get(profileId);
        const { model, effort }: ProfileOffer[TierName] = offer[tier];
        const profile: Profile = { id: profileId, account: id, model, effort: effort ?? null };
        if (index < 0) {
          if (previous) continue;
          newProfiles.push(profile);
          additions[tier].push(profileId);
        } else {
          if (!previous || previous.account !== id || !isDeepStrictEqual(rawProfiles[index], previous) || effort === undefined || isDeepStrictEqual(profile, previous)) continue;
          refreshedProfiles.set(index, profile);
        }
        lastWritten.set(profileId, profile);
        titles.add(title);
      }
    }
    if (assistant === null) {
      const frontier: Profile | undefined = [...newProfiles, ...profiles.profiles].find((profile) => profile.account === id && profile.id === `${name}-frontier`)
        ?? tiers.tiers.frontier.map((profileId) => profiles.profiles.find((profile) => profile.id === profileId)).find((profile) => profile?.account === id);
      if (frontier) {
        assistant = frontier.id;
        titles.add(title);
      }
    }
  }
  const changes: FileChange[] = [];
  if (newAccounts.length) {
    const file: File = files.get("accounts")!;
    changes.push(["accounts", file, { ...file.value, accounts: [...((file.value.accounts ?? []) as unknown[]), ...newAccounts] }]);
  }
  if (newProfiles.length || refreshedProfiles.size) {
    const file: File = files.get("profiles")!;
    changes.push(["profiles", file, { ...file.value, profiles: [...rawProfiles.map((profile, index) => refreshedProfiles.get(index) ?? profile), ...newProfiles] }]);
    changes.push(["autoSetup", trackingFile, { ...trackingFile.value, profiles: [...lastWritten.values()] }]);
  }
  if (newProfiles.length) {
    const tierFile: File = files.get("tiers")!;
    const entries: Record<string, unknown> = { ...tierFile.value.tiers as Record<string, unknown> | undefined };
    for (const tier of TierName.options) if (additions[tier].length) entries[tier] = [...tiers.tiers[tier], ...additions[tier]];
    changes.push(["tiers", tierFile, { ...tierFile.value, tiers: entries }]);
  }
  if (assistant !== settings.assistant.profile) {
    const file: File = files.get("settings")!;
    const value: Record<string, unknown> = { ...file.value, assistant: { ...file.value.assistant as Record<string, unknown> | undefined, profile: assistant } };
    delete value.firstRunDone;
    changes.push(["settings", file, value]);
  }
  if (!changes.length) return { harnesses, changes: null };
  for (const [kind, file] of files) {
    if (await readOptional(paths[kind]) !== file.before) throw new Error(`${paths[kind]} changed during auto-setup`);
  }
  const profileSummary: string[] = [];
  if (newProfiles.length) profileSummary.push(`${newProfiles.length} ${newProfiles.length === 1 ? "profile" : "profiles"} added`);
  if (refreshedProfiles.size) profileSummary.push(`${refreshedProfiles.size} ${refreshedProfiles.size === 1 ? "profile" : "profiles"} updated`);
  const summary: string = profileSummary.length ? profileSummary.join(", ") : newAccounts.length ? `${newAccounts.length} model ${newAccounts.length === 1 ? "account" : "accounts"}` : "Assistant profile";
  const message: string = `Set up ${new Intl.ListFormat("en").format([...titles])}: ${summary}`;
  return { harnesses, changes: await writeChanges(root, changes, message) };
}
