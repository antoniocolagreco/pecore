import { execFileSync } from "node:child_process";
import { chmod, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Accounts, Settings } from "@pecore/schemas";
import { shippedTemplates, tempDir } from "../../test/tmp";
import { AgentServices } from "../accounts/agents";
import { homePaths, initHome } from "../home/layout";
import { closeHome, moveLegacyFolders } from "../home/legacy";
import { appUser } from "../runners/process";
import { privateDirectory } from "./acl";

const otherUser = "nobody";
const linux: boolean = process.platform === "linux";
const realHome: string | undefined = process.env.HOME;

afterEach(() => {
  process.env.HOME = realHome;
});

function acl(path: string): string[] {
  return execFileSync("getfacl", ["-p", "--omit-header", "--", path], { encoding: "utf8" }).trim().split("\n").filter((line) => line.includes(`:${otherUser}:`));
}

async function mode(path: string): Promise<number> {
  return (await stat(path)).mode & 0o777;
}

async function newHome(): Promise<string> {
  const home: string = join(await tempDir(), "home");
  await initHome(home, { templates: shippedTemplates });
  return home;
}

describe.skipIf(!linux)("PECORE_HOME permissions", () => {
  it("keeps the home and the folders the app makes for itself private, with no ACL for anyone else", async () => {
    const home: string = await newHome();
    const chats: string = homePaths(home).chats;
    await privateDirectory(chats, appUser, home);
    expect(await mode(home)).toBe(0o700);
    expect(await mode(chats)).toBe(0o700);
    expect(acl(home)).toEqual([]);
    expect(acl(chats)).toEqual([]);
  });

  it("opens to another user only the folder made for it: full access there, pass-through on the folders above, nothing on the rest", async () => {
    const home: string = await newHome();
    const p = homePaths(home);
    await writeFile(p.settings, "{}\n", { mode: 0o600 });
    await writeFile(p.accounts, "{}\n", { mode: 0o600 });
    const appLogins: string = join(p.harness, appUser);
    await mkdir(join(appLogins, "claude"), { recursive: true, mode: 0o700 });
    await writeFile(join(appLogins, "claude", ".credentials.json"), "secret\n", { mode: 0o600 });
    await privateDirectory(p.chats, appUser, home);
    const shared: string = join(p.harness, otherUser);

    await privateDirectory(shared, otherUser, home);

    expect(await mode(shared)).toBe(0o770);
    expect(acl(shared)).toEqual([`user:${otherUser}:rwx`, `default:user:${otherUser}:rwx`]);
    expect(acl(p.harness)).toEqual([`user:${otherUser}:--x`]);
    expect(acl(home)).toEqual([`user:${otherUser}:--x`]);
    expect(acl(dirname(home))).toEqual([`user:${otherUser}:--x`]);
    for (const secret of [p.settings, p.accounts, appLogins, join(appLogins, "claude"), join(appLogins, "claude", ".credentials.json"), p.chats, p.templates, p.projects]) {
      expect(acl(secret), secret).toEqual([]);
    }
    expect(await mode(join(appLogins, "claude", ".credentials.json"))).toBe(0o600);
    expect(await mode(appLogins)).toBe(0o700);
  });

  it("refuses user names that could change the ACL", async () => {
    const home: string = await newHome();
    await expect(privateDirectory(join(home, "chats"), "x,u:root:rwx", home)).rejects.toThrow("Invalid ACL user");
  });

  it("keeps each harness login under PECORE_HOME/harness/<user>/<account>, private to the app user", async () => {
    const home: string = await newHome();
    const accounts = Accounts.parse({ accounts: [
      { id: "claude-main", kind: "model", provider: "anthropic", connector: "claude-code", login: "subscription" },
      { id: "claude-work", kind: "model", provider: "anthropic", connector: "claude-code", login: "subscription" },
    ] });
    const settings = Settings.parse({});
    const services = new AgentServices({ connectorsDir: join(home, "none"), adaptersDir: join(home, "none"), adapters: {} }, home, () => settings, () => accounts);
    const logins = await services.logins();
    expect(logins.map(({ configDir }) => configDir)).toEqual([join(home, "harness", appUser, "claude-main"), join(home, "harness", appUser, "claude-work")]);
    await services.ensureProbeDir(logins[1]!);
    expect(await mode(join(home, "harness", appUser))).toBe(0o700);
    expect(await mode(join(home, "harness", appUser, "claude-work", "probe"))).toBe(0o700);
    expect(acl(join(home, "harness", appUser))).toEqual([]);
  });
});

describe.skipIf(!linux)("closing PECORE_HOME at start", () => {
  it("makes every file private and stops others listing folders, but leaves adapters, chats, logins, work folders and repositories as they are", async () => {
    const home: string = await newHome();
    const p = homePaths(home);
    await writeFile(p.settings, "{}\n", { mode: 0o644 });
    await mkdir(join(p.projects, "demo", "work"), { recursive: true, mode: 0o755 });
    await mkdir(join(p.projects, "demo", "repo.git"), { recursive: true, mode: 0o755 });
    await writeFile(join(p.projects, "demo", "project.json"), "{}\n", { mode: 0o644 });
    await writeFile(join(p.projects, "demo", "pecore.db"), "", { mode: 0o664 });
    await writeFile(join(p.projects, "demo", "work", "keep.txt"), "", { mode: 0o664 });
    await writeFile(join(p.projects, "demo", "repo.git", "HEAD"), "", { mode: 0o644 });
    await mkdir(join(p.adapters, "node"), { recursive: true, mode: 0o755 });
    await writeFile(join(p.adapters, "node", "node"), "", { mode: 0o755 });
    await privateDirectory(join(p.harness, otherUser), otherUser, home);
    await writeFile(join(p.harness, otherUser, "auth.json"), "", { mode: 0o600 });
    const templateNode: string = join(p.templateNodes, "git-commit.json");
    await chmod(join(p.projects, "demo", "work", "keep.txt"), 0o664);
    await chmod(join(p.projects, "demo", "work"), 0o755);
    await chmod(templateNode, 0o644);

    await closeHome(home);

    for (const file of [p.settings, templateNode, join(p.projects, "demo", "project.json"), join(p.projects, "demo", "pecore.db")]) expect((await mode(file)) & 0o077, file).toBe(0);
    expect((await mode(p.templates)) & 0o007).toBe(0);
    expect((await mode(join(p.projects, "demo"))) & 0o007).toBe(0);
    expect(await mode(join(p.projects, "demo", "work"))).toBe(0o755);
    expect(await mode(join(p.projects, "demo", "work", "keep.txt"))).toBe(0o664);
    expect(await mode(join(p.projects, "demo", "repo.git", "HEAD"))).toBe(0o644);
    expect(await mode(join(p.adapters, "node", "node"))).toBe(0o755);
    expect(acl(join(p.harness, otherUser))).toEqual([`user:${otherUser}:rwx`, `default:user:${otherUser}:rwx`]);
    expect(acl(p.harness)).toEqual([`user:${otherUser}:--x`]);
    expect(acl(home)).toEqual([`user:${otherUser}:--x`]);
  });
});

describe.skipIf(!linux)("moving the old folders into PECORE_HOME", () => {
  it("moves ~/.pecore-harness with its logins unchanged and private, deletes ~/.pecore-chats, and does nothing the second time", async () => {
    const user: string = join(await tempDir(), "user");
    process.env.HOME = user;
    await mkdir(join(user, ".pecore-harness", "codex"), { recursive: true, mode: 0o700 });
    await writeFile(join(user, ".pecore-harness", "codex", "auth.json"), "token\n", { mode: 0o600 });
    await mkdir(join(user, ".pecore-chats", "assistant", "files"), { recursive: true });
    await writeFile(join(user, ".pecore-chats", "assistant", "mcp-token"), "old\n", { mode: 0o600 });
    const home: string = await newHome();

    await moveLegacyFolders(home, false);

    const moved: string = join(home, "harness", appUser, "codex", "auth.json");
    expect(await readFile(moved, "utf8")).toBe("token\n");
    expect(await mode(moved)).toBe(0o600);
    expect(await mode(join(home, "harness", appUser, "codex"))).toBe(0o700);
    expect(await mode(join(home, "harness"))).toBe(0o700);
    expect(await readdir(user)).toEqual([]);

    await moveLegacyFolders(home, false);
    expect(await readFile(moved, "utf8")).toBe("token\n");
  });

  it("never overwrites logins already in PECORE_HOME", async () => {
    const user: string = join(await tempDir(), "user");
    process.env.HOME = user;
    await mkdir(join(user, ".pecore-harness", "codex"), { recursive: true });
    await writeFile(join(user, ".pecore-harness", "codex", "auth.json"), "old\n");
    const home: string = await newHome();
    await mkdir(join(home, "harness", appUser, "codex"), { recursive: true });
    await writeFile(join(home, "harness", appUser, "codex", "auth.json"), "current\n");

    await moveLegacyFolders(home, false);

    expect(await readFile(join(home, "harness", appUser, "codex", "auth.json"), "utf8")).toBe("current\n");
    expect(await readFile(join(user, ".pecore-harness", "codex", "auth.json"), "utf8")).toBe("old\n");
  });
});
