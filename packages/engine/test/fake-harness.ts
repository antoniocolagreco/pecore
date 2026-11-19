import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BuiltInHarness } from "@pecore/schemas";

export type FakeHarness = {
  version: string;
  email: string | null;
  loginEmail?: string;
  defaultModel: string;
  models: Record<string, string[]>;
  variants?: boolean;
  cliModels?: string[];
};

const harness = String.raw`#!/usr/bin/env node
const fs = require("node:fs");
const readline = require("node:readline");
const name = require("node:path").basename(__filename);
const configFile = __filename + ".json";
const c = JSON.parse(fs.readFileSync(configFile, "utf8"));
const args = process.argv.slice(2);
if (args[0] === "--version") { process.stdout.write(c.version + "\n"); process.exit(0); }
if (args[0] === "models") {
  if (!c.cliModels) { process.stderr.write("not configured\n"); process.exit(1); }
  process.stdout.write(["Loading models", ...c.cliModels].join("\n") + "\n");
  process.exit(0);
}
if (args[0] === "login" && args[1] === "status") { process.stdout.write(c.email ? "Logged in\n" : "Not logged in\n"); process.exit(c.email ? 0 : 1); }
if (args[0] === "auth") {
  process.stdout.write("Open https://login.example.test/device\n");
  fs.writeFileSync(configFile, JSON.stringify({ ...c, email: c.loginEmail }));
  process.exit(0);
}
if (args[0] !== "acp") process.exit(2);
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
const select = (id, category, currentValue, values) => ({ id, name: id, category, type: "select", currentValue, options: values.map((value) => ({ value, name: value })) });
const configOptions = (model) => [
  select("model", "model", model, Object.keys(c.models)),
  ...(c.models[model].length ? [select("effort", "thought_level", c.models[model][0], c.models[model])] : []),
];
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.id === undefined) return;
  if (m.method === "initialize") {
    if (name === "claude") send({ method: "auth/status_update", params: c.email ? { state: "authenticated", accounts: [{ email: c.email, active: true }] } : { state: "unauthenticated" } });
    if (name === "codex") send({ method: "_auth/status_update", params: { authStatus: c.email ? { kind: "account", account: { email: c.email } } : { kind: "none" } } });
    send({ id: m.id, result: { protocolVersion: 1, agentCapabilities: {} } });
  } else if (m.method === "session/new" && c.variants) {
    const availableModels = Object.entries(c.models).flatMap(([model, efforts]) => efforts.map((effort) => ({ modelId: model + "[" + effort + "]", name: model })));
    send({ id: m.id, result: { sessionId: "s1", models: { currentModelId: c.defaultModel + "[" + c.models[c.defaultModel][1] + "]", availableModels } } });
  } else if (m.method === "session/new") {
    send({ id: m.id, result: { sessionId: "s1", configOptions: configOptions(c.defaultModel) } });
  } else if (m.method === "session/set_config_option" && m.params.configId === "model" && c.models[m.params.value]) {
    send({ id: m.id, result: { configOptions: configOptions(m.params.value) } });
  } else {
    send({ id: m.id, error: { code: -32601, message: m.method + " not supported" } });
  }
});
`;

const programs: Record<BuiltInHarness, string> = { "claude-code": "claude", codex: "codex", opencode: "opencode" };

export async function fakeHarnesses(root: string): Promise<{ connectorsDir: string; set: (name: BuiltInHarness, value: FakeHarness | null) => Promise<void> }> {
  const bin = join(root, "bin");
  const connectorsDir = join(root, "connectors");
  await mkdir(bin, { recursive: true });
  await mkdir(connectorsDir, { recursive: true });
  const login = { loginCommand: ["{harnessPath}", "auth", "login"], loginUrlPattern: "https://\\S+", loginReadsCode: false };
  await writeFile(join(connectorsDir, "claude-code.json"), JSON.stringify({
    name: "claude-code", title: "Claude Code", kind: "native",
    harness: { program: join(bin, "claude"), versionArgs: ["--version"], versionRange: ">=2.1.327" },
    command: ["{harnessPath}", "acp"], reader: "claude-code", ...login,
  }));
  await writeFile(join(connectorsDir, "codex.json"), JSON.stringify({
    name: "codex", title: "Codex", kind: "native",
    harness: { program: join(bin, "codex"), versionArgs: ["--version"], versionRange: ">=0.169.0" },
    command: ["{harnessPath}", "acp"], reader: "codex", ...login,
    identityCommand: ["{harnessPath}", "login", "status"], identityLoggedOutText: "Not logged in",
  }));
  await writeFile(join(connectorsDir, "opencode.json"), JSON.stringify({
    name: "opencode", title: "OpenCode", kind: "native",
    harness: { program: join(bin, "opencode"), versionArgs: ["--version"], versionRange: ">=2.3.0" },
    command: ["{harnessPath}", "acp"], reader: "opencode", ...login,
  }));
  const set = async (name: BuiltInHarness, value: FakeHarness | null): Promise<void> => {
    const file = join(bin, programs[name]);
    if (value === null) {
      await rm(file, { force: true });
      await rm(`${file}.json`, { force: true });
      return;
    }
    await writeFile(`${file}.json`, JSON.stringify(value));
    await writeFile(file, harness);
    await chmod(file, 0o755);
  };
  return { connectorsDir, set };
}
