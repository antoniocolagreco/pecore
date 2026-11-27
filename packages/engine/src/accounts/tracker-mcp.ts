import { ToolAuthError } from "../runners/forge-env";

export type TrackerBridge = "atlassian" | "linear";

export const trackerServers: Record<TrackerBridge, { name: string; url: string; authHost: string }> = {
  atlassian: { name: "Atlassian", url: "https://mcp.atlassian.com/v2/mcp", authHost: "auth.atlassian.com" },
  linear: { name: "Linear", url: "https://mcp.linear.app/mcp", authHost: "linear.app" },
};

export const authRequired = /\b(?:unauthorized|unauthenticated|invalid[_ ](?:grant|token)|authentication required|sign.in required|login required|401)\b/i;

export type BridgeOptions = {
  interactive?: boolean;
  onStart?: (stop: () => Promise<void>) => void;
  onAuthorize?: (url: string | null) => void;
  timeoutMs?: number;
};

export class TrackerMcpAuthError extends ToolAuthError {
  constructor(account: string, server: TrackerBridge = "atlassian") {
    super(account, `Sign in to ${trackerServers[server].name} in Settings → Accounts.`);
  }
}

export class TrackerMcpUnavailableError extends Error {
  constructor(server: TrackerBridge = "atlassian", cause?: unknown) {
    super(`The ${trackerServers[server].name} MCP server is temporarily unavailable.`, { cause });
  }
}
