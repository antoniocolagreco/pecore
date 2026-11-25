import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { harnessVersion, listOptions, satisfies } from "@pecore/agents";
import type { ResolvedConnector, Spawn } from "@pecore/agents";
import { BuiltInHarness, Compaction, ModelAccount, TierName, builtInAgentColor, builtInAgentNames } from "@pecore/schemas";
import type { AgentDefinition, NodeAgent, Profile, Profiles, SetupView, Tiers } from "@pecore/schemas";
import { spawnFor } from "../accounts/agents";
import type { AgentServices, LoginInfo } from "../accounts/agents";
import { validateGlobal } from "../definitions/load";
import type { DefinitionError, Global } from "../definitions/load";
import type { Configuration } from "../store/configuration";
import { appUser, baseEnv, run } from "../runners/process";
import type { RunResult } from "../runners/process";

type Harness = SetupView["harnesses"][number];
type Options = NonNullable<Awaited<ReturnType<typeof listOptions>>>;
type ProfileOffer = Record<TierName, { model: string; effort: string | null | undefined }>;
type EffortProbe = Pick<Parameters<typeof listOptions>[0], "connector" | "login" | "spawn" | "allowUnknownIdentity">;
type Finding = { harness: Harness; title: string; account: ModelAccount | undefined; provider: string; offer: ProfileOffer | null };
type Changes = { message: string; changed: (keyof Global)[] };
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

export async function autoSetup(configuration: Configuration, agents: AgentServices): Promise<SetupResult> {
  const current: Global = configuration.read();
  const { accounts, profiles, tiers } = current;
  const findings: Finding[] = await Promise.all(BuiltInHarness.options.map((name) => findHarness(agents, name, accounts)));
  const harnesses: Harness[] = findings.map((finding) => finding.harness);
  const eligible: Finding[] = findings.filter(({ harness, account }) => harness.loggedIn && (account || !accounts.accounts.some((a) => a.id === harness.connector)));
  if (!eligible.length) return { harnesses, changes: null };
  const tracking: Profiles = configuration.autoSetupProfiles();
  const lastWritten: Map<string, Profile> = new Map(tracking.profiles.map((profile) => [profile.id, profile]));
  const newAccounts: ModelAccount[] = [];
  const newProfiles: Profile[] = [];
  const refreshedProfiles: Map<number, Profile> = new Map();
  const additions: Record<TierName, string[]> = { frontier: [], strong: [], standard: [], cheap: [] };
  const titles: Set<string> = new Set();
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
          if (!previous || previous.account !== id || !isDeepStrictEqual(profiles.profiles[index], previous) || effort === undefined || isDeepStrictEqual(profile, previous)) continue;
          refreshedProfiles.set(index, profile);
        }
        lastWritten.set(profileId, profile);
        titles.add(title);
      }
    }
  }
  const changes: Partial<Global> = {};
  if (newAccounts.length) changes.accounts = { accounts: [...accounts.accounts, ...newAccounts] };
  if (newProfiles.length || refreshedProfiles.size) {
    changes.profiles = { profiles: [...profiles.profiles.map((profile, index) => refreshedProfiles.get(index) ?? profile), ...newProfiles] };
  }
  if (newProfiles.length) {
    const entries: Tiers["tiers"] = { ...tiers.tiers };
    for (const tier of TierName.options) if (additions[tier].length) entries[tier] = [...tiers.tiers[tier], ...additions[tier]];
    changes.tiers = { tiers: entries };
  }
  const changed: (keyof Global)[] = Object.keys(changes) as (keyof Global)[];
  if (!changed.length) return { harnesses, changes: null };
  if (!isDeepStrictEqual(configuration.read(), current) || !isDeepStrictEqual(configuration.autoSetupProfiles(), tracking)) {
    throw new Error("Configuration changed during auto-setup");
  }
  const errors: DefinitionError[] = validateGlobal({ ...current, ...changes });
  if (errors.length) throw new Error(errors.map((error) => error.message).join("\n"));
  configuration.write(changes, changes.profiles ? { profiles: [...lastWritten.values()] } : undefined);
  const profileSummary: string[] = [];
  if (newProfiles.length) profileSummary.push(`${newProfiles.length} ${newProfiles.length === 1 ? "profile" : "profiles"} added`);
  if (refreshedProfiles.size) profileSummary.push(`${refreshedProfiles.size} ${refreshedProfiles.size === 1 ? "profile" : "profiles"} updated`);
  const summary: string = profileSummary.length ? profileSummary.join(", ") : `${newAccounts.length} model ${newAccounts.length === 1 ? "account" : "accounts"}`;
  const message: string = `Set up ${new Intl.ListFormat("en").format([...titles])}: ${summary}`;
  return { harnesses, changes: { message, changed } };
}

export function ensureBuiltInAgents(configuration: Configuration, fillModels: boolean): boolean {
  const current: Global = configuration.read();
  const profile: Profile | undefined = fillModels ? current.profiles.profiles.find(({ id }) => id === current.tiers.tiers.standard[0]) : undefined;
  const model: NodeAgent["model"] = profile ? { account: profile.account, model: profile.model, effort: profile.effort } : null;
  const names: Set<string> = new Set([
    ...Array.from(builtInAgentNames.values(), (name) => name.toLowerCase()),
    ...current.agents.agents.flatMap((agent) => agent.kind === "agent" ? [agent.name.toLowerCase()] : []),
  ]);
  const agents: AgentDefinition[] = current.agents.agents.map((agent) => {
    if (agent.kind !== "agent" || builtInAgentNames.has(agent.id)) return agent;
    if (!Array.from(builtInAgentNames.values()).some((name) => name.toLowerCase() === agent.name.toLowerCase())) return agent;
    for (let index: number = 1; ; index++) {
      const name: string = index === 1 ? `${agent.name} (custom)` : `${agent.name} (custom ${index})`;
      if (names.has(name.toLowerCase())) continue;
      names.add(name.toLowerCase());
      return { ...agent, name };
    }
  });
  const builtIns: NodeAgent[] = Array.from(builtInAgentNames, ([id, name]) => {
    const agent: AgentDefinition | undefined = current.agents.agents.find((entry) => entry.id === id);
    return agent?.kind === "agent" ? { ...agent, name, model: agent.model ?? model }
      : { id, kind: "agent", name, model, color: builtInAgentColor, compaction: Compaction.parse({}) };
  });
  const next: Global["agents"] = { agents: [...builtIns, ...agents.filter(({ id }) => !builtInAgentNames.has(id))] };
  if (isDeepStrictEqual(next, current.agents)) return false;
  configuration.write({ agents: next });
  return true;
}
