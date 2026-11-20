import type { Engine } from "../../main";
import type { Handlers } from "../server";

export function chatHandlers(engine: Engine) {
  const chats = engine.orchestrator;
  return {
    getChat: async () => chats.detail(),
    clearChat: async () => {
      await chats.clear();
      return { ok: true as const };
    },
    sendChatMessage: async ({ body }) => chats.send(body),
    uploadChatAttachment: async ({ body }) => chats.upload(body.mime, body.data),
    retryChatMessage: async ({ params }) => chats.retry(params.id),
    markChatRead: async () => {
      chats.markRead();
      return { ok: true as const };
    },
  } satisfies Partial<Handlers>;
}
