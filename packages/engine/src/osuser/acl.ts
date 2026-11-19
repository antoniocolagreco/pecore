import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { appUser, baseEnv, run } from "../runners/process";

export function traverseAclCommands(target: string, user: string, from: string = sep): string[][] {
  if (process.platform === "darwin") throw new Error("not supported on macOS yet");
  if (!/^[a-zA-Z_][a-zA-Z0-9_.-]*\$?$/.test(user)) throw new Error("Invalid ACL user");
  if (!isAbsolute(target) || !isAbsolute(from)) throw new Error("ACL paths must be absolute");
  const first = resolve(from);
  const last = resolve(target);
  const path = relative(first, last);
  if (path === "" || path === ".." || path.startsWith(`..${sep}`)) {
    throw new Error("ACL target must be below the starting directory");
  }
  const commands: string[][] = [];
  for (let dir = dirname(last); ; dir = dirname(dir)) {
    if (dir !== sep) commands.push(["setfacl", "-m", `u:${user}:x`, "--", dir]);
    if (dir === first) return commands.reverse();
  }
}

export async function applyTraverseAcls(target: string, user: string, from?: string, remove = false): Promise<void> {
  const commands = traverseAclCommands(target, user, from).map((argv) => (remove ? ["setfacl", "-x", `u:${user}`, "--", argv.at(-1)!] : argv));
  const env = await baseEnv(appUser);
  for (const argv of commands) {
    const result = await run({ user: appUser, argv, env, cwd: sep });
    if (result.code !== 0) throw new Error(`setfacl failed for ${argv.at(-1)}: ${result.stderr.trim()}`);
  }
}
