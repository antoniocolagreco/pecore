import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Theme } from "@pecore/schemas";
import type { FirstRunView, PrerequisiteView, TierName, UsageView } from "@pecore/schemas";
import { loadLibrary, zodErrors } from "../../definitions/load";
import { homePaths } from "../../home/layout";
import { checkPrerequisites } from "../../home/prerequisites";
import type { Prerequisite } from "../../home/prerequisites";
import type { Engine } from "../../main";
import { NotFoundError } from "../../main";
import { checkHome } from "../../osuser/home-check";
import { HttpError } from "../server";
import type { Handlers } from "../server";

const prerequisiteSetting: Record<string, string> = { compose: "servicesRuntime", gh: "accounts", glab: "accounts", aws: "accounts", sudo: "protectedMode", setfacl: "protectedMode", git: "programPaths", gitleaks: "programPaths" };

async function prerequisites(engine: Engine): Promise<Prerequisite[]> {
  const { settings, accounts } = engine.global();
  const services = [...engine.projects.values()].some(({ ctx }) => ctx.project.services !== null);
  return checkPrerequisites({ accounts: accounts.accounts, protectedMode: settings.protectedMode, services, servicesRuntime: settings.servicesRuntime });
}

async function usedTiers(engine: Engine): Promise<Set<TierName>> {
  const lib = await loadLibrary(homePaths(engine.opts.home).library);
  const out = new Set<TierName>();
  for (const recipe of lib.recipes.values())
    for (const rn of Object.values(recipe.nodes)) {
      const node = lib.nodes.get(rn.use);
      if (node?.kind !== "agent") continue;
      const tier = rn.agent?.tier ?? (rn.agent?.profiles === undefined ? node.agent.tier : undefined);
      if (tier) out.add(tier);
    }
  return out;
}

async function firstRun(engine: Engine): Promise<FirstRunView> {
  const { settings, accounts, tiers } = engine.global();
  const steps: FirstRunView["steps"] = [];
  const pre = await prerequisites(engine).catch((e: unknown) => [{ tool: "prerequisites", ok: false, version: null, problem: (e as Error).message }]);
  steps.push({ step: "prerequisites", ok: pre.every((p) => p.ok), problems: pre.filter((p) => !p.ok).map((p) => `${p.tool}: ${p.problem}`) });
  const home = await checkHome().catch((e: unknown) => [{ path: (e as Error).message, mode: 0, fix: [] }]);
  steps.push({ step: "home", ok: home.length === 0, problems: home.map((f) => `${f.path} can be read by other users`) });
  const models = accounts.accounts.filter((a) => a.kind === "model");
  const logins = await engine.loginViews();
  const accountProblems = models.length === 0 ? ["no model account"] : logins.some((l) => l.state === "logged_in") ? [] : logins.map((l) => `${l.account}: ${l.state}`);
  steps.push({ step: "accounts", ok: accountProblems.length === 0, problems: accountProblems });
  const missing = [...(await usedTiers(engine))].filter((t) => tiers.tiers[t].length === 0);
  steps.push({ step: "tiers", ok: missing.length === 0, problems: missing.map((t) => `tier ${t} has no profile`) });
  steps.push({ step: "orchestrator", ok: settings.orchestrator !== null, problems: settings.orchestrator === null ? ["no orchestrator profile"] : [] });
  steps.push({ step: "project", ok: engine.projects.size > 0, problems: engine.projects.size > 0 ? [] : ["no project yet"] });
  return { done: settings.firstRunDone, steps };
}

function localDay(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

type UsageRow = { day: string; account: string; tokens_in: number; tokens_out: number; cache_read: number; cache_write: number; cost: number };

function usage(engine: Engine, from: string | undefined, to: string | undefined): UsageView {
  const today = localDay();
  const out: UsageView = { days: [], budgets: [], cooldowns: [], quotas: [] };
  for (const [project, { ctx }] of engine.projects) {
    const rows = ctx.db.db.prepare("SELECT * FROM usage_daily WHERE day >= ? AND day <= ? ORDER BY day, account").all(from ?? "0000-00-00", to ?? "9999-99-99") as UsageRow[];
    for (const r of rows) out.days.push({ day: r.day, project, account: r.account, tokens: { input: r.tokens_in, output: r.tokens_out, cacheRead: r.cache_read, cacheWrite: r.cache_write }, cost: r.cost });
    const t = ctx.db.db.prepare("SELECT coalesce(sum(tokens_in + tokens_out + cache_write), 0) AS tokens, coalesce(sum(cost), 0) AS usd FROM usage_daily WHERE day = ?").get(today) as { tokens: number; usd: number };
    const b = ctx.project.limits.budget;
    out.budgets.push({ project, dayTokens: b.dayTokens ?? null, dayUsd: b.dayUsd ?? null, usedTokens: t.tokens, usedUsd: t.usd });
  }
  for (const a of engine.global().accounts.accounts) {
    if (a.kind !== "model" || !engine.agents) continue;
    const c = engine.agents.cooling(a.id);
    if (c) out.cooldowns.push({ account: a.id, kind: c.kind, until: c.until });
    const q = engine.agents.quotas.get(a.id);
    if (q) out.quotas.push({ account: a.id, status: q.quota.status, resetAt: q.quota.resetAt ?? null, windows: q.quota.windows ?? {}, seenAt: q.seenAt });
  }
  return out;
}

async function themes(engine: Engine) {
  const dir = homePaths(engine.opts.home).themes;
  const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith(".json")).sort();
  return Promise.all(
    files.map(async (file) => {
      const path = join(dir, file);
      let value: unknown;
      try {
        value = JSON.parse(await readFile(path, "utf8"));
      } catch (e) {
        return { file, theme: null, errors: [{ file: path, path: "", message: (e as Error).message }] };
      }
      const r = Theme.safeParse(value);
      return r.success ? { file, theme: r.data, errors: [] } : { file, theme: null, errors: zodErrors(path, r.error) };
    }),
  );
}

async function conflictOn<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError || e instanceof NotFoundError) throw e;
    throw new HttpError("conflict", (e as Error).message);
  }
}

export function systemHandlers(engine: Engine) {
  return {
    setProtectedMode: async ({ body }) => {
      await conflictOn(() => engine.setProtectedMode(body.on, body.removeUser));
      return { ok: true };
    },
    listLogins: async () => engine.loginViews(),
    startLogin: async ({ body }) => ({ loginId: await conflictOn(() => engine.startLogin(body.account, body.osUser)) }),
    loginCode: async ({ params, body }) => {
      await conflictOn(async () => engine.sendLoginCode(params.id, body.code));
      return { ok: true };
    },
    recheckLogin: async ({ params }) => engine.recheckLogin(params.id),
    recheckAccount: async ({ params }) => ({ state: await engine.recheckAccount(params.id) }),
    startAccountLogin: async ({ params }) => ({ loginId: await conflictOn(() => engine.startAccountLogin(params.id)) }),
    accountOptions: async ({ params }) => engine.accountOptions(params.id),
    checkPrerequisites: async (): Promise<PrerequisiteView[]> => (await prerequisites(engine)).map((p) => ({ ...p, setting: prerequisiteSetting[p.tool] ?? null })),
    getFirstRun: async () => firstRun(engine),
    getUsage: async ({ query }) => usage(engine, query.from, query.to),
    listThemes: async () => themes(engine),
  } satisfies Partial<Handlers>;
}
