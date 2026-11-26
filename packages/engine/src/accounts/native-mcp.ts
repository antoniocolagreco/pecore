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
import { z } from "zod";
import { authRequired, TrackerMcpAuthError, trackerServers } from "./tracker-mcp";
import type { BridgeOptions, TrackerBridge } from "./tracker-mcp";

const Result = z.object({ content: z.array(z.object({ type: z.string(), text: z.string().optional() })).default([]), structuredContent: z.unknown().optional(), isError: z.boolean().optional() });
const Resources = z.object({
  resources: z.array(z.object({
    url: z.string().min(1),
    products: z.array(z.object({ id: z.string() }).passthrough()).optional(),
  }).passthrough()).default([]),
}).passthrough();

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

class FileOAuthProvider implements OAuthClientProvider {
  private verifier: string | undefined;
  stateValue: string | undefined;

  constructor(
    private readonly account: string,
    private readonly server: TrackerBridge,
    private readonly redirect: string,
    private readonly interactive: boolean,
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
    if (!this.interactive) throw new TrackerMcpAuthError(this.account, this.server);
    this.onAuthorize?.(url.toString());
    try {
      const child = spawn("xdg-open", [url.toString()], { stdio: "ignore", detached: true });
      child.unref();
    } catch {
      // The URL is reported through onAuthorize; the user can open it manually.
    }
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
  const provider = new FileOAuthProvider(account, server, callback?.url ?? "http://127.0.0.1:0/callback", interactive, options.onAuthorize);
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
  try {
    const connect = async (): Promise<StreamableHTTPClientTransport> => {
      const next = new StreamableHTTPClientTransport(new URL(trackerServers[server].url), { authProvider: provider });
      transport = next;
      await timeout(client.connect(next), timeoutMs, `The ${name} MCP server did not respond.`);
      return next;
    };
    try {
      await connect();
    } catch (error) {
      if (!(error instanceof UnauthorizedError) || !interactive || !callback) {
        if (error instanceof UnauthorizedError || error instanceof TrackerMcpAuthError) throw new TrackerMcpAuthError(account, server);
        throw error;
      }
      const value = await timeout(callback.code, timeoutMs, `Sign-in to ${name} timed out.`);
      if (provider.stateValue && value.state !== provider.stateValue) throw new Error(`The ${name} sign-in state did not match.`, { cause: error });
      await transport!.finishAuth(value.code);
      await transport!.close().catch(() => undefined);
      await connect();
    }
    if (stopped) throw new Error(`Sign-in to ${name} was cancelled.`);
    return await run(client);
  } catch (error) {
    if (error instanceof TrackerMcpAuthError) throw error;
    if (error instanceof UnauthorizedError) throw new TrackerMcpAuthError(account, server);
    if (error instanceof Error && /unauthorized|401/i.test(error.message)) throw new TrackerMcpAuthError(account, server);
    throw new Error(`Could not connect to the ${name} MCP server. Check the connection and try again.`, { cause: error });
  } finally {
    callback?.close();
    await transport?.close().catch(() => undefined);
  }
}

export async function checkTrackerBridge(account: string, server: TrackerBridge, options: BridgeOptions = {}): Promise<void> {
  await trackerBridgeTool(account, server, server === "atlassian" ? "atlassianUserInfo" : "list_issues", server === "atlassian" ? {} : { limit: 1 }, options);
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
      if (error instanceof UnauthorizedError || authRequired.test(String(error))) throw new TrackerMcpAuthError(account, server);
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
