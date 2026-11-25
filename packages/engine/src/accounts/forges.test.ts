import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { apiClient } from "@pecore/schemas";
import type { ForgeAccount, LiveMessage } from "@pecore/schemas";
import { setTestConfiguration } from "../../test/configuration";
import { until } from "../../test/forge-project";
import { shippedTemplates, tempDir } from "../../test/tmp";
import { handlers } from "../api/handlers";
import { startApi } from "../api/server";
import { Engine } from "../main";
import { discoverForgeAccounts, forgeLoginUser } from "./forges";

afterEach(() => vi.unstubAllEnvs());

const github = `case "$2" in
login) printf 'Visit https://github.com/login/device\\n' ;;
status) printf '%s\\n' '{"hosts":{"github.com":[{"state":"success","active":false,"login":"ada"},{"state":"success","active":true,"login":"grace"},{"state":"error","active":false,"login":"expired"}],"github.example.com":[{"state":"success","active":true,"login":"enterprise"}]}}' ;;
token) printf 'fake-token\\n' ;;
esac`;

const gitlab = `case "$2" in
login) printf 'Visit https://gitlab.com/-/device\\n' ;;
status) printf '%s\\n' '{"hosts":[{"state":"success","host":"gitlab.com","user":"lin"},{"state":"success","host":"gitlab.example.com","user":"sam"},{"state":"error","host":"offline.example.com"}]}'; exit 1 ;;
get) printf 'fake-token\\n' ;;
esac`;

const aws = `case "$1 $2" in
"configure list-profiles") printf 'work\\nexpired\\nno-access\\n' ;;
"configure get") printf 'eu-west-1\\n' ;;
"sts get-caller-identity")
  [ "$4" != expired ] || exit 1
  printf '%s\\n' '{"Account":"123456789012","Arn":"arn:aws:iam::123456789012:user/ada"}' ;;
"codecommit list-repositories")
  [ "$4" != no-access ] || exit 1
  printf '%s\\n' '{"repositories":[]}' ;;
esac`;

async function cliFixture(scripts: Record<string, string>, installedOnly: boolean = false): Promise<string> {
  const home: string = await tempDir();
  const bin: string = join(home, "bin");
  await mkdir(bin);
  await Promise.all(Object.entries(scripts).map(([name, script]) => writeFile(join(bin, name), `#!/bin/sh\n${script}\n`, { mode: 0o700 })));
  vi.stubEnv("HOME", home);
  vi.stubEnv("PATH", installedOnly ? bin : `${bin}:${process.env.PATH}`);
  vi.stubEnv("AWS_REGION", undefined);
  vi.stubEnv("AWS_DEFAULT_REGION", undefined);
  return home;
}

it("skips missing CLIs and installed CLIs with no authenticated identities", async () => {
  await cliFixture({}, true);
  expect(await discoverForgeAccounts()).toEqual([]);
  await cliFixture({ gh: "exit 1", glab: "exit 1", aws: "exit 1" }, true);
  expect(await discoverForgeAccounts()).toEqual([]);
});

it("reads authenticated users from older plain-text status commands", async () => {
  await cliFixture({
    gh: `case "$#" in
      2|4) printf 'Logged in to github.example.com account ada (keyring)\\n  - Active account: false\\nLogged in to github.example.com account grace (keyring)\\n  - Active account: true\\n' >&2 ;;
      *) exit 1 ;;
      esac`,
    glab: `[ "$#" = 2 ] || exit 1
      printf 'Logged in to gitlab.example.com as lin (config)\\n' >&2`,
  }, true);
  expect(await discoverForgeAccounts()).toEqual([
    { forge: "github", host: "github.example.com", user: "ada" },
    { forge: "github", host: "github.example.com", user: "grace" },
    { forge: "gitlab", host: "gitlab.example.com", user: "lin" },
  ]);
  expect(await forgeLoginUser({
    kind: "forge", id: "new", forge: "github", tool: "gh", host: "github.example.com", user: "", author: { name: "", email: "" },
  })).toBe("grace");
});

it("adds missing accounts on engine startup, preserves matches and uses the configured commit author", async () => {
  const home: string = await cliFixture({ gh: github, glab: gitlab, aws });
  await writeFile(join(home, ".gitconfig"), "[user]\n name = Local Author\n email = local@example.com\n");
  const author: ForgeAccount["author"] = { name: "Edited Author", email: "edited@example.com" };
  const existing: ForgeAccount[] = [
    { id: "github-existing", kind: "forge", forge: "github", host: "github.com", user: "Ada", tool: "gh", author },
    { id: "gitlab-existing", kind: "forge", forge: "gitlab", host: "gitlab.com", user: "lin", tool: "glab", author },
    { id: "aws-existing", kind: "forge", forge: "codecommit", host: "git-codecommit.eu-west-1.amazonaws.com", user: "work", tool: "aws", author },
  ];
  await setTestConfiguration(home, "accounts", { accounts: existing });
  const options = { home, templates: shippedTemplates, discoverForges: true };
  const engine: Engine = await Engine.start(options);
  await engine.setupDone;
  try {
    const accounts = engine.global().accounts.accounts;
    expect(accounts.slice(0, 3)).toEqual(existing);
    expect(accounts).toHaveLength(6);
    expect(accounts.slice(3)).toEqual(expect.arrayContaining([
      { id: "gh-grace", kind: "forge", forge: "github", host: "github.com", tool: "gh", user: "grace", author: { name: "Local Author", email: "local@example.com" } },
      { id: "gh-enterprise", kind: "forge", forge: "github", host: "github.example.com", tool: "gh", user: "enterprise", author: { name: "Local Author", email: "local@example.com" } },
      { id: "glab-sam", kind: "forge", forge: "gitlab", host: "gitlab.example.com", tool: "glab", user: "sam", author: { name: "Local Author", email: "local@example.com" } },
    ]));
  } finally {
    await engine.shutdown();
  }
  const reopened: Engine = await Engine.start(options);
  await reopened.setupDone;
  try {
    expect(reopened.global().accounts.accounts).toHaveLength(6);
  } finally {
    await reopened.shutdown();
  }
});

it("publishes ready accounts and serves settings while another forge is still checking", async () => {
  const gate: string = join(await tempDir(), "release");
  const home: string = await cliFixture({
    gh: github, glab: "exit 1",
    aws: `while [ ! -f "${gate}" ]; do /bin/sleep 0.05; done\nexit 1`,
  });
  const engine: Engine = await Engine.start({ home, templates: shippedTemplates, discoverForges: true });
  try {
    await until(() => engine.global().accounts.accounts.some(({ id }) => id === "gh-ada") && !engine.accountDiscovery().includes("github"), 3000);
    expect(engine.accountDiscovery()).toContain("codecommit");
    expect(engine.accountDiscovery()).not.toContain("github");
    const settings = await handlers("test")(engine).getSettings({ params: undefined, query: undefined, body: undefined });
    expect(settings.value).toHaveProperty("projectsFolder");
    expect(engine.accountDiscovery()).toContain("codecommit");
  } finally {
    await writeFile(gate, "");
    await engine.shutdown();
  }
});

it("discovers usable CodeCommit profiles with a separate identity and ignores profiles without access", async () => {
  await cliFixture({ aws }, true);
  expect(await discoverForgeAccounts()).toEqual([
    { forge: "codecommit", host: "git-codecommit.eu-west-1.amazonaws.com", user: "ada", awsProfile: "work" },
  ]);
});

it("returns commit defaults and stores the CLI username after a successful login", async () => {
  const home: string = await cliFixture({ gh: github, glab: gitlab, aws });
  const author: ForgeAccount["author"] = { name: "", email: "" };
  await setTestConfiguration(home, "accounts", { accounts: [
    { id: "github-new", kind: "forge", forge: "github", host: "github.com", user: "", tool: "gh", author },
    { id: "gitlab-new", kind: "forge", forge: "gitlab", host: "gitlab.com", user: "", tool: "glab", author },
  ] });
  const engine: Engine = await Engine.start({ home, templates: shippedTemplates });
  const api = await startApi(engine, { handlers: handlers("t"), validateResponses: true });
  const call = apiClient({ port: api.port, token: api.token });
  try {
    expect(await call("getForgeAccountDefaults", { query: {} })).toEqual({ author, codeCommit: null });
    await writeFile(join(home, ".gitconfig"), "[user]\n name = Local Author\n email = local@example.com\n");
    expect(await call("getForgeAccountDefaults", { query: { awsProfile: "work" } })).toEqual({
      author: { name: "Local Author", email: "local@example.com" }, codeCommit: { host: "git-codecommit.eu-west-1.amazonaws.com", user: "ada" },
    });
    for (const [id, username] of [["github-new", "grace"], ["gitlab-new", "lin"]] as const) {
      const done: Promise<void> = new Promise((resolve) => {
        const listener = (message: LiveMessage): void => {
          if (message.type === "login.progress" && message.done && message.loginId === `tool:${id}`) {
            engine.off("live", listener);
            resolve();
          }
        };
        engine.on("live", listener);
      });
      await call("startAccountLogin", { params: { id } });
      await done;
      expect((await call("getAccounts")).value.accounts.find((account) => account.id === id)).toMatchObject({ user: username, author });
    }
  } finally {
    await api.close();
    await engine.shutdown();
  }
});
