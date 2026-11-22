import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";

const [file] = process.argv.slice(2);
if (!file || process.argv.length !== 3) throw new Error("expected the MCP token file path");

const credentials = async () => JSON.parse(await readFile(file, "utf8"));
const send = (body, { url, token }) => fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}` },
  body,
  redirect: "error",
});
const output = async (message) => {
  if (!process.stdout.write(message + "\n")) await once(process.stdout, "drain");
};
let auth;
for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    await output(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }));
    continue;
  }
  try {
    auth ??= await credentials();
    let response = await send(line, auth);
    if (response.status === 401) {
      await response.body?.cancel();
      auth = await credentials();
      response = await send(line, auth);
    }
    if (!response.ok) throw new Error(`MCP endpoint returned HTTP ${response.status}`);
    const body = await response.text();
    if (body) await output(body);
  } catch {
    if (request && Object.hasOwn(request, "id")) {
      await output(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: "MCP endpoint unavailable" } }));
    }
  }
}
