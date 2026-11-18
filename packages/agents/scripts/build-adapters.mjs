import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pins = JSON.parse(readFileSync(join(root, "adapters.json"), "utf8"));
const out = join(root, "out", "adapters");
const platform = process.env.PECORE_TARGET_PLATFORM ?? process.platform;
const arch = process.env.PECORE_TARGET_ARCH ?? process.arch;

mkdirSync(out, { recursive: true });

for (const [pkg, { version }] of Object.entries(pins.adapters)) {
  const dir = join(out, `${pkg}@${version}`);
  if (existsSync(join(dir, "node_modules", pkg, "package.json"))) continue;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  execFileSync("npm", ["install", "--omit=optional", "--no-package-lock", "--no-audit", "--no-fund", "--prefix", dir, `${pkg}@${version}`], { stdio: "inherit" });
}

const nodeVersion = pins.node.version;
const nodeDir = join(out, "node");
const versionFile = join(nodeDir, "pecore-version");
if (!existsSync(versionFile) || readFileSync(versionFile, "utf8").trim() !== `${nodeVersion}-${platform}-${arch}`) {
  const os = platform === "darwin" ? "darwin" : "linux";
  const file = `node-${nodeVersion}-${os}-${arch}.tar.${os === "darwin" ? "gz" : "xz"}`;
  const base = `https://nodejs.org/dist/${nodeVersion}`;
  const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text();
  const expected = sums.split("\n").find((l) => l.endsWith(`  ${file}`))?.split(/\s+/)[0];
  if (!expected) throw new Error(`no checksum for ${file}`);
  const data = Buffer.from(await (await fetch(`${base}/${file}`)).arrayBuffer());
  const actual = createHash("sha256").update(data).digest("hex");
  if (actual !== expected) throw new Error(`checksum mismatch for ${file}`);
  rmSync(nodeDir, { recursive: true, force: true });
  mkdirSync(nodeDir, { recursive: true });
  const archive = join(out, file);
  writeFileSync(archive, data);
  execFileSync("tar", [os === "darwin" ? "-xzf" : "-xJf", archive, "-C", nodeDir, "--strip-components=1"]);
  rmSync(archive);
  writeFileSync(versionFile, `${nodeVersion}-${platform}-${arch}\n`);
}
console.log(`adapters ready in ${out}`);
