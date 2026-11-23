import { isAbsolute, join, resolve } from "node:path";
import { protectedUser } from "../accounts/agents";
import { traverseAclCommands } from "./acl";

const sudoersPath: string = `/etc/sudoers.d/${protectedUser}`;

function linux(): void {
  if (process.platform === "darwin") throw new Error("not supported on macOS yet");
}

function quote(value: string): string {
  if (value.includes("\0")) throw new Error("Shell arguments cannot contain NUL");
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function appAccount(user: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_.-]*\$?$/.test(user) || user === protectedUser || user === "root") {
    throw new Error("Invalid app user for protected mode");
  }
  return user;
}

export function createProtectedUserScript(appUser: string): string {
  linux();
  const app = appAccount(appUser);
  const agent = quote(protectedUser);
  return [
    "set -eu",
    "export PATH=/usr/sbin:/usr/bin:/sbin:/bin",
    `test "$(id -u -- ${quote(app)})" -gt 0`,
    `getent group ${agent} >/dev/null || groupadd -- ${agent}`,
    `getent passwd ${agent} >/dev/null || useradd --system --create-home --gid ${agent} --shell /bin/sh -- ${agent}`,
    `test "$(id -u -- ${agent})" -gt 0`,
    `test "$(id -gn -- ${agent})" = ${agent}`,
    `usermod -aG ${agent} -- ${quote(app)}`,
    'tmp=$(mktemp /etc/sudoers.d/.pecore-agent.XXXXXX)',
    "trap 'rm -f -- \"$tmp\"' EXIT",
    `printf '%s\\n' ${quote(`"${app}" ALL=(${protectedUser}) NOPASSWD: ALL`)} ${quote(`Defaults>${protectedUser} !use_pty`)} > "$tmp"`,
    'visudo -cf "$tmp"',
    `install -m 0440 -o root -g root -- "$tmp" ${quote(sudoersPath)}`,
    "",
  ].join("\n");
}

export function removeProtectedUserScript(): string {
  linux();
  const agent = quote(protectedUser);
  return [
    "set -eu",
    "export PATH=/usr/sbin:/usr/bin:/sbin:/bin",
    `rm -f -- ${quote(sudoersPath)}`,
    `if getent passwd ${agent} >/dev/null; then userdel --remove -- ${agent}; fi`,
    `if getent group ${agent} >/dev/null; then groupdel -- ${agent}; fi`,
    "",
  ].join("\n");
}

export function projectAccessScript(projectDir: string, appUser: string, protectedMode: boolean): string {
  linux();
  const app = appAccount(appUser);
  if (!isAbsolute(projectDir) || resolve(projectDir) === "/") throw new Error("Invalid project directory");
  const project = resolve(projectDir);
  const work = join(project, "work");
  const repo = join(project, "repo.git");
  const owner = quote(protectedMode ? protectedUser : app);
  const group = protectedMode ? quote(protectedUser) : `"$(id -gn -- ${quote(app)})"`;
  const regroup = (flags: string, path: string): string => (protectedMode ? `chgrp ${flags}-- ${group} ${path}` : `chown ${flags}-- ${quote(app)}:${group} ${path}`);
  const commands = [
    "set -eu",
    "export PATH=/usr/sbin:/usr/bin:/sbin:/bin",
    ...[project, work, repo].map((path) => `test ! -L ${quote(path)} && test -d ${quote(path)} || exit 1`),
  ];
  for (const name of ["config", "HEAD", "hooks", "info"]) {
    const path = quote(join(repo, name));
    commands.push(`test ! -L ${path}`);
    commands.push(name === "hooks" || name === "info" ? `mkdir -p -- ${path}` : `test -f ${path}`);
    commands.push(`chown -hRP -- ${quote(app)} ${path}`, `chmod -R go-w,a+rX -- ${path}`);
  }
  for (const name of ["objects", "refs", "logs", "worktrees"]) {
    const path = quote(join(repo, name));
    commands.push(
      `test ! -L ${path}`,
      `if test -d ${path}; then`,
      `  ${regroup("-hRP ", path)}`,
      `  chmod -R ${protectedMode ? "g+rwX" : "g-w"} -- ${path}`,
      `  find -P ${path} -type d -exec chmod ${protectedMode ? "g+s" : "g-s"} -- {} +`,
      "fi",
    );
  }
  const packedRefs = quote(join(repo, "packed-refs"));
  commands.push(
    `test ! -L ${packedRefs}`,
    `if test -f ${packedRefs}; then ${regroup("", packedRefs)}; chmod ${protectedMode ? "g+rw" : "g-w"} -- ${packedRefs}; fi`,
    `chown -- ${quote(app)}:${group} ${quote(repo)} ${quote(work)}`,
    `chmod ${protectedMode ? "3775" : "00755"} -- ${quote(repo)}`,
    `chmod ${protectedMode ? "2770" : "00700"} -- ${quote(work)}`,
    `find -P ${quote(work)} -mindepth 1 -maxdepth 1 -type d -exec chown -hRP -- ${owner}:${group} {} +`,
  );
  if (protectedMode) {
    commands.push(`setfacl -RP -m ${quote(`u:${app}:rwX,d:u:${app}:rwX`)} -- ${quote(repo)}`);
    commands.push(...traverseAclCommands(work, protectedUser).map((argv) => argv.map(quote).join(" ")));
  }
  return [...commands, ""].join("\n");
}
