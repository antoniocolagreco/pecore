import { z } from "zod";

export const EngineMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready"), port: z.number().int(), token: z.string() }),
  z.object({ type: z.literal("error"), message: z.string() }),
  z.object({ type: z.literal("notify"), title: z.string(), body: z.string(), kind: z.string() }),
  z.object({ type: z.literal("admin"), id: z.string(), script: z.string() }),
  z.object({ type: z.literal("active"), jobs: z.number().int() }),
  z.object({ type: z.literal("shutdown.done") }),
]);
export type EngineMessage = z.infer<typeof EngineMessage>;

export const MainMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("admin.result"), id: z.string(), ok: z.boolean(), error: z.string().nullable() }),
  z.object({ type: z.literal("active?") }),
  z.object({ type: z.literal("shutdown") }),
]);
export type MainMessage = z.infer<typeof MainMessage>;
