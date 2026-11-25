import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ChatDetail, ChatMessageView, RouteInput } from "@pecore/schemas";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatPanel } from "./AssistantChat";

const api = vi.hoisted(() => ({ call: vi.fn() }));

vi.mock("../api/client", () => ({ call: api.call }));
vi.mock("../api/live", () => ({ useConnected: () => true, onLive: () => () => undefined }));

const request: ChatMessageView = {
  id: "message-1", role: "user", text: "What ran?", context: [], createdAt: 1, state: "completed", error: null, replyTo: null,
};
const reply: ChatMessageView = {
  id: "message-2", role: "assistant", text: "| Check | Result |\n|---|---|\n| Typecheck | Passed |",
  context: [], createdAt: 2, state: "completed", error: null, replyTo: request.id,
};
let chat: ChatDetail;
let model: boolean;

beforeEach(() => {
  api.call.mockReset();
  model = true;
  chat = { unread: 0, messages: [], actions: [], attachments: [], supportsImages: false };
  api.call.mockImplementation(async (route: string, input?: RouteInput<"sendChatMessage">) => {
    if (route === "listProjects") return [];
    if (route === "getChat" || route === "getProjectChat") return chat;
    if (route === "getChatAgentSettings") return { effectiveModel: model ? { account: "test", model: "assistant" } : null };
    if (route === "markChatRead" || route === "markProjectChatRead") return { ok: true };
    if (route === "uploadChatAttachment") return { id: "attachment-1", messageId: null, name: "notes.txt", mime: "text/plain", size: 4 };
    if (route === "retryChatMessage") {
      chat = { ...chat, messages: [request, reply] };
      return { ok: true };
    }
    if (route === "sendChatMessage") {
      const sent: ChatMessageView = { id: "sent", role: "user", text: input?.body.text ?? "", context: [], createdAt: 3, state: "queued", error: null, replyTo: null };
      chat = { ...chat, messages: [...chat.messages, sent] };
      return { messageId: sent.id };
    }
    if (route === "clearChat") {
      chat = { ...chat, messages: [] };
      return { ok: true };
    }
    throw new Error(`Unexpected route ${route}`);
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("uploads a selected attachment and sends the draft when Enter is pressed", async () => {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
  render(<MemoryRouter><ChatPanel /></MemoryRouter>);
  expect(await screen.findByText("What can I help you with?")).toBeTruthy();
  const upload: HTMLElement = screen.getByLabelText("Attach files");
  await user.upload(upload, new File(["png"], "image.png", { type: "image/png" }));
  expect(await screen.findByText(/cannot read images/)).toBeTruthy();
  await user.upload(upload, new File(["note"], "notes.txt", { type: "text/plain" }));
  expect(screen.getByText("notes.txt")).toBeTruthy();
  expect(api.call.mock.calls.some(([route]) => route === "uploadChatAttachment")).toBe(false);

  const editor: HTMLTextAreaElement = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Message" });
  await user.type(editor, "Review this{Enter}");
  await waitFor(() => expect(api.call).toHaveBeenCalledWith("sendChatMessage", { body: { text: "Review this", attachmentIds: ["attachment-1"] } }));
  expect(api.call).toHaveBeenCalledWith("uploadChatAttachment", { body: { name: "notes.txt", mime: "text/plain", data: "bm90ZQ==" } });
  expect(editor.value).toBe("");
  expect(await screen.findByText("Review this")).toBeTruthy();
});

it("retries an interrupted turn, displays the reply as a table, and clears the conversation", async () => {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
  const interrupted: ChatMessageView = {
    id: "interrupted", role: "user", text: "Show the checks", context: [], createdAt: 1, state: "interrupted", error: "Engine stopped", replyTo: null,
  };
  chat = { ...chat, messages: [interrupted] };
  vi.stubGlobal("confirm", () => true);
  render(<MemoryRouter><ChatPanel /></MemoryRouter>);
  expect(await screen.findByText("Engine stopped")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("cell", { name: "Typecheck" })).toBeTruthy();
  expect(screen.getByRole("cell", { name: "Passed" })).toBeTruthy();
  expect(api.call).toHaveBeenCalledWith("retryChatMessage", { params: { id: "interrupted" } });
  await user.click(screen.getByRole("button", { name: "Clear conversation" }));
  expect(await screen.findByText("What can I help you with?")).toBeTruthy();
});

it("opens a project chat and links to its Project Manager settings when a model is missing", async () => {
  model = false;
  render(<MemoryRouter initialEntries={["/projects/demo"]}><ChatPanel /></MemoryRouter>);
  expect(await screen.findByText("No model for Project Manager")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Open agent card" }).getAttribute("href")).toBe("/agents/edit/agent-default");
  expect(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(true);
  expect(api.call).toHaveBeenCalledWith("getProjectChat", { params: { id: "demo" } });
});
