import { spawn, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const [, , configPath, logPath] = process.argv;
const c = JSON.parse(readFileSync(configPath, "utf8"));
writeFileSync(logPath, "");
const at = () => new Date().toISOString();
const log = (o) => appendFileSync(logPath, JSON.stringify({ ...o, at: at() }) + "\n");
const ps = (pgid) => {
  try {
    const out = execFileSync("ps", ["-u", c.as ?? process.env.USER, "-o", "pid,ppid,pgid,sid,user,args"], { encoding: "utf8" }).split("\n");
    return [out[0], ...out.slice(1).filter((l) => c.as || l.trim().split(/\s+/)[2] === String(pgid))].join("\n");
  } catch { return "(none)\n"; }
};

const vars = Object.entries(c.env).map(([k, v]) => `${k}=${v}`);
const [cmd, args] = c.as
  ? ["sudo", ["-n", "-H", "-u", c.as, "--", ...(c.setsid ? ["/usr/bin/setsid"] : []), "/bin/sh", "-c", 'echo "PECORE_PID $$" >&2; exec env -i "$@"', "sh", ...vars, ...c.argv]]
  : ["env", ["-i", ...vars, ...c.argv]];
const child = spawn(cmd, args, { cwd: c.cwd, detached: true, stdio: ["pipe", "pipe", "pipe"] });
child.on("exit", (code, signal) => console.log("EXIT", code, signal));

const pid = new Promise((resolve, reject) => {
  if (!c.as) return resolve(child.pid);
  const t = setTimeout(() => reject(new Error("no pid line in 5 s")), 5000);
  let first = true;
  createInterface({ input: child.stderr }).on("line", (line) => {
    if (first) {
      first = false;
      const m = /^PECORE_PID (\d+)$/.exec(line);
      clearTimeout(t);
      return m ? resolve(Number(m[1])) : reject(new Error("bad first line: " + line));
    }
    log({ dir: "err", line });
  });
});
if (!c.as) createInterface({ input: child.stderr }).on("line", (line) => log({ dir: "err", line }));
const pgidOf = (p) => Number(execFileSync("ps", ["-o", "pgid=", "-p", String(p)], { encoding: "utf8" }).trim());

let nextId = 1;
const pending = new Map();
const send = (msg) => { log({ dir: "out", msg }); child.stdin.write(JSON.stringify(msg) + "\n"); };
const request = (method, params) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  send({ jsonrpc: "2.0", id, method, params });
});

createInterface({ input: child.stdout }).on("line", (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { log({ dir: "err", line }); return; }
  log({ dir: "in", msg });
  if (msg.id !== undefined && !msg.method) {
    const p = pending.get(msg.id); pending.delete(msg.id);
    msg.error ? p.reject(msg.error) : p.resolve(msg.result);
    return;
  }
  if (msg.method === "session/request_permission") {
    console.log("PERMISSION", msg.params.toolCall?.title);
    const opt = msg.params.options.find((o) => o.kind === "allow_once") ?? msg.params.options[0];
    send({ jsonrpc: "2.0", id: msg.id, result: { outcome: { outcome: "selected", optionId: opt.optionId } } });
    return;
  }
  if (msg.method === "_claude/sdkMessage" && msg.params?.message?.subtype === "init") {
    const m = msg.params.message;
    console.log("SDK_INIT", JSON.stringify({ mcp_servers: m.mcp_servers, tools: m.tools?.length, permissionMode: m.permissionMode, model: m.model, claude_code_version: m.claude_code_version }));
    return;
  }
  if (msg.method === "session/update") {
    const u = msg.params.update;
    if (u.sessionUpdate === "agent_message_chunk") process.stdout.write(u.content?.text ?? "");
    else if (u.sessionUpdate === "tool_call") console.log("\nTOOL_CALL", u.title);
    return;
  }
  if (msg.id !== undefined) send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "not supported" } });
});

const stopGroup = async (pgid) => {
  const kill = (sig) => c.as
    ? execFileSync("sudo", ["-n", "-u", c.as, "kill", "-s", sig, "--", `-${pgid}`])
    : process.kill(-pgid, sig);
  console.log("\nSTOP TERM", pgid); kill("TERM");
  await new Promise((r) => setTimeout(r, 5000));
  try { kill("KILL"); console.log("STOP KILL sent"); } catch { console.log("STOP group already gone"); }
  await new Promise((r) => setTimeout(r, 1000));
  console.log("PS AFTER STOP\n" + ps(pgid));
};

try {
  const p = await pid;
  const pgid = pgidOf(p);
  console.log("PID", p, "PGID", pgid, "SUDO_PID", child.pid);
  const init = await request("initialize", { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } });
  console.log("INIT", JSON.stringify({ agentInfo: init.agentInfo, caps: init.agentCapabilities?.sessionCapabilities && Object.keys(init.agentCapabilities.sessionCapabilities), load: init.agentCapabilities?.loadSession }));
  let sessionId = c.resume;
  if (sessionId) {
    const r = await request("session/resume", { sessionId, cwd: c.cwd, mcpServers: [], _meta: c.newMeta });
    console.log("RESUMED", sessionId, JSON.stringify(r?.modes?.currentModeId));
  } else {
    const s = await request("session/new", { cwd: c.cwd, mcpServers: [], _meta: c.newMeta });
    sessionId = s.sessionId;
    console.log("SESSION", sessionId, JSON.stringify({ modes: s.modes?.availableModes?.map((m) => m.id), current: s.modes?.currentModeId }));
  }
  for (const [configId, value] of Object.entries(c.opts ?? {})) {
    const r = await request("session/set_config_option", { sessionId, configId, value });
    console.log("SET", configId, value, JSON.stringify(r?.configOptions?.find((o) => o.id === configId)?.currentValue));
  }
  console.log("PS\n" + ps(pgid));
  for (const text of c.turns) {
    const turn = request("session/prompt", { sessionId, prompt: [{ type: "text", text }] });
    if (c.stopAfterMs) {
      await new Promise((r) => setTimeout(r, c.stopAfterMs));
      console.log("\nPS BEFORE STOP\n" + ps(pgid));
      await stopGroup(pgid);
      break;
    }
    console.log("\nSTOP", JSON.stringify(await turn));
  }
} catch (e) {
  console.log("\nERROR", e instanceof Error ? e.message : JSON.stringify(e));
}
child.stdin.end();
setTimeout(() => process.exit(0), 3000);
