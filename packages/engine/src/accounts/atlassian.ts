import { createInterface } from "node:readline";
import { AcpClient, RpcError } from "@pecore/agents";
import { z } from "zod";
import { ToolAuthError } from "../runners/forge-env";
import { appUser, baseEnv, spawnAs, SpawnError } from "../runners/process";
import type { Proc } from "../runners/process";

const servers = {
  atlassian: { name: "Atlassian", url: "https://mcp.atlassian.com/v2/mcp", authHost: "auth.atlassian.com" },
  linear: { name: "Linear", url: "https://mcp.linear.app/mcp", authHost: "linear.app" },
};
export type TrackerBridge = keyof typeof servers;
const authRequired = /\b(?:unauthorized|unauthenticated|invalid[_ ](?:grant|token)|authentication required|sign.in required|login required|401)\b/i;
const authorize = /please authorize this client|open(?:ing|ed) (?:the |a )?browser|waiting for (?:oauth|authorization)/i;
const Result = z.object({ content: z.array(z.object({ type: z.string(), text: z.string().optional() })).default([]), structuredContent: z.unknown().optional(), isError: z.boolean().optional() });
const Resources = z.object({
  resources: z.array(z.object({
    url: z.string().min(1),
    products: z.array(z.object({ id: z.string() }).passthrough()).optional(),
  }).passthrough()).default([]),
}).passthrough();

function siteHost(value: string): string | null {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export class TrackerMcpAuthError extends ToolAuthError {
  constructor(account: string, server: TrackerBridge = "atlassian") {
    super(account, `Sign in to ${servers[server].name} in Settings → Accounts.`);
  }
}

type BridgeOptions = {
  interactive?: boolean;
  onStart?: (proc: Proc) => void;
  onAuthorize?: (url: string | null) => void;
  timeoutMs?: number;
};

async function withBridge<T>(account: string, server: TrackerBridge, options: BridgeOptions, run: (client: AcpClient) => Promise<T>): Promise<T> {
  const { name, url: remoteUrl, authHost } = servers[server];
  const env: Record<string, string> = await baseEnv(appUser);
  for (const key of ["DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS", "XAUTHORITY"]) {
    const value: string | undefined = process.env[key];
    if (value) env[key] = value;
  }
  const proc: Proc = await spawnAs({ user: appUser, argv: ["mcp-remote", remoteUrl, "--auth-timeout", options.interactive ? "180" : "5"], env, cwd: env.HOME! }).catch((error: unknown) => {
    if (error instanceof SpawnError && error.code === "not_found") throw new Error(`Install mcp-remote on this computer to connect ${name}.`);
    throw error;
  });
  const lines = createInterface({ input: proc.stderr });
  let needsAuth: boolean = false;
  let authPrompt: boolean = false;
  let rejectAuth: (error: TrackerMcpAuthError) => void = () => undefined;
  const blocked: Promise<never> = new Promise((_, reject) => { rejectAuth = reject; });
  lines.on("line", (line: string) => {
    needsAuth ||= authRequired.test(line) || authorize.test(line);
    if (authorize.test(line)) {
      if (!options.interactive) rejectAuth(new TrackerMcpAuthError(account, server));
      else {
        authPrompt = true;
        options.onAuthorize?.(null);
      }
    }
    if (!authPrompt || !options.onAuthorize) return;
    const url: URL | null = URL.parse(line.trim());
    if (url?.protocol === "https:" && url.hostname === authHost) options.onAuthorize(url.href);
  });
  const timeout: number = options.timeoutMs ?? (options.interactive ? 195_000 : 20_000);
  const client: AcpClient = new AcpClient(proc, [], timeout);
  const response: Promise<T> = (async () => {
    const result = await client.request<{ protocolVersion?: string }>("initialize", {
      protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "pecore", version: "1" },
    });
    if (!result?.protocolVersion) throw new Error(`The ${name} bridge did not initialize.`);
    client.notify("notifications/initialized", {});
    return run(client);
  })();
  try {
    options.onStart?.(proc);
    return await Promise.race([response, blocked]);
  } catch (error) {
    if (error instanceof TrackerMcpAuthError || needsAuth || (error instanceof RpcError && authRequired.test(error.message))) throw new TrackerMcpAuthError(account, server);
    if (error instanceof McpToolError) throw error;
    throw new Error(`Could not connect to the ${name} MCP server. Check the bridge and try again.`, { cause: error });
  } finally {
    lines.close();
    client.endInput();
    await proc.stop();
  }
}

class McpToolError extends Error {}
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
  return withBridge(account, server, options, async (client) => {
    const result = Result.safeParse(await client.request("tools/call", { name, arguments: args }));
    if (!result.success) throw new McpToolError(`The ${servers[server].name} tool returned an invalid result.`);
    const { content, structuredContent, isError } = result.data;
    const texts: string[] = content.flatMap((item) => item.type === "text" && item.text !== undefined ? [item.text] : []);
    let output: unknown = structuredContent ?? texts;
    if (structuredContent === undefined && texts.length === 1) {
      try { output = JSON.parse(texts[0]!) as unknown; } catch { output = texts[0]; }
    }
    if (isError || (output && typeof output === "object" && "error" in output && output.error === true)) {
      if (texts.some((part) => authRequired.test(part)) || authRequired.test(JSON.stringify(output ?? null))) throw new TrackerMcpAuthError(account, server);
      throw new McpToolError(`The ${servers[server].name} tool refused the request. Check the account, target and tool arguments.`);
    }
    return output;
  });
}
