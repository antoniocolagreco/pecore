import { describe, expect, it } from "vitest";
import { ChatForm, chatFormProblem } from "./api";

const form: ChatForm = ChatForm.parse({
  title: "New project",
  questions: [
    { id: "how", prompt: "How do you want to start?", kind: "single", options: [{ label: "From a repository", recommended: true }, { label: "Clone only" }] },
    { id: "extras", prompt: "What should Mara set up?", kind: "multiple", options: [{ label: "Recipes" }, { label: "Knowledge" }] },
    { id: "url", prompt: "Repository URL", kind: "text", placeholder: "https://…" },
  ],
});

describe("chat forms", () => {
  it("refuse choice questions with fewer than 2 options, text questions with options, and repeated ids or labels", () => {
    expect(ChatForm.safeParse({ questions: [{ id: "a", prompt: "Pick", kind: "single", options: [{ label: "Only" }] }] }).success).toBe(false);
    expect(ChatForm.safeParse({ questions: [{ id: "a", prompt: "Type", kind: "text", options: [{ label: "X" }, { label: "Y" }] }] }).success).toBe(false);
    expect(ChatForm.safeParse({ questions: [{ id: "a", prompt: "Pick", kind: "single", options: [{ label: "X" }, { label: "X" }] }] }).success).toBe(false);
    expect(ChatForm.safeParse({ questions: [{ id: "a", prompt: "One", kind: "text" }, { id: "a", prompt: "Two", kind: "text" }] }).success).toBe(false);
    expect(ChatForm.safeParse({ questions: [] }).success).toBe(false);
  });

  it("accept one answer per single question, at least one per multiple question, and text for text questions", () => {
    expect(chatFormProblem(form, {
      how: { choices: ["From a repository"], text: "" },
      extras: { choices: ["Recipes"], text: "Tickets" },
      url: { choices: [], text: "https://example.com/shop.git" },
    })).toBeNull();
    expect(chatFormProblem(form, {
      how: { choices: [], text: "Import an archive" },
      extras: { choices: [], text: "Nothing yet" },
      url: { choices: [], text: "https://example.com/shop.git" },
    })).toBeNull();
  });

  it("explain what is missing or wrong", () => {
    const url = { choices: [], text: "https://example.com/shop.git" };
    const extras = { choices: ["Knowledge"], text: "" };
    expect(chatFormProblem(form, { extras, url })).toBe('Answer "How do you want to start?".');
    expect(chatFormProblem(form, { how: { choices: ["From a repository"], text: "Other" }, extras, url })).toBe('Pick one answer for "How do you want to start?".');
    expect(chatFormProblem(form, { how: { choices: ["Delete everything"], text: "" }, extras, url })).toBe('"How do you want to start?" has an unknown choice.');
    expect(chatFormProblem(form, { how: { choices: ["Clone only"], text: "" }, extras, url: { choices: [], text: "" } })).toBe('Answer "Repository URL".');
  });
});
