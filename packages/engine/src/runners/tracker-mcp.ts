import type { ArtifactType, McpTrackerNode } from "@pecore/schemas";
import { atlassianTool } from "../accounts/atlassian";
import { commandHash, pickOutcome } from "./command";
import type { CommandOutcome, CommandRun } from "./command";

type Options = Pick<CommandRun, "params" | "inputs" | "context" | "onStart" | "effect">;
type Json = McpTrackerNode["arguments"][string];

export function trackerMcpArguments(node: McpTrackerNode, options: Options): Record<string, unknown> {
  const inputs: Record<string, unknown> = Object.fromEntries(options.inputs.map(({ type, content }) => [
    type, type === "text" || type === "diff" ? content : JSON.parse(content) as unknown,
  ]));
  const selected: unknown = options.params.ticket ?? options.context.ticketId;
  const ticket: unknown = typeof selected === "string" ? (/^https:\/\/[^/]+\/browse\/([^/?#]+)/.exec(selected)?.[1] ?? selected) : selected;
  const values: Record<string, unknown> = { params: options.params, inputs, ticket: { id: ticket } };
  function resolve(value: Json): unknown {
    if (Array.isArray(value)) return value.map(resolve);
    if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, part]) => [key, resolve(part)]));
    if (typeof value !== "string") return value;
    const path: string | undefined = /^\{((?:inputs|params|ticket)\.[\w.-]+)\}$/.exec(value)?.[1];
    if (!path) return value;
    let current: unknown = values;
    for (const part of path.split(".")) {
      current = current && typeof current === "object" && Object.hasOwn(current, part) ? (current as Record<string, unknown>)[part] : undefined;
    }
    if (current === undefined || current === null || current === "") throw new Error("Supply a value for " + path + " before running " + node.name + ".");
    return current;
  }
  return Object.fromEntries(Object.entries(node.arguments).map(([key, value]) => [key, resolve(value)]));
}

export async function runMcpTracker(node: McpTrackerNode, account: string, options: Options): Promise<CommandOutcome<ArtifactType>> {
  const args: Record<string, unknown> = trackerMcpArguments(node, options);
  if (!node.readOnly) options.effect?.requested(commandHash([node.server, node.tool, JSON.stringify(args)]));
  let value: unknown;
  try {
    value = await atlassianTool(account, node.tool, args, {
      onStart: (proc) => options.onStart?.(proc.pgid, proc.user), timeoutMs: node.timeoutSec * 1000,
    });
  } catch (error) {
    if (!node.readOnly) options.effect?.done(false, { error: (error as Error).message });
    throw error;
  }
  if (!node.readOnly) options.effect?.done(true, {});
  const raw: string = JSON.stringify(value ?? null);
  const outcome: string | null = pickOutcome(node.outcomeRules, { code: 0, stdout: raw });
  if (!outcome) return { kind: "failed", reason: "INVALID_OUTPUT", log: "The MCP result did not match a node outcome." };
  const type: ArtifactType | undefined = node.outputs[outcome];
  const content: string = type === "document" ? JSON.stringify({ title: node.name, body: typeof value === "string" ? value : raw })
    : type === "text" && typeof value === "string" ? value : raw;
  return { kind: "completed", outcome, outputs: type ? [{ type, content }] : [], log: "Atlassian tool completed.", fromProbe: false };
}
