import { createServer } from "node:http";
import type { Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { apiProject } from "../../test/api-project";
import { tempDir } from "../../test/tmp";
import { checkTrackerBridge, setBrowserOpener, setMcpHome, trackerBridgeTool, trackerIdentity } from "./native-mcp";
import { TrackerMcpAuthError, TrackerMcpUnavailableError, trackerServers } from "./tracker-mcp";

const original = { ...trackerServers.atlassian };
const originalLinear = { ...trackerServers.linear };
let server: Server | undefined;

afterEach(async () => {
  setBrowserOpener(null);
  trackerServers.atlassian.url = original.url;
  trackerServers.atlassian.authHost = original.authHost;
  trackerServers.linear.url = originalLinear.url;
  trackerServers.linear.authHost = originalLinear.authHost;
  await new Promise<void>((resolve) => server ? server.close(() => resolve()) : resolve());
  server = undefined;
});

afterAll(async () => { await new Promise<void>((resolve) => server ? server.close(() => resolve()) : resolve()); });

function json(response: ServerResponse, body: unknown, status = 200): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function rpc(id: unknown, result: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}

type TokenMode = "ok" | "503" | "invalid_grant" | "network";
type StateMode = "ok" | "wrong";

async function mockMcp(): Promise<{ base: string; control: { tokenMode: TokenMode; stateMode: StateMode; hang: boolean; tokenRequests: number; unauthorized: boolean; workspace: string } }> {
  const control: { tokenMode: TokenMode; stateMode: StateMode; hang: boolean; tokenRequests: number; unauthorized: boolean; workspace: string } = { tokenMode: "ok", stateMode: "ok", hang: false, tokenRequests: 0, unauthorized: false, workspace: "workspace-one" };
  const http = createServer((request, response) => {
    const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
    const url = new URL(request.url ?? "/", base);
    if (url.pathname === "/mcp") {
      if (control.hang) return;
      const auth = request.headers.authorization;
      if (control.unauthorized || (auth !== "Bearer test-access" && auth !== "Bearer refreshed-access")) {
        response.writeHead(401, { "WWW-Authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` });
        response.end();
        return;
      }
      response.setHeader("Content-Type", "application/json");
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (part) => { body += part; });
      request.on("end", () => {
        const message = JSON.parse(body || "{}") as { id?: unknown; method?: string; params?: { name?: string } };
        if (message.id === undefined) {
          response.writeHead(202);
          response.end();
          return;
        }
        if (message.method === "initialize") {
          response.end(rpc(message.id, { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "mock", version: "1" } }));
          return;
        }
        if (message.method === "tools/list") {
          response.end(rpc(message.id, { tools: [
            { name: "atlassianUserInfo", description: "", inputSchema: { type: "object" } },
            { name: "getAccessibleAtlassianResources", description: "", inputSchema: { type: "object" } },
            { name: "forbidden", description: "", inputSchema: { type: "object" } },
          ] }));
          return;
        }
        if (message.method === "tools/call") {
          const name = message.params?.name;
          if (name === "forbidden") {
            response.end(rpc(message.id, { content: [{ type: "text", text: "Permission denied" }], isError: true }));
            return;
          }
          const value = name === "getAccessibleAtlassianResources"
            ? { resources: [{ url: "https://team.atlassian.net", products: [{ id: "jira" }] }] }
            : name === "whoami"
              ? { data: { user: { email: "alice@example.test" }, workspace: { name: control.workspace } } }
              : { data: { accountId: "alice" } };
          response.end(rpc(message.id, { content: [{ type: "text", text: JSON.stringify(value) }], isError: false }));
          return;
        }
        response.end(rpc(message.id, {}));
      });
      return;
    }
    if (url.pathname === "/.well-known/oauth-protected-resource" || url.pathname === "/.well-known/oauth-protected-resource/mcp") {
      json(response, { resource: `${base}/mcp`, authorization_servers: [base] });
      return;
    }
    if (url.pathname === "/.well-known/oauth-authorization-server" || url.pathname === "/.well-known/openid-configuration") {
      json(response, {
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      });
      return;
    }
    if (url.pathname === "/register") {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (part) => { body += part; });
      request.on("end", () => {
        json(response, {
          client_id: "test-client",
          client_id_issued_at: 1,
          redirect_uris: (JSON.parse(body) as { redirect_uris: string[] }).redirect_uris,
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
        });
      });
      return;
    }
    if (url.pathname === "/authorize") {
      const redirect = url.searchParams.get("redirect_uri")!;
      const state = control.stateMode === "wrong" ? "wrong-state" : url.searchParams.get("state");
      response.writeHead(302, { Location: `${redirect}?code=test-code${state ? `&state=${encodeURIComponent(state)}` : ""}` });
      response.end();
      return;
    }
    if (url.pathname === "/token") {
      control.tokenRequests++;
      if (control.tokenMode === "network") {
        request.socket.destroy();
        return;
      }
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (part) => { body += part; });
      request.on("end", () => {
        if (control.tokenMode === "503") {
          response.writeHead(503, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: "temporarily_unavailable" }));
          return;
        }
        if (control.tokenMode === "invalid_grant") {
          response.writeHead(400, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: "invalid_grant" }));
          return;
        }
        const form = new URLSearchParams(body);
        const refreshed = form.get("grant_type") === "refresh_token";
        json(response, { access_token: refreshed ? "refreshed-access" : "test-access", token_type: "bearer", expires_in: 3600, refresh_token: "test-refresh", scope: "read write" });
      });
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(0, "127.0.0.1", resolve);
  });
  server = http;
  return { base: `http://127.0.0.1:${(http.address() as AddressInfo).port}`, control };
}

async function fileExists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
}

it("reports authentication without opening a browser or registering a client when no tokens exist", async () => {
  const mock = await mockMcp();
  trackerServers.atlassian.url = `${mock.base}/mcp`;
  const home = await tempDir();
  setMcpHome(home);
  await expect(trackerBridgeTool("atlassian", "atlassian", "atlassianUserInfo", {})).rejects.toThrow("Sign in to Atlassian");
  expect(await fileExists(join(home, "mcp", "atlassian", "client.json"))).toBe(false);
});

async function login(mock: { base: string }, home: string): Promise<void> {
  trackerServers.atlassian.url = `${mock.base}/mcp`;
  trackerServers.atlassian.authHost = new URL(mock.base).hostname;
  setMcpHome(home);
  await checkTrackerBridge("atlassian", "atlassian", {
    interactive: true,
    onAuthorize: (url) => { if (url) void fetch(url); },
  });
}

it("logs in through native OAuth, stores secure files and reconnects without a browser", async () => {
  const opened = vi.fn();
  setBrowserOpener(opened);
  const mock = await mockMcp();
  const home = await tempDir();
  await login(mock, home);
  const tokenFile = join(home, "mcp", "atlassian", "tokens.json");
  const clientFile = join(home, "mcp", "atlassian", "client.json");
  const tokens = JSON.parse(await readFile(tokenFile, "utf8")) as { access_token: string; refresh_token: string };
  expect(tokens.access_token).toBe("test-access");
  expect(tokens.refresh_token).toBe("test-refresh");
  expect((await stat(tokenFile)).mode & 0o777).toBe(0o600);
  expect((await stat(clientFile)).mode & 0o777).toBe(0o600);
  const client = JSON.parse(await readFile(clientFile, "utf8")) as { redirect_uris: string[] };
  expect(client.redirect_uris[0]).not.toContain(":0/");
  expect((await stat(join(home, "mcp", "atlassian"))).mode & 0o777).toBe(0o700);

  const result = await trackerBridgeTool("atlassian", "atlassian", "getAccessibleAtlassianResources", {});
  expect(result).toEqual({ resources: [{ url: "https://team.atlassian.net", products: [{ id: "jira" }] }] });
});

it("opens the browser for a Linear sign-in and combines user and workspace in the identity", async () => {
  const opened = vi.fn();
  setBrowserOpener(opened);
  const mock = await mockMcp();
  trackerServers.linear.url = `${mock.base}/mcp`;
  trackerServers.linear.authHost = new URL(mock.base).hostname;
  const home = await tempDir();
  setMcpHome(home);
  await checkTrackerBridge("linear", "linear", {
    interactive: true,
    onAuthorize: (url) => { if (url) void fetch(url); },
  });
  expect(originalLinear.authHost).toBe("mcp.linear.app");
  expect(opened).toHaveBeenCalled();
  expect(await trackerIdentity("linear", "linear")).toBe("alice@example.test @ workspace-one");
  mock.control.workspace = "workspace-two";
  expect(await trackerIdentity("linear", "linear")).toBe("alice@example.test @ workspace-two");
});

it("refreshes an expired access token and preserves the session", async () => {
  const mock = await mockMcp();
  const home = await tempDir();
  await login(mock, home);
  const tokenFile = join(home, "mcp", "atlassian", "tokens.json");
  const tokens = JSON.parse(await readFile(tokenFile, "utf8")) as { access_token: string; refresh_token: string };
  await writeFile(tokenFile, JSON.stringify({ ...tokens, access_token: "invalid-access" }, null, 2) + "\n", { mode: 0o600 });
  await trackerBridgeTool("atlassian", "atlassian", "atlassianUserInfo", {});
  const refreshed = JSON.parse(await readFile(tokenFile, "utf8")) as { access_token: string; refresh_token: string };
  expect(refreshed.access_token).toBe("refreshed-access");
  expect(refreshed.refresh_token).toBe("test-refresh");
});

it("serializes concurrent refreshes and keeps a Check browser-free", async () => {
  const mock = await mockMcp();
  const home = await tempDir();
  await login(mock, home);
  const tokenFile = join(home, "mcp", "atlassian", "tokens.json");
  const tokens = JSON.parse(await readFile(tokenFile, "utf8")) as { access_token: string; refresh_token: string };
  await writeFile(tokenFile, JSON.stringify({ ...tokens, access_token: "invalid-access" }, null, 2) + "\n", { mode: 0o600 });
  mock.control.tokenRequests = 0;
  const [first, second] = await Promise.all([
    trackerBridgeTool("atlassian", "atlassian", "atlassianUserInfo", {}),
    trackerBridgeTool("atlassian", "atlassian", "getAccessibleAtlassianResources", {}),
  ]);
  expect(first).toBeTruthy();
  expect(second).toBeTruthy();
  expect(mock.control.tokenRequests).toBe(1);
});

it("reports a transient refresh failure as unavailable, not logged out", async () => {
  const mock = await mockMcp();
  const home = await tempDir();
  await login(mock, home);
  const tokenFile = join(home, "mcp", "atlassian", "tokens.json");
  const tokens = JSON.parse(await readFile(tokenFile, "utf8")) as { access_token: string; refresh_token: string };
  await writeFile(tokenFile, JSON.stringify({ ...tokens, access_token: "invalid-access" }, null, 2) + "\n", { mode: 0o600 });
  mock.control.tokenMode = "503";
  await expect(trackerBridgeTool("atlassian", "atlassian", "atlassianUserInfo", {})).rejects.toBeInstanceOf(TrackerMcpUnavailableError);
  mock.control.tokenMode = "network";
  await expect(trackerBridgeTool("atlassian", "atlassian", "atlassianUserInfo", {})).rejects.toBeInstanceOf(TrackerMcpUnavailableError);
});

it("reports a revoked refresh token as authentication required", async () => {
  const mock = await mockMcp();
  const home = await tempDir();
  await login(mock, home);
  const tokenFile = join(home, "mcp", "atlassian", "tokens.json");
  const tokens = JSON.parse(await readFile(tokenFile, "utf8")) as { access_token: string; refresh_token: string };
  await writeFile(tokenFile, JSON.stringify({ ...tokens, access_token: "invalid-access" }, null, 2) + "\n", { mode: 0o600 });
  mock.control.tokenMode = "invalid_grant";
  await expect(trackerBridgeTool("atlassian", "atlassian", "atlassianUserInfo", {})).rejects.toBeInstanceOf(TrackerMcpAuthError);
});

it("treats a 401 after successful authentication as a login requirement", async () => {
  const mock = await mockMcp();
  const home = await tempDir();
  await login(mock, home);
  mock.control.unauthorized = true;
  await expect(trackerBridgeTool("atlassian", "atlassian", "atlassianUserInfo", {})).rejects.toBeInstanceOf(TrackerMcpAuthError);
});

it("rejects a callback whose state does not match", async () => {
  const mock = await mockMcp();
  mock.control.stateMode = "wrong";
  const home = await tempDir();
  trackerServers.atlassian.url = `${mock.base}/mcp`;
  trackerServers.atlassian.authHost = new URL(mock.base).hostname;
  setMcpHome(home);
  await expect(checkTrackerBridge("atlassian", "atlassian", {
    interactive: true,
    onAuthorize: (url) => { if (url) void fetch(url); },
  })).rejects.toThrow("state did not match");
});

it("cancels an interactive sign-in", async () => {
  const mock = await mockMcp();
  const home = await tempDir();
  trackerServers.atlassian.url = `${mock.base}/mcp`;
  trackerServers.atlassian.authHost = new URL(mock.base).hostname;
  setMcpHome(home);
  let stop: (() => Promise<void>) | undefined;
  await expect(checkTrackerBridge("atlassian", "atlassian", {
    interactive: true,
    onStart: (value) => { stop = value; },
    onAuthorize: () => { void stop?.(); },
  })).rejects.toThrow(/cancelled/i);
});

it("keeps tool refusals distinct from connection errors", async () => {
  const mock = await mockMcp();
  const home = await tempDir();
  await login(mock, home);
  await expect(trackerBridgeTool("atlassian", "atlassian", "forbidden", {})).rejects.toThrow("tool refused");
});

it("keeps a sign-in timeout distinct", async () => {
  const mock = await mockMcp();
  const home = await tempDir();
  trackerServers.atlassian.url = `${mock.base}/mcp`;
  trackerServers.atlassian.authHost = new URL(mock.base).hostname;
  setMcpHome(home);
  await expect(checkTrackerBridge("atlassian", "atlassian", {
    interactive: true,
    timeoutMs: 50,
  })).rejects.toThrow("Sign-in to Atlassian timed out.");
});

it("creates a tracker account only after sign-in and reports a transient refresh as unknown", async () => {
  const mock = await mockMcp();
  trackerServers.atlassian.url = `${mock.base}/mcp`;
  const { engine, close } = await apiProject();
  try {
    engine.on("live", (message) => {
      if (message.type === "login.progress" && message.url) void fetch(message.url);
    });
    expect(await engine.startTrackerLogin("atlassian")).toBe("tool:atlassian");
    await expect.poll(() => engine.global().accounts.accounts.find((account) => account.id === "atlassian"))
      .toMatchObject({ kind: "service", service: "Atlassian", tool: "atlassian", user: "alice", site: "team.atlassian.net" });
    const opened = vi.fn();
    setBrowserOpener(opened);
    expect(await engine.recheckAccount("atlassian")).toBe("logged_in");
    expect(opened).not.toHaveBeenCalled();
    setBrowserOpener(null);
    const tokenFile = join(engine.opts.home, "mcp", "atlassian", "tokens.json");
    const tokens = JSON.parse(await readFile(tokenFile, "utf8")) as { access_token: string; refresh_token: string };
    await writeFile(tokenFile, JSON.stringify({ ...tokens, access_token: "invalid-access" }, null, 2) + "\n", { mode: 0o600 });
    mock.control.tokenMode = "503";
    expect(await engine.recheckAccount("atlassian")).toBe("unknown");
  } finally {
    await close();
  }
});

it("does not create a tracker account when sign-in fails", async () => {
  const mock = await mockMcp();
  mock.control.stateMode = "wrong";
  trackerServers.atlassian.url = `${mock.base}/mcp`;
  const { engine, close } = await apiProject();
  try {
    let done: () => void = () => undefined;
    const finished = new Promise<void>((resolve) => { done = resolve; });
    engine.on("live", (message) => {
      if (message.type !== "login.progress") return;
      if (message.url) void fetch(message.url);
      if (message.done) done();
    });
    await engine.startTrackerLogin("atlassian");
    await finished;
    expect(engine.global().accounts.accounts.some((account) => account.id === "atlassian")).toBe(false);
  } finally {
    await close();
  }
});
