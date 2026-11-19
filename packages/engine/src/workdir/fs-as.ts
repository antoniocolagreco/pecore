import { isAbsolute, normalize } from "node:path";
import { baseEnv, run } from "../runners/process";

export class FsAsError extends Error {
  constructor(
    readonly path: string,
    readonly reason: "symlink" | "missing" | "outside" | "failed",
    detail = "",
  ) {
    super(`${reason}: ${path}${detail ? ` (${detail})` : ""}`);
  }
}

const SYMLINK = 3;
const MISSING = 4;

function relPath(rel: string): string {
  const n = normalize(rel);
  if (isAbsolute(n) || n === ".." || n.startsWith("../")) throw new FsAsError(rel, "outside");
  return n;
}

const noLinks = `cd "$1" || exit ${MISSING}; p="$2"; while [ "$p" != "." ] && [ "$p" != "/" ]; do if [ -L "$p" ]; then exit ${SYMLINK}; fi; p=$(dirname -- "$p"); done`;

async function sh(user: string, root: string, rel: string, body: string, extra: string[] = [], input?: string | Buffer) {
  const r = await run({
    user,
    cwd: "/",
    env: await baseEnv(user),
    argv: ["/bin/sh", "-c", `${noLinks}; ${body}`, "sh", root, rel, ...extra],
    ...(input !== undefined ? { input } : {}),
  });
  if (r.code === SYMLINK) throw new FsAsError(rel, "symlink");
  return r;
}

function fail(rel: string, r: { code: number | null; stderr: string }): never {
  if (r.code === MISSING) throw new FsAsError(rel, "missing");
  throw new FsAsError(rel, "failed", r.stderr.trim());
}

export async function readFileAs(user: string, root: string, rel: string): Promise<string> {
  const r = await sh(user, root, relPath(rel), `[ -f "$2" ] || exit ${MISSING}; exec cat -- "$2"`);
  if (r.code !== 0) fail(rel, r);
  return r.stdout;
}

export async function existsAs(user: string, root: string, rel: string): Promise<boolean> {
  const r = await sh(user, root, relPath(rel), `[ -e "$2" ] || exit ${MISSING}`);
  if (r.code === MISSING) return false;
  if (r.code !== 0) fail(rel, r);
  return true;
}

export async function writeFileAs(user: string, root: string, rel: string, content: string | Buffer, mode?: 0o600): Promise<void> {
  const write: string = mode === undefined ? 'cat > "$2"' : [
    '[ ! -d "$2" ] || exit 1',
    'tmp=$(mktemp "$(dirname -- "$2")/.pecore-XXXXXX") || exit 1',
    'trap \'rm -f -- "$tmp"\' EXIT',
    'cat > "$tmp" && chmod 600 "$tmp" && mv -f -- "$tmp" "$2"',
  ].join("; ");
  const r = await sh(user, root, relPath(rel), `${mode === undefined ? "" : "umask 077; "}mkdir -p -- "$(dirname -- "$2")" || exit 1; p="$2"; while [ "$p" != "." ]; do if [ -L "$p" ]; then exit ${SYMLINK}; fi; p=$(dirname -- "$p"); done; ${write}`, [], content);
  if (r.code !== 0) fail(rel, r);
}

export async function mkdirAs(user: string, root: string, rel: string): Promise<void> {
  const r = await sh(user, root, relPath(rel), 'mkdir -p -- "$2"');
  if (r.code !== 0) fail(rel, r);
}

export async function removeAs(user: string, root: string, rel: string): Promise<void> {
  const r = await sh(user, root, relPath(rel), 'rm -rf -- "$2"');
  if (r.code !== 0) fail(rel, r);
}

export async function removeFilesAs(user: string, root: string, files: string[]): Promise<void> {
  if (files.length === 0) return;
  const rels = files.map(relPath);
  const r = await sh(
    user,
    root,
    ".",
    `shift 2; for f in "$@"; do p=$(dirname -- "$f"); while [ "$p" != "." ]; do if [ -L "$p" ]; then exit ${SYMLINK}; fi; p=$(dirname -- "$p"); done; find -P "$f" -maxdepth 0 \\( -type f -o -type l \\) -delete || exit 1; done`,
    rels,
  );
  if (r.code !== 0) fail(root, r);
}
