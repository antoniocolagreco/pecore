import type { OrderSink } from "../sources/poll";
import type { OrchestratorChats } from "./chat";

export function intakeSink(chats: OrchestratorChats): OrderSink {
  return { hand: async (projectId, order) => chats.hand(projectId, order) };
}
