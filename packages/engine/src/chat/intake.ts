import type { OrderSink } from "../sources/poll";
import type { AgentChats } from "./chat";

export function intakeSink(chats: AgentChats): OrderSink {
  return { hand: async (projectId, order) => chats.hand(projectId, order) };
}
