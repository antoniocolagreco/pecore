import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { appendFileSync, writeFileSync } from "node:fs";

const [, , logPath, cmd, ...args] = process.argv;
const cwd = new URL("./work/", import.meta.url).pathname;
const turns = (process.env.TURNS ?? "Rispondi solo ok").split("|");
writeFileSync(logPath, "");
const log = (dir, msg) => appendFileSync(logPath, JSON.stringify({ dir, msg }) + "\n");

const child = spawn(cmd, args, { cwd, stdio: ["pipe", "pipe", "pipe"], env: process.env });
child.stderr.on("data", (d) => appendFileSync(logPath + ".err", d));
child.on("exit", (code, sig) => console.log("EXIT", code, sig));

let nextId = 1;
const pending = new Map();
const send = (msg) => { log("out", msg); child.stdin.write(JSON.stringify(msg) + "\n"); };
const request = (method, params) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  send({ jsonrpc: "2.0", id, method, params });
});

createInterface({ input: child.stdout }).on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { log("raw", line); return; }
  log("in", msg);
  if (msg.id !== undefined && !msg.method) {
    const p = pending.get(msg.id); pending.delete(msg.id);
    msg.error ? p.reject(msg.error) : p.resolve(msg.result);
    return;
  }
  if (msg.method === "session/request_permission") {
    const opt = msg.params.options.find((o) => o.kind === "allow_once") ?? msg.params.options[0];
    console.log("PERMISSION", msg.params.toolCall?.title, "->", opt.optionId, JSON.stringify(msg.params.options.map((o) => o.kind)));
    send({ jsonrpc: "2.0", id: msg.id, result: { outcome: { outcome: "selected", optionId: opt.optionId } } });
    return;
  }
  if (msg.method === "session/update") {
    const u = msg.params.update;
    if (u.sessionUpdate === "agent_message_chunk") process.stdout.write(u.content?.text ?? "");
    else if (u.sessionUpdate === "usage_update") console.log("\nUSAGE", JSON.stringify(u));
    else if (u.sessionUpdate === "tool_call") console.log("\nTOOL_CALL", u.title);
    return;
  }
  if (msg.id !== undefined) {
    console.log("UNHANDLED REQUEST", msg.method);
    send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "not supported" } });
  }
});

try {
  const init = await request("initialize", { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } });
  console.log("INIT", JSON.stringify({ agentInfo: init.agentInfo, authMethods: init.authMethods?.map((a) => a.id), caps: init.agentCapabilities }));
  const s = await request("session/new", { cwd, mcpServers: [] });
  console.log("SESSION", s.sessionId, JSON.stringify({ models: s.models?.availableModels?.map((m) => m.modelId), current: s.models?.currentModelId, modes: s.modes?.availableModes?.map((m) => m.id), config: s.configOptions?.map((c) => c.id) }));
  for (const pair of (process.env.OPTS ?? "").split(",").filter(Boolean)) {
    const [configId, value] = pair.split("=");
    const r = await request("session/set_config_option", { sessionId: s.sessionId, configId, value });
    console.log("SET", configId, value, JSON.stringify(r?.configOptions?.find((c) => c.id === configId)?.currentValue));
  }
  for (const text of turns) {
    const r = await request("session/prompt", { sessionId: s.sessionId, prompt: [{ type: "text", text }] });
    console.log("\nSTOP", JSON.stringify(r));
  }
} catch (e) {
  console.log("\nERROR", JSON.stringify(e));
}
child.stdin.end();
setTimeout(() => child.kill(), 3000);
