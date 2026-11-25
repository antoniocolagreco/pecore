import { createInterface } from "node:readline";
import { AcpClient, RpcError } from "@pecore/agents";
import { z } from "zod";
import { ToolAuthError } from "../runners/forge-env";
import { appUser, baseEnv, spawnAs, SpawnError } from "../runners/process";
import type { Proc } from "../runners/process";

const remoteUrl: string = "https://mcp.atlassian.com/v2/mcp";
const authRequired = /\b(?:unauthorized|unauthenticated|invalid[_ ](?:grant|token)|authentication required|sign.in required|login required|401)\b/i;
const authorize = /please authorize this client|open(?:ing|ed) (?:the |a )?browser|waiting for (?:oauth|authorization)/i;
const Result = z.object({ content: z.array(z.object({ type: z.string(), text: z.string().optional() })).default([]), structuredContent: z.unknown().optional(), isError: z.boolean().optional() });

export class TrackerMcpAuthError extends ToolAuthError {
  constructor(account: string) {
    super(account, "Sign in to Atlassian in Settings → Accounts.");
  }
}

type BridgeOptions = {
  interactive?: boolean;
  onStart?: (proc: Proc) => void;
  onAuthorize?: (url: string | null) => void;
  timeoutMs?: number;
};

async function withBridge<T>(account: string, options: BridgeOptions, run: (client: AcpClient) => Promise<T>): Promise<T> {
  const env: Record<string, string> = await baseEnv(appUser);
  for (const key of ["DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS", "XAUTHORITY"]) {
    const value: string | undefined = process.env[key];
    if (value) env[key] = value;
  }
  const proc: Proc = await spawnAs({ user: appUser, argv: ["mcp-remote", remoteUrl, "--auth-timeout", options.interactive ? "180" : "5"], env, cwd: env.HOME! }).catch((error: unknown) => {
    if (error instanceof SpawnError && error.code === "not_found") throw new Error("Install mcp-remote on this computer to connect Atlassian.");
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
      if (!options.interactive) rejectAuth(new TrackerMcpAuthError(account));
      else {
        authPrompt = true;
        options.onAuthorize?.(null);
      }
    }
    if (!authPrompt || !options.onAuthorize) return;
    const url: URL | null = URL.parse(line.trim());
    if (url?.protocol === "https:" && url.hostname === "auth.atlassian.com") options.onAuthorize(url.href);
  });
  const timeout: number = options.timeoutMs ?? (options.interactive ? 195_000 : 20_000);
  const client: AcpClient = new AcpClient(proc, [], timeout);
  const response: Promise<T> = (async () => {
    const result = await client.request<{ protocolVersion?: string }>("initialize", {
      protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "pecore", version: "1" },
    });
    if (!result?.protocolVersion) throw new Error("The Atlassian bridge did not initialize.");
    client.notify("notifications/initialized", {});
    return run(client);
  })();
  try {
    options.onStart?.(proc);
    return await Promise.race([response, blocked]);
  } catch (error) {
    if (error instanceof TrackerMcpAuthError || needsAuth || (error instanceof RpcError && authRequired.test(error.message))) throw new TrackerMcpAuthError(account);
    if (error instanceof McpToolError) throw error;
    throw new Error("Could not connect to the Atlassian MCP server. Check the bridge and try again.", { cause: error });
  } finally {
    lines.close();
    client.endInput();
    await proc.stop();
  }
}

class McpToolError extends Error {}
export class TrackerMcpRefusedError extends McpToolError {}

export async function checkAtlassian(account: string, options: BridgeOptions = {}): Promise<void> {
  await atlassianTool(account, "atlassianUserInfo", {}, options);
}

export async function atlassianTool(account: string, name: string, args: Record<string, unknown>, options: BridgeOptions): Promise<unknown> {
  return withBridge(account, options, async (client) => {
    const result = Result.safeParse(await client.request("tools/call", { name, arguments: args }));
    if (!result.success) throw new McpToolError("The Atlassian tool returned an invalid result.");
    const { content, structuredContent, isError } = result.data;
    const texts: string[] = content.flatMap((item) => item.type === "text" && item.text !== undefined ? [item.text] : []);
    let output: unknown = structuredContent ?? texts;
    if (structuredContent === undefined && texts.length === 1) {
      try { output = JSON.parse(texts[0]!) as unknown; } catch { output = texts[0]; }
    }
    if (isError || (output && typeof output === "object" && "error" in output && output.error === true)) {
      if (texts.some((part) => authRequired.test(part)) || authRequired.test(JSON.stringify(output ?? null))) throw new TrackerMcpAuthError(account);
      throw new TrackerMcpRefusedError("The Atlassian tool refused the request. Check the site, tool arguments and your Jira permissions.");
    }
    return output;
  });
}
