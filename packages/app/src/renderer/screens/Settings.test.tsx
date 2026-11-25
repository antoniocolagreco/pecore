import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Accounts, Settings as SettingsSchema } from "@pecore/schemas";
import type { LiveMessage, RouteInput } from "@pecore/schemas";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Settings } from "./Settings";

const api = vi.hoisted(() => ({ call: vi.fn(), listeners: new Set<(message: LiveMessage) => void>() }));

vi.mock("../api/client", () => ({ call: api.call }));
vi.mock("../api/live", async () => {
  const { useEffect } = await import("react");
  return {
    useConnected: () => true,
    onLive: () => () => undefined,
    useLive(listener: (message: LiveMessage) => void): void {
      useEffect(() => {
        api.listeners.add(listener);
        return () => { api.listeners.delete(listener); };
      }, [listener]);
    },
  };
});

beforeEach(() => {
  api.call.mockReset();
  api.call.mockImplementation(async (route: string) => {
    if (route === "getSettings") return { value: SettingsSchema.parse({}), sha256: "settings-v1" };
    if (route === "getAccounts") return { value: Accounts.parse({}), sha256: "accounts-v1" };
    if (route === "getStatus") return { homeFindings: [], globalPause: false, notifications: 0, interrupted: 0, version: "test" };
    if (route === "putSettings") return { sha256: "settings-v2" };
    if (route === "getForgeAccountDefaults") return { author: { name: "Local Author", email: "local@example.com" }, codeCommit: null };
    throw new Error(`Unexpected route ${route}`);
  });
});

afterEach(cleanup);

it("loads preferences and saves the updated name with its current revision", async () => {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
  render(<MemoryRouter><Settings /></MemoryRouter>);
  const name: HTMLElement = await screen.findByRole("textbox", { name: "Your name" });
  expect(screen.queryByRole("button", { name: "Assistant" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Project Manager" })).toBeNull();
  await user.type(name, "Antonio");

  await waitFor(() => expect(api.call).toHaveBeenCalledWith("putSettings", {
    body: { value: expect.objectContaining({ user: { name: "Antonio" } }), baseSha256: "settings-v1" },
  }), { timeout: 1500 });
});

it("selects a bundled theme from Appearance", async () => {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
  render(<MemoryRouter><Settings /></MemoryRouter>);
  const theme: HTMLElement = await screen.findByRole("combobox", { name: "Theme" });
  await user.click(theme);
  await user.click(await screen.findByRole("option", { name: "Autumn" }));
  await waitFor(() => expect(api.call).toHaveBeenCalledWith("putSettings", {
    body: { value: expect.objectContaining({ ui: { theme: "builtin:autumn" } }), baseSha256: "settings-v1" },
  }), { timeout: 1500 });
});

it.each([
  { service: "GitHub", placeholder: "github.com", server: true, aws: false, required: false },
  { service: "GitLab", placeholder: "gitlab.com", server: true, aws: false, required: false },
  { service: "AWS CodeCommit", placeholder: "", server: false, aws: true, required: false },
  { service: "Private Git server", placeholder: "git.example.com", server: true, aws: false, required: true },
])("only asks for the fields needed by $service", async ({ service, placeholder, server, aws, required }) => {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
  render(<MemoryRouter><Settings /></MemoryRouter>);
  const add: HTMLButtonElement = await screen.findByRole("button", { name: "Add account" });
  await waitFor(() => expect(add.disabled).toBe(false));
  await user.click(add);
  const dialog = within(await screen.findByRole("dialog", { name: "Add a Git hosting account" }));
  const picker: HTMLElement = dialog.getByRole("combobox", { name: "Service" });
  if (service !== "GitHub") {
    picker.focus();
    await user.keyboard("{ArrowDown}");
    await user.click(await screen.findByRole("option", { name: service }));
  }
  expect(dialog.queryByRole("textbox", { name: "Username" })).toBeNull();
  const host: HTMLInputElement | null = dialog.queryByRole("textbox", { name: "Server" });
  const profile: HTMLInputElement | null = dialog.queryByRole("textbox", { name: "AWS profile" });
  expect(!!host).toBe(server);
  expect(!!profile).toBe(aws);
  if (host) {
    expect(host.placeholder).toBe(placeholder);
    expect(host.required).toBe(required);
  }
  if (profile) expect(profile.value).toBe("default");
  const name: HTMLInputElement = dialog.getByRole("textbox", { name: "Commit author name" });
  const email: HTMLInputElement = dialog.getByRole("textbox", { name: "Commit author email" });
  await waitFor(() => expect(name.value).toBe("Local Author"));
  expect(email.value).toBe("local@example.com");
  await user.clear(name);
  await user.type(name, "Edited");
  expect(name.value).toBe("Edited");
});

it.each([
  { service: "GitHub", id: "gh-github-com", host: "github.com", user: "", login: true },
  { service: "GitLab", id: "glab-gitlab-com", host: "gitlab.com", user: "", login: true },
  { service: "AWS CodeCommit", id: "aws-default", host: "git-codecommit.eu-west-1.amazonaws.com", user: "ada", login: false },
  { service: "Private Git server", id: "git-git-example-com", host: "git.example.com", user: "", login: false },
])("saves a $service account with blank author fields and allows later edits", async ({ service, id, host, user: username, login }) => {
  let accounts: Accounts = { accounts: [] };
  let hash: string = "account-v1";
  api.call.mockImplementation(async (route: string, input?: RouteInput<"putAccounts"> | RouteInput<"getForgeAccountDefaults">) => {
    if (route === "getSettings") return { value: SettingsSchema.parse({}), sha256: "settings-v1" };
    if (route === "getAccounts") return { value: accounts, sha256: hash };
    if (route === "getStatus") return { homeFindings: [], globalPause: false, notifications: 0, interrupted: 0, version: "test" };
    if (route === "getForgeAccountDefaults") return {
      author: { name: "", email: "" },
      codeCommit: input?.query?.awsProfile === "default" ? { host, user: username } : null,
    };
    if (route === "listLogins") return [];
    if (route === "recheckAccount") return { state: "logged_out" };
    if (route === "startAccountLogin") return { loginId: `tool:${id}` };
    if (route === "putAccounts" && input?.body) {
      accounts = Accounts.parse(input.body.value);
      hash += "-next";
      return { sha256: hash };
    }
    throw new Error(`Unexpected route ${route}`);
  });
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
  render(<MemoryRouter><Settings /></MemoryRouter>);
  const add: HTMLButtonElement = await screen.findByRole("button", { name: "Add account" });
  await waitFor(() => expect(add.disabled).toBe(false));
  await user.click(add);
  const dialog = within(await screen.findByRole("dialog"));
  if (service !== "GitHub") {
    dialog.getByRole("combobox", { name: "Service" }).focus();
    await user.keyboard("{ArrowDown}");
    await user.click(await screen.findByRole("option", { name: service }));
  }
  if (service === "Private Git server") await user.type(dialog.getByRole("textbox", { name: "Server" }), host);
  expect(dialog.getByRole<HTMLInputElement>("textbox", { name: "Commit author email" }).value).toBe("");
  const submit: HTMLButtonElement = dialog.getByRole("button", { name: "Add account" });
  await waitFor(() => expect(submit.disabled).toBe(false));
  await user.click(submit);
  if (login) {
    await waitFor(() => expect(api.call).toHaveBeenCalledWith("startAccountLogin", { params: { id } }));
    act(() => { for (const listener of [...api.listeners]) listener({ type: "login.progress", loginId: `tool:${id}`, text: "Login ended", url: null, done: true }); });
  }
  const editButton: HTMLButtonElement = await screen.findByRole("button", { name: "Edit" });
  if (!login) expect(api.call).not.toHaveBeenCalledWith("startAccountLogin", expect.anything());
  expect(accounts.accounts[0]).toMatchObject({ host, user: username, author: { name: "", email: "" }, ...(service === "AWS CodeCommit" && { awsProfile: "default" }) });
  await user.click(editButton);
  const edit = within(await screen.findByRole("dialog", { name: "Edit Git hosting account" }));
  const usernameField: HTMLElement = edit.getByRole("textbox", { name: "Username" });
  await user.clear(usernameField);
  await user.type(usernameField, "alice");
  await user.click(edit.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(accounts.accounts[0]).toMatchObject({ id, user: "alice" }));
});
