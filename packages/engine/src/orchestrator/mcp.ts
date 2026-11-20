import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Engine } from "../main";
import { orchestratorTools } from "./tools";

const requestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string(),
  params: z.unknown().optional(),
});
const initializeSchema = z.object({ protocolVersion: z.string() });
const callSchema = z.object({ name: z.string().min(1), arguments: z.record(z.string(), z.unknown()).optional() });
const querySchema = z.object({ chat: z.string().optional() });
const protocolVersion = "2025-11-25";
const protocolVersions: Set<string> = new Set(["2024-11-05", "2025-03-26", "2025-06-18", protocolVersion]);

export function mcpRoute(app: FastifyInstance, engine: Engine): void {
  const tools = orchestratorTools(engine);
  app.post("/mcp", async (req, reply) => {
    const parsed = requestSchema.safeParse(req.body);
    const requestId: string | number | null = parsed.data?.id ?? null;
    const success = (result: unknown) => ({ jsonrpc: "2.0", id: requestId, result });
    const failure = (code: number, message: string) => ({ jsonrpc: "2.0", id: requestId, error: { code, message } });
    if (!parsed.success) return failure(-32600, "Invalid Request");

    const query = querySchema.safeParse(req.query);
    if (!query.success) return failure(-32602, "Invalid chat identifier");
    const routeKey: string | undefined = query.data.chat;
    const chatId: string | undefined = routeKey ? engine.orchestrator.chatId(routeKey) : undefined;
    if (routeKey !== undefined && !chatId) return reply.code(401).send();
    const { method, params } = parsed.data;
    if (parsed.data.id === undefined) return reply.code(202).send();
    switch (method) {
      case "initialize": {
        const init = initializeSchema.safeParse(params);
        if (!init.success) return failure(-32602, "Invalid initialize params");
        const requested: string = init.data.protocolVersion;
        return success({
          protocolVersion: protocolVersions.has(requested) ? requested : protocolVersion,
          serverInfo: { name: "pecore", version: "1" },
          capabilities: { tools: {} },
        });
      }
      case "ping":
        return success({});
      case "notifications/initialized":
        return failure(-32600, "initialized must be a notification");
      case "tools/list":
        return success({ tools: tools.list(chatId ? engine.orchestrator.role(chatId) : "orchestrator") });
      case "tools/call": {
        if (!chatId) return failure(-32602, "A chat identifier is required for tools/call");
        const input = callSchema.safeParse(params);
        if (!input.success) return failure(-32602, "Invalid tools/call params");
        try {
          const { name, arguments: args } = input.data;
          return success(await engine.orchestrator.inTurn(chatId, (message) => tools.call(name, args, message)));
        } catch (e) {
          return failure(-32000, e instanceof Error ? e.message : String(e));
        }
      }
      default:
        return failure(-32601, "Method not found");
    }
  });
}
