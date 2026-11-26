import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseConnector } from "./connectors";
import { classify } from "./errors";
import { checkLogin, listOptions, prepareLogin } from "./index";
import { piReader } from "./readers/pi";
import { replaySpawn, login, processSpawn, readFixture, resolved } from "../test/helpers";

const init = [{ expect: "initialize" }, { send: { jsonrpc: "2.0", id: "$id", result: { protocolVersion: 1, agentCapabilities: {} } } }];

function script(steps: object[]): string {
  const dir = mkdtempSync(join(tmpdir(), "pecore-pi-"));
  const file = join(dir, "script.jsonl");
  writeFileSync(file, steps.map((s) => JSON.stringify(s)).join("\n") + "\n");
  return file;
}

const connector = resolved({ name: "pi", title: "pi", reader: "pi", sessionConfig: [["model", "{model}"], ["thought_level", "{effort}"]] });
const configDir = mkdtempSync(join(tmpdir(), "pecore-pi-login-"));
mkdirSync(join(configDir, "probe"), { recursive: true });
const probeLogin = { ...login, configDir, home: configDir };

describe("pi connector", () => {
  it("reads the models and efforts of the ACP session, without an identity notification", async () => {
    const options = {
      sessionId: "s1",
      configOptions: [
        { id: "model", name: "Model", category: "model", currentValue: "fake/model", options: [{ value: "fake/model", name: "Model" }, { value: "fake/max", name: "Max" }] },
        { id: "thought_level", name: "Thinking", category: "thought_level", currentValue: "high", options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }, { value: "max", name: "Max" }] },
      ],
    };
    const spawn = processSpawn({ FAKE_AGENT_SCRIPT: script([...init, { expect: "session/new" }, { send: { jsonrpc: "2.0", id: "$id", result: options } }]) });
    expect(await listOptions({ connector, login: probeLogin, spawn, allowUnknownIdentity: true })).toEqual({
      models: ["fake/model", "fake/max"],
      efforts: ["low", "high", "max"],
      defaultModel: "fake/model",
    });
  });

  it("treats the adapter's Authentication required error as logged out", async () => {
    const spawn = processSpawn({
      FAKE_AGENT_SCRIPT: script([...init, { expect: "session/new" }, { send: { jsonrpc: "2.0", id: "$id", error: { code: -32000, message: "Authentication required: Configure an API key or log in with an OAuth provider." } } }]),
    });
    expect(await checkLogin({ connector, login: probeLogin, spawn })).toEqual({ state: "logged_out" });
  });

  it("reads the model from a config option update", () => {
    expect(piReader.notification("session/update", {
      update: { sessionUpdate: "config_option_update", configOptions: [{ id: "model", category: "model", currentValue: "fake/model" }] },
    })).toEqual({ model: "fake/model" });
  });

  it("runs pi's own interactive login through the adapter in a pseudo-terminal", () => {
    const file = fileURLToPath(new URL("../../app/resources/connectors/pi.json", import.meta.url));
    const { connector: shipped } = parseConnector(JSON.parse(readFileSync(file, "utf8")));
    const pins = JSON.parse(readFileSync(fileURLToPath(new URL("../adapters.json", import.meta.url)), "utf8")) as { adapters: Record<string, { version: string; entry: string }> };
    const adapter = `/tmp/adapters/pi-acp@${pins.adapters["pi-acp"]!.version}/node_modules/pi-acp/${pins.adapters["pi-acp"]!.entry}`;
    const base = { ...resolved(shipped!), adapters: pins.adapters, adaptersDir: "/tmp/adapters" };
    const plan = prepareLogin({ connector: { ...base, platform: "linux" }, login: probeLogin });
    expect(plan.command.argv).toEqual(["script", "-qefc", 'exec "$PECORE_PI_NODE" "$PECORE_PI_ADAPTER" --terminal-login', "/dev/null"]);
    expect(plan.command.env.PECORE_PI_NODE).toBe(process.execPath);
    expect(plan.command.env.PECORE_PI_ADAPTER).toBe(adapter);
    expect(plan.command.env.PI_ACP_PI_COMMAND).toBe(process.execPath);
    expect(plan.readsCode).toBe(true);
    expect(prepareLogin({ connector: { ...base, platform: "darwin" }, login: probeLogin }).command.argv).toEqual([
      "script", "-q", "/dev/null", process.execPath, adapter, "--terminal-login",
    ]);
  });

  it("classifies the adapter's auto retry as a rate limit wait", () => {
    const file = fileURLToPath(new URL("../../app/resources/connectors/pi.json", import.meta.url));
    const { connector: shipped } = parseConnector(JSON.parse(readFileSync(file, "utf8")));
    expect(classify({ stopReason: "end_turn", text: "Retrying (attempt 2/3, waiting 4s)...", rules: shipped!.errors, at: 1000 })).toMatchObject({ kind: "rate_limit" });
    expect(classify({ stopReason: "end_turn", text: "You've hit your usage limit. Try again later.", rules: shipped!.errors, at: 1000 })).toMatchObject({ kind: "quota" });
  });

  it("reads a recorded retry turn through the pi reader", async () => {
    const lines = readFixture(fileURLToPath(new URL("../fixtures/pi/retry.jsonl", import.meta.url)));
    const outs = lines.filter((l) => l.dir === "out").map((l) => l.msg!);
    const prompts = outs.filter((m) => m.method === "session/prompt").map((m) => ((m.params as { prompt: { text: string }[] }).prompt[0]!.text));
    const session = await (await import("./session")).startSession({ connector, login: probeLogin, spawn: replaySpawn(lines), cwd: "/tmp", model: "" });
    const result = await session.prompt(prompts[0]!);
    await session.close();
    expect(result.text).toContain("Retrying (attempt");
  });
});
