import type { Engine } from "../../main";
import type { Handlers } from "../server";

export function chatHandlers(engine: Engine) {
  const chats = engine.orchestrator;
  return {
    listChats: async () => chats.list(),
    createChat: async ({ body }) => chats.create(body.title),
    getChat: async ({ params }) => chats.detail(params.id),
    sendChatMessage: async ({ params, body }) => chats.send(params.id, body),
    uploadChatAttachment: async ({ params, body }) => chats.upload(params.id, body.mime, body.data),
    retryChatMessage: async ({ params }) => chats.retry(params.id, params.messageId),
    markChatRead: async ({ params }) => chats.markRead(params.id),
  } satisfies Partial<Handlers>;
}
