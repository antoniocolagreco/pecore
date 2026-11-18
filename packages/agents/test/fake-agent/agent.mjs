import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";

const scripts = process.env.FAKE_AGENT_SCRIPT.split(",");
const counter = `${scripts[0]}.count`;
const n = existsSync(counter) ? Number(readFileSync(counter, "utf8")) : 0;
writeFileSync(counter, String(n + 1));
const steps = readFileSync(scripts[Math.min(n, scripts.length - 1)], "utf8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));

const inbox = [];
const waiting = [];
let lastId = null;

createInterface({ input: process.stdin }).on("line", (line) => {
  const msg = JSON.parse(line);
  const w = waiting.shift();
  if (w) w(msg);
  else inbox.push(msg);
});
process.stdin.on("end", () => {
  const w = waiting.shift();
  if (w) w(null);
  else inbox.push(null);
});

const next = () => (inbox.length ? Promise.resolve(inbox.shift()) : new Promise((r) => waiting.push(r)));

const withId = (value) => JSON.parse(JSON.stringify(value).replaceAll('"$id"', JSON.stringify(lastId)));

for (const step of steps) {
  if ("expect" in step) {
    for (;;) {
      const msg = await next();
      if (msg === null) process.exit(0);
      if (msg.method === step.expect || (step.expect === "response" && msg.method === undefined)) {
        if (msg.id !== undefined && msg.method !== undefined) lastId = msg.id;
        break;
      }
      if (step.strict) {
        process.stderr.write(`expected ${step.expect}, got ${msg.method}\n`);
        process.exit(3);
      }
    }
  } else if ("send" in step) {
    process.stdout.write(JSON.stringify(withId(step.send)) + "\n");
  } else if ("write" in step) {
    const path = resolve(process.cwd(), step.write.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, step.write.content);
  } else if ("sleep" in step) {
    await new Promise((r) => setTimeout(r, step.sleep));
  } else if ("exit" in step) {
    process.exit(step.exit);
  } else if ("stderr" in step) {
    process.stderr.write(step.stderr + "\n");
  }
}
for (;;) {
  const msg = await next();
  if (msg === null) process.exit(0);
}
