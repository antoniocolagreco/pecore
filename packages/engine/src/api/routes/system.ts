import type { PrerequisiteView } from "@pecore/schemas";
import { definitionHash } from "../../definitions/snapshot";
import { checkPrerequisites } from "../../home/prerequisites";
import type { Prerequisite } from "../../home/prerequisites";
import type { Engine } from "../../main";
import { NotFoundError } from "../../main";
import { HttpError } from "../server";
import type { Handlers } from "../server";

const prerequisiteSetting: Record<string, string> = { compose: "servicesRuntime", gh: "accounts", glab: "accounts", aws: "accounts", sudo: "protectedMode", setfacl: "protectedMode" };

async function prerequisites(engine: Engine): Promise<Prerequisite[]> {
  const { settings, accounts } = engine.global();
  const services = settings.servicesRuntime !== null || [...engine.projects.values()].some(({ ctx }) => ctx.project.services !== null);
  return checkPrerequisites({ accounts: accounts.accounts, protectedMode: settings.protectedMode, services, servicesRuntime: settings.servicesRuntime });
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
    accountOptions: async ({ params, query }) => engine.accountOptions(params.id, query.model ?? null),
    refreshAccountOptions: async ({ params }) => engine.accountOptions(params.id, null, true),
    checkPrerequisites: async (): Promise<PrerequisiteView[]> => (await prerequisites(engine)).map((p) => ({ ...p, setting: prerequisiteSetting[p.tool] ?? null })),
    getSetup: async () => engine.setupView(),
    startSetupLogin: async ({ params }) => ({ loginId: await conflictOn(() => engine.startSetupLogin(params.connector)) }),
    listThemes: async () => engine.configuration.themes(),
    putTheme: ({ params: { id }, body }) => engine.withGlobalFiles(async () => {
      engine.configuration.setTheme(id, body);
      engine.definitionChanged(`themes/${id}`, definitionHash(body));
      return { id, theme: body };
    }),
  } satisfies Partial<Handlers>;
}
