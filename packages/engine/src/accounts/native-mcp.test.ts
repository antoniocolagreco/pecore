import { spawn } from "node:child_process";
import type * as ChildProcess from "node:child_process";
import { createServer } from "node:http";
import type { Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { checkTrackerBridge, setMcpHome, trackerBridgeTool } from "./native-mcp";
import { trackerServers } from "./tracker-mcp";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcess>();
  return { ...actual, spawn: vi.fn(() => ({ unref: () => undefined })) };
});

const original = { ...trackerServers.atlassian };
let server: Server | undefined;

afterEach(() => {
  trackerServers.atlassian.url = original.url;
  trackerServers.atlassian.authHost = original.authHost;
  server?.close();
  server = undefined;
});

afterAll(() => server?.close());

function json(response: ServerResponse, body: unknown, status = 200): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function rpc(id: unknown, result: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}

async function mockMcp(): Promise<{ base: string; tokens: Map<string, "access" | "refreshed"> }> {
  const tokens = new Map<string, "access" | "refreshed">([["test-access", "access"]]);
  const http = createServer((request, response) => {
    const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
    const url = new URL(request.url ?? "/", base);
    if (url.pathname === "/mcp") {
      const auth = request.headers.authorization;
      if (auth !== "Bearer test-access" && auth !== "Bearer refreshed-access") {
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
          ] }));
          return;
        }
        if (message.method === "tools/call") {
          const name = message.params?.name;
          const value = name === "getAccessibleAtlassianResources"
            ? { resources: [{ url: "https://team.atlassian.net", products: [{ id: "jira" }] }] }
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
      const state = url.searchParams.get("state");
      response.writeHead(302, { Location: `${redirect}?code=test-code${state ? `&state=${encodeURIComponent(state)}` : ""}` });
      response.end();
      return;
    }
    if (url.pathname === "/token") {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (part) => { body += part; });
      request.on("end", () => {
        const form = new URLSearchParams(body);
        const refreshed = form.get("grant_type") === "refresh_token";
        const access = refreshed ? "refreshed-access" : "test-access";
        tokens.set(access, refreshed ? "refreshed" : "access");
        json(response, { access_token: access, token_type: "bearer", expires_in: 3600, refresh_token: "test-refresh", scope: "read write" });
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
  return { base: `http://127.0.0.1:${(http.address() as AddressInfo).port}`, tokens };
}

it("reports authentication without opening a browser when no tokens exist", async () => {
  const mock = await mockMcp();
  trackerServers.atlassian.url = `${mock.base}/mcp`;
  const home = await mkdtemp(join(tmpdir(), "pecore-native-mcp-empty-"));
  setMcpHome(home);
  vi.mocked(spawn).mockClear();
  await expect(trackerBridgeTool("atlassian", "atlassian", "atlassianUserInfo", {})).rejects.toThrow("Sign in to Atlassian");
  expect(vi.mocked(spawn)).not.toHaveBeenCalled();
});

it("logs in through native OAuth, stores 0600 tokens and reconnects without a browser", async () => {
  const mock = await mockMcp();
  trackerServers.atlassian.url = `${mock.base}/mcp`;
  trackerServers.atlassian.authHost = new URL(mock.base).hostname;
  const home = await mkdtemp(join(tmpdir(), "pecore-native-mcp-"));
  setMcpHome(home);

  const opened: string[] = [];
  await checkTrackerBridge("atlassian", "atlassian", {
    interactive: true,
    onAuthorize: (url) => {
      if (url) {
        opened.push(url);
        void fetch(url);
      }
    },
  });

  expect(opened).toHaveLength(1);
  const tokenFile = join(home, "mcp", "atlassian", "tokens.json");
  const tokens = JSON.parse(await readFile(tokenFile, "utf8")) as { access_token: string; refresh_token: string };
  expect(tokens.access_token).toBe("test-access");
  expect(tokens.refresh_token).toBe("test-refresh");
  expect((await stat(tokenFile)).mode & 0o777).toBe(0o600);

  const result = await trackerBridgeTool("atlassian", "atlassian", "getAccessibleAtlassianResources", {});
  expect(result).toEqual({ resources: [{ url: "https://team.atlassian.net", products: [{ id: "jira" }] }] });

  await writeFile(tokenFile, JSON.stringify({ ...tokens, access_token: "invalid-access" }, null, 2) + "\n", { mode: 0o600 });
  await trackerBridgeTool("atlassian", "atlassian", "atlassianUserInfo", {});
  const refreshed = JSON.parse(await readFile(tokenFile, "utf8")) as { access_token: string; refresh_token: string };
  expect(refreshed.access_token).toBe("refreshed-access");
  expect(refreshed.refresh_token).toBe("test-refresh");
});
