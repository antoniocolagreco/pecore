import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";
import { authRequired, TrackerMcpAuthError, TrackerMcpUnavailableError, trackerServers } from "./tracker-mcp";
import type { BridgeOptions, TrackerBridge } from "./tracker-mcp";

const Result = z.object({ content: z.array(z.object({ type: z.string(), text: z.string().optional() })).default([]), structuredContent: z.unknown().optional(), isError: z.boolean().optional() });
const Resources = z.object({
  resources: z.array(z.object({
    url: z.string().min(1),
    products: z.array(z.object({ id: z.string() }).passthrough()).optional(),
  }).passthrough()).default([]),
}).passthrough();

const authCodes = new Set(["invalid_grant", "invalid_token", "unauthorized_client", "access_denied", "invalid_client"]);
const transientCodes = new Set(["server_error", "temporarily_unavailable", "too_many_requests"]);

type FetchState = { transient?: Error };

let root: string = join(process.env.PECORE_HOME ?? join(homedir(), ".pecore"), "mcp");

export function setMcpHome(home: string): void {
  root = join(home, "mcp");
}

function siteHost(value: string): string | null {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  const dir: string = dirname(path);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700).catch(() => undefined);
  const temp: string = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await rename(temp, path);
  await chmod(path, 0o600).catch(() => undefined);
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("errorCode" in error)) return undefined;
  const value = (error as { errorCode?: unknown }).errorCode;
  return typeof value === "string" ? value : undefined;
}

function isAuthError(error: unknown): boolean {
  if (error instanceof UnauthorizedError) return true;
  if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === 401) return true;
  const code = errorCode(error);
  if (code !== undefined && authCodes.has(code)) return true;
  return error instanceof Error && authRequired.test(error.message);
}

function isTransientError(error: unknown): boolean {
  const code = errorCode(error);
  if (code !== undefined && transientCodes.has(code)) return true;
  return error instanceof Error && /timed out|did not respond|fetch failed|econn|enotfound|etimedout|network/i.test(error.message);
}

function isTokenRequest(init?: RequestInit): boolean {
  if (init?.method?.toUpperCase() !== "POST") return false;
  const body = init.body;
  const text = typeof body === "string" ? body : body instanceof URLSearchParams ? body.toString() : "";
  return /(?:^|&)grant_type=(?:refresh_token|authorization_code)(?:&|$)/.test(text);
}

function trackedFetch(state: FetchState): FetchLike {
  return async (input, init) => {
    const token = isTokenRequest(init);
    try {
      const response = await fetch(input, init);
      if (token && (response.status >= 500 || response.status === 408 || response.status === 429)) {
        state.transient = new Error(`The token endpoint returned HTTP ${response.status}.`);
      }
      return response;
    } catch (error) {
      if (token) state.transient = error instanceof Error ? error : new Error(String(error));
      throw error;
    }
  };
}

function openBrowser(url: string): void {
  const command: string | null = process.platform === "darwin" ? "open" : process.platform === "linux" ? "xdg-open" : null;
  if (!command) return;
  const child = spawn(command, [url], { stdio: "ignore", detached: true });
  child.on("error", () => undefined);
  child.unref();
}

let browserOpener: (url: string) => void = openBrowser;

export function setBrowserOpener(opener: ((url: string) => void) | null): void {
  browserOpener = opener ?? openBrowser;
}

class FileOAuthProvider implements OAuthClientProvider {
  private verifier: string | undefined;
  stateValue: string | undefined;

  constructor(
    private readonly account: string,
    private readonly server: TrackerBridge,
    private readonly redirect: string,
    private readonly interactive: boolean,
    private readonly fetchState: FetchState,
    private readonly onAuthorize?: (url: string | null) => void,
  ) {}

  get redirectUrl(): string { return this.redirect; }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "PeCore",
      redirect_uris: [this.redirect],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  async state(): Promise<string> {
    this.stateValue = randomUUID();
    return this.stateValue;
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    return readJson<OAuthClientInformationMixed>(join(root, this.server, "client.json"));
  }

  async saveClientInformation(value: OAuthClientInformationMixed): Promise<void> {
    await writeJson(join(root, this.server, "client.json"), value);
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return readJson<OAuthTokens>(join(root, this.server, "tokens.json"));
  }

  async saveTokens(value: OAuthTokens): Promise<void> {
    await writeJson(join(root, this.server, "tokens.json"), value);
  }

  async saveCodeVerifier(value: string): Promise<void> {
    this.verifier = value;
  }

  async codeVerifier(): Promise<string> {
    if (!this.verifier) throw new Error("No code verifier saved");
    return this.verifier;
  }

  async redirectToAuthorization(url: URL): Promise<void> {
    if (this.fetchState.transient) throw new TrackerMcpUnavailableError(this.server, this.fetchState.transient);
    if (!this.interactive) throw new TrackerMcpAuthError(this.account, this.server);
    const target = url.toString();
    this.onAuthorize?.(target);
    const loopback = url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
    if ((url.protocol === "https:" || loopback) && url.hostname === trackerServers[this.server].authHost) browserOpener(target);
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): Promise<void> {
    const names: string[] = scope === "all" ? ["client.json", "tokens.json"] : scope === "client" ? ["client.json"] : scope === "tokens" ? ["tokens.json"] : [];
    for (const name of names) await rm(join(root, this.server, name), { force: true });
  }
}

type Callback = { url: string; code: Promise<{ code: string; state: string | null }>; close(): void; cancel(): void };

function startCallback(): Promise<Callback> {
  let resolveCode: (value: { code: string; state: string | null }) => void = () => undefined;
  let rejectCode: (error: Error) => void = () => undefined;
  const code = new Promise<{ code: string; state: string | null }>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  void code.catch(() => undefined);
  const server = createServer((request, response) => {
    const url: URL = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/callback") {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    const error: string | null = url.searchParams.get("error");
    if (error) {
      response.writeHead(400, { "Content-Type": "text/plain" });
      response.end(`Authorization failed: ${error}`);
      rejectCode(new Error(`OAuth error: ${error}`));
      return;
    }
    const value: string | null = url.searchParams.get("code");
    if (!value) {
      response.writeHead(400);
      response.end("No authorization code");
      rejectCode(new Error("No authorization code"));
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end("<h1>Authorized</h1><p>You can close this window and return to PeCore.</p>");
    resolveCode({ code: value, state: url.searchParams.get("state") });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("The OAuth callback server did not start."));
        return;
      }
      resolve({ url: `http://127.0.0.1:${address.port}/callback`, code, close: () => server.close(), cancel: () => rejectCode(new Error("Sign-in cancelled.")) });
    });
  });
}

const queues = new Map<TrackerBridge, Promise<unknown>>();

async function serialize<T>(server: TrackerBridge, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(server) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(work);
  const tail = current.then(() => undefined, () => undefined);
  queues.set(server, tail);
  try {
    return await current;
  } finally {
    if (queues.get(server) === tail) queues.delete(server);
  }
}

function timeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error: unknown) => { clearTimeout(timer); reject(error); });
  });
}

async function withNative<T>(account: string, server: TrackerBridge, options: BridgeOptions, run: (client: Client) => Promise<T>): Promise<T> {
  const name: string = trackerServers[server].name;
  const interactive: boolean = !!options.interactive;
  const callback: Callback | undefined = interactive ? await startCallback() : undefined;
  const fetchState: FetchState = {};
  const provider = new FileOAuthProvider(account, server, callback?.url ?? "http://127.0.0.1:0/callback", interactive, fetchState, options.onAuthorize);
  const client = new Client({ name: "pecore", version: "1" }, { capabilities: {} });
  let transport: StreamableHTTPClientTransport | undefined;
  let stopped: boolean = false;
  const stop = async (): Promise<void> => {
    stopped = true;
    callback?.cancel();
    callback?.close();
    await transport?.close().catch(() => undefined);
  };
  options.onStart?.(stop);
  const timeoutMs: number = options.timeoutMs ?? (interactive ? 195_000 : 20_000);

  const connect = async (): Promise<void> => {
    transport = new StreamableHTTPClientTransport(new URL(trackerServers[server].url), { authProvider: provider, fetch: trackedFetch(fetchState) });
    await timeout(client.connect(transport), timeoutMs, `The ${name} MCP server did not respond.`);
  };

  const classifyConnect = (error: unknown): never => {
    if (error instanceof TrackerMcpAuthError || error instanceof TrackerMcpUnavailableError) throw error;
    if (isAuthError(error)) throw new TrackerMcpAuthError(account, server);
    if (isTransientError(error) || fetchState.transient) throw new TrackerMcpUnavailableError(server, error);
    throw new Error(`Could not connect to the ${name} MCP server. Check the connection and try again.`, { cause: error });
  };

  try {
    let authorized: boolean = false;
    if (!interactive && !await provider.tokens()) throw new TrackerMcpAuthError(account, server);
    try {
      await connect();
      authorized = true;
    } catch (error) {
      if (stopped) throw new Error(`Sign-in to ${name} was cancelled.`, { cause: error });
      if (!(interactive && isAuthError(error))) classifyConnect(error);
    }
    if (!authorized) {
      if (!callback) throw new TrackerMcpAuthError(account, server);
      const value = await timeout(callback.code, timeoutMs, `Sign-in to ${name} timed out.`);
      if (provider.stateValue && value.state !== provider.stateValue) throw new Error(`The ${name} sign-in state did not match.`);
      try {
        await transport!.finishAuth(value.code);
      } catch (error) {
        if (isTransientError(error) || fetchState.transient) throw new TrackerMcpUnavailableError(server, error);
        if (isAuthError(error)) throw new TrackerMcpAuthError(account, server);
        throw new Error(`Sign-in to ${name} failed.`, { cause: error });
      }
      await transport!.close().catch(() => undefined);
      try {
        await connect();
      } catch (error) {
        classifyConnect(error);
      }
    }
    if (stopped) throw new Error(`Sign-in to ${name} was cancelled.`);
    return await run(client);
  } finally {
    callback?.close();
    await transport?.close().catch(() => undefined);
  }
}

export async function checkTrackerBridge(account: string, server: TrackerBridge, options: BridgeOptions = {}): Promise<void> {
  await trackerBridgeTool(account, server, server === "atlassian" ? "atlassianUserInfo" : "list_issues", server === "atlassian" ? {} : { limit: 1 }, options);
}

export async function trackerIdentity(account: string, server: TrackerBridge): Promise<string | null> {
  const output = await trackerBridgeTool(account, server, server === "atlassian" ? "atlassianUserInfo" : "whoami", {});
  const data = output && typeof output === "object" && "data" in output ? (output as { data?: unknown }).data : output;
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  if (server === "atlassian") {
    const identity = record.accountId ?? record.email ?? record.displayName;
    return typeof identity === "string" && identity.trim() ? identity.trim() : null;
  }
  const user = record.user && typeof record.user === "object"
    ? (record.user as Record<string, unknown>).email ?? (record.user as Record<string, unknown>).name
    : undefined;
  const workspace = record.workspace && typeof record.workspace === "object"
    ? (record.workspace as Record<string, unknown>).name ?? (record.workspace as Record<string, unknown>).url
    : undefined;
  const parts: string[] = [user, workspace].filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim());
  return parts.length ? parts.join(" @ ") : null;
}

export async function atlassianSite(account: string): Promise<string | null> {
  const parsed = Resources.safeParse(await trackerBridgeTool(account, "atlassian", "getAccessibleAtlassianResources", {}));
  if (!parsed.success) return null;
  for (const resource of parsed.data.resources) {
    if (resource.products && !resource.products.some(({ id }) => id.toLowerCase() === "jira")) continue;
    const host: string | null = siteHost(resource.url);
    if (host) return host;
  }
  return null;
}

export async function trackerBridgeTool(account: string, server: TrackerBridge, name: string, args: Record<string, unknown>, options: BridgeOptions = {}): Promise<unknown> {
  return serialize(server, () => withNative(account, server, options, async (client) => {
    let result: unknown;
    try {
      result = await client.callTool({ name, arguments: args });
    } catch (error) {
      if (isAuthError(error)) throw new TrackerMcpAuthError(account, server);
      throw error;
    }
    const parsed = Result.safeParse(result);
    if (!parsed.success) throw new Error(`The ${trackerServers[server].name} tool returned an invalid result.`);
    const { content, structuredContent, isError } = parsed.data;
    const texts: string[] = content.flatMap((item) => item.type === "text" && item.text !== undefined ? [item.text] : []);
    let output: unknown = structuredContent ?? texts;
    if (structuredContent === undefined && texts.length === 1) {
      try { output = JSON.parse(texts[0]!) as unknown; } catch { output = texts[0]; }
    }
    if (isError || (output && typeof output === "object" && "error" in output && output.error === true)) {
      if (texts.some((part) => authRequired.test(part)) || authRequired.test(JSON.stringify(output ?? null))) throw new TrackerMcpAuthError(account, server);
      throw new Error(`The ${trackerServers[server].name} tool refused the request. Check the account, target and tool arguments.`);
    }
    return output;
  }));
}
