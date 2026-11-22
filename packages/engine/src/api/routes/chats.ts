import type { Engine } from "../../main";
import type { Handlers } from "../server";

export function chatHandlers(engine: Engine) {
  const chats = engine.agentChats;
  return {
    getChat: async () => chats.detail(),
    clearChat: async () => {
      await chats.clear();
      return { ok: true as const };
    },
    sendChatMessage: async ({ body }) => chats.send(body),
    answerChatProjectCreation: async ({ params, body }) => {
      await chats.answerProjectAction("create_project", params.id, body.decision);
      return { ok: true as const };
    },
    answerChatProjectDeletion: async ({ params, body }) => {
      await chats.answerProjectAction("delete_project", params.id, body.decision);
      return { ok: true as const };
    },
    answerChatProjectImport: async ({ params, body }) => {
      await chats.answerProjectShare(params.id, { tool: "import_project", ...body });
      return { ok: true as const };
    },
    answerChatProjectExport: async ({ params, body }) => {
      await chats.answerProjectShare(params.id, { tool: "export_project", ...body });
      return { ok: true as const };
    },
    uploadChatAttachment: async ({ body }) => chats.upload(body.mime, body.data),
    retryChatMessage: async ({ params }) => chats.retry(params.id),
    markChatRead: async () => {
      chats.markRead();
      return { ok: true as const };
    },
    getProjectChat: async ({ params }) => chats.detail(params.id),
    clearProjectChat: async ({ params }) => {
      await chats.clear(params.id);
      return { ok: true as const };
    },
    sendProjectChatMessage: async ({ params, body }) => chats.send(body, params.id),
    uploadProjectChatAttachment: async ({ params, body }) => chats.upload(body.mime, body.data, params.id),
    retryProjectChatMessage: async ({ params }) => chats.retry(params.messageId, params.id),
    markProjectChatRead: async ({ params }) => {
      chats.markRead(params.id);
      return { ok: true as const };
    },
  } satisfies Partial<Handlers>;
}
