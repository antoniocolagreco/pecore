import type { LogEvent } from "@pecore/schemas";
import type { LogLine } from "./logs";

type Rpc = { method?: string; params?: { update?: Record<string, unknown>; toolCall?: { toolCallId?: string }; options?: { optionId: string; kind: string }[] } };

export function logEvents(line: LogLine): LogEvent[] {
  if (line.dir === "err") return [{ type: "stderr", text: line.line, at: line.at }];
  if (line.dir === "cmd") return [{ type: "output", text: line.text, at: line.at }];
  if (line.dir !== "in") return [];
  const msg = line.msg as Rpc;
  if (msg.method === "session/request_permission") {
    const opt = msg.params?.options?.find((o) => o.kind === "allow_once");
    return [{ type: "permission", toolCallId: msg.params?.toolCall?.toolCallId ?? "", optionId: opt?.optionId ?? null, at: line.at }];
  }
  if (msg.method !== "session/update") return [];
  const u = msg.params?.update ?? {};
  if (u.sessionUpdate === "agent_message_chunk") return [{ type: "text", text: (u.content as { text?: string } | undefined)?.text ?? "", at: line.at }];
  if (u.sessionUpdate === "tool_call" || u.sessionUpdate === "tool_call_update")
    return [{ type: "tool_call", toolCallId: String(u.toolCallId ?? ""), title: String(u.title ?? ""), kind: String(u.kind ?? ""), status: String(u.status ?? ""), at: line.at }];
  return [];
}
