import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tempDir } from "./tmp";

const gitleaks = String.raw`#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
fs.appendFileSync(path.join(__dirname, "..", "calls.log"), JSON.stringify(args) + "\n");
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (args[0] !== "dir") { process.stderr.write("unknown command\n"); process.exit(2); }
const root = args[1];
const findings = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else fs.readFileSync(p, "utf8").split("\n").forEach((text, i) => {
      const m = /ghp_[A-Za-z0-9]{36}/.exec(text);
      if (m) findings.push({ RuleID: "github-pat", File: p, StartLine: i + 1, Secret: m[0], Match: m[0], Fingerprint: p + ":github-pat:" + (i + 1) });
    });
  }
};
walk(root);
fs.writeFileSync(flag("--report-path"), JSON.stringify(findings));
process.exit(findings.length && flag("--exit-code") !== "0" ? 1 : 0);
`;

export async function fakeGitleaks(): Promise<{ bin: string; calls: () => Promise<string[][]> }> {
  const dir = await tempDir();
  const bin = join(dir, "bin");
  await mkdir(bin);
  await writeFile(join(bin, "gitleaks"), gitleaks);
  await chmod(join(bin, "gitleaks"), 0o755);
  return {
    bin,
    calls: async () =>
      (await readFile(join(dir, "calls.log"), "utf8").catch(() => ""))
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as string[]),
  };
}
