import { execFile } from "node:child_process";
import { chmod, mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { tempDir } from "../../test/tmp";
import { appUser } from "../runners/process";
import { createLocalRepo } from "../workdir/repo";
import { traverseAclCommands } from "./acl";
import { checkHome } from "./home-check";
import { protectedModeScript } from "./protected-mode";
import { createProtectedUserScript, projectAccessScript, removeProtectedUserScript } from "./script";

const execFileP = promisify(execFile);

async function syntaxOk(script: string): Promise<void> {
  await execFileP("sh", ["-n", "-c", script]);
}

const mode = async (path: string) => (await stat(path)).mode & 0o7777;

describe("traverse ACLs", () => {
  it("grants execute on every ancestor below the start, never on /", () => {
    expect(traverseAclCommands("/home/ann/pecore/projects/demo/work", "pecore-agent")).toEqual([
      ["setfacl", "-m", "u:pecore-agent:x", "--", "/home"],
      ["setfacl", "-m", "u:pecore-agent:x", "--", "/home/ann"],
      ["setfacl", "-m", "u:pecore-agent:x", "--", "/home/ann/pecore"],
      ["setfacl", "-m", "u:pecore-agent:x", "--", "/home/ann/pecore/projects"],
      ["setfacl", "-m", "u:pecore-agent:x", "--", "/home/ann/pecore/projects/demo"],
    ]);
    expect(traverseAclCommands("/home/ann/pecore/work", "pecore-agent", "/home/ann")).toEqual([
      ["setfacl", "-m", "u:pecore-agent:x", "--", "/home/ann"],
      ["setfacl", "-m", "u:pecore-agent:x", "--", "/home/ann/pecore"],
    ]);
  });

  it("rejects relative paths, targets outside the start and bad user names", () => {
    expect(() => traverseAclCommands("work", "pecore-agent")).toThrow();
    expect(() => traverseAclCommands("/srv/work", "pecore-agent", "/home/ann")).toThrow();
    expect(() => traverseAclCommands("/home/ann", "pecore-agent", "/home/ann")).toThrow();
    expect(() => traverseAclCommands("/home/ann/work", "bad user")).toThrow();
  });
});

describe("protected user scripts", () => {
  it("creates the user and a sudoers rule that is checked before install", async () => {
    const script = createProtectedUserScript("ann");
    await syntaxOk(script);
    expect(script).toContain(`'"ann" ALL=(pecore-agent) NOPASSWD: ALL'`);
    expect(script).toContain("'Defaults>pecore-agent !use_pty'");
    expect(script.indexOf('visudo -cf "$tmp"')).toBeLessThan(script.indexOf("install -m 0440 -o root -g root"));
    expect(script).toContain("usermod -aG 'pecore-agent' -- 'ann'");
  });

  it("refuses root, the protected user and names that need quoting", () => {
    expect(() => createProtectedUserScript("root")).toThrow();
    expect(() => createProtectedUserScript("pecore-agent")).toThrow();
    expect(() => createProtectedUserScript("ann; rm -rf /")).toThrow();
    expect(() => projectAccessScript("/home/ann/p", "root", true)).toThrow();
  });

  it("removal removes the sudoers rule before the user", async () => {
    const script = removeProtectedUserScript();
    await syntaxOk(script);
    expect(script.indexOf("rm -f -- '/etc/sudoers.d/pecore-agent'")).toBeLessThan(script.indexOf("userdel"));
  });
});

describe("project access script", () => {
  it("protected mode: repo.git 3775 and work 2770 with group pecore-agent, plus traverse ACLs", async () => {
    const script = projectAccessScript("/home/ann/pecore/projects/demo", "ann", true);
    await syntaxOk(script);
    expect(script).toContain("chmod 3775 -- '/home/ann/pecore/projects/demo/repo.git'");
    expect(script).toContain("chmod 2770 -- '/home/ann/pecore/projects/demo/work'");
    expect(script).toContain("chown -- 'ann':'pecore-agent' '/home/ann/pecore/projects/demo/repo.git' '/home/ann/pecore/projects/demo/work'");
    expect(script).toContain("chown -hRP -- 'ann' '/home/ann/pecore/projects/demo/repo.git/hooks'");
    expect(script).toContain("setfacl -RP -m 'u:ann:rwX,d:u:ann:rwX' -- '/home/ann/pecore/projects/demo/repo.git'");
    expect(script).toContain("'setfacl' '-m' 'u:pecore-agent:x' '--' '/home/ann/pecore/projects/demo'");
  });

  it("normal mode runs as the app user and makes repo.git 755 and work 700", async () => {
    const project = await tempDir();
    await createLocalRepo(join(project, "repo.git"), "main");
    await mkdir(join(project, "work", "J1"), { recursive: true });
    await chmod(join(project, "repo.git", "config"), 0o664);
    await execFileP("sh", ["-c", projectAccessScript(project, appUser, false)]);
    expect(await mode(join(project, "repo.git"))).toBe(0o755);
    expect(await mode(join(project, "work"))).toBe(0o700);
    expect((await mode(join(project, "repo.git", "config"))) & 0o022).toBe(0);
    expect(projectAccessScript("/home/ann/pecore/projects/demo", "ann", false)).toContain(`chown -hRP -- 'ann':"$(id -gn -- 'ann')" '/home/ann/pecore/projects/demo/repo.git/objects'`);
  });

  it("refuses a project directory that is a symlink", async () => {
    const root = await tempDir();
    await mkdir(join(root, "real", "work"), { recursive: true });
    await createLocalRepo(join(root, "real", "repo.git"), "main");
    await execFileP("ln", ["-s", join(root, "real"), join(root, "link")]);
    await expect(execFileP("sh", ["-c", projectAccessScript(join(root, "link"), appUser, false)])).rejects.toThrow();
  });
});

describe("protected mode switch (decision 14)", () => {
  it("turning it on creates the user and runs the group step for every project in one script", async () => {
    const script = protectedModeScript(true, ["/home/ann/pecore/projects/a", "/home/ann/pecore/projects/b"], { createUser: true, removeUser: false });
    await syntaxOk(script);
    expect(script).toContain("useradd --system");
    expect(script).toContain("chmod 3775 -- '/home/ann/pecore/projects/a/repo.git'");
    expect(script).toContain("chmod 3775 -- '/home/ann/pecore/projects/b/repo.git'");
    expect(protectedModeScript(true, [], { createUser: false, removeUser: false })).not.toContain("useradd");
  });

  it("turning it off gives every workdir back to the app user and removes the user only on request", async () => {
    const off = protectedModeScript(false, ["/home/ann/pecore/projects/a"], { createUser: false, removeUser: false });
    await syntaxOk(off);
    expect(off).toContain("chmod 00755 -- '/home/ann/pecore/projects/a/repo.git'");
    expect(off).not.toContain("userdel");
    expect(protectedModeScript(false, [], { createUser: false, removeUser: true })).toContain("userdel --remove");
  });
});

describe("home check", () => {
  it("flags readable login files and gives the chmod that fixes each", async () => {
    const home = await tempDir();
    await chmod(home, 0o700);
    await mkdir(join(home, ".config", "gh"), { recursive: true });
    await writeFile(join(home, ".config", "gh", "hosts.yml"), "github.com: {}\n");
    await chmod(join(home, ".config", "gh", "hosts.yml"), 0o644);
    await mkdir(join(home, ".aws"));
    await chmod(join(home, ".aws"), 0o750);
    await writeFile(join(home, ".claude.json"), "{}");
    await chmod(join(home, ".claude.json"), 0o600);
    await mkdir(join(home, ".claude.lock"), { mode: 0o755 });
    const findings = await checkHome(home);
    expect(findings).toEqual([
      { path: join(home, ".config", "gh", "hosts.yml"), mode: 0o644, fix: ["chmod", "go-r", "--", join(home, ".config", "gh", "hosts.yml")] },
      { path: join(home, ".aws"), mode: 0o750, fix: ["chmod", "go-rwx", "--", join(home, ".aws")] },
    ]);
  });

  it("flags a home others can read and ignores missing files", async () => {
    const home = await tempDir();
    await chmod(home, 0o755);
    expect(await checkHome(home)).toEqual([{ path: home, mode: 0o755, fix: ["chmod", "go-r", "--", home] }]);
  });
});
