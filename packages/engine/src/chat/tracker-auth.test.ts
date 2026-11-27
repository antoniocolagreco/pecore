import { atlassianAccount, linearAccount } from "@pecore/schemas";
import { afterEach, expect, it, vi } from "vitest";
import { apiProject } from "../../test/api-project";
import { callProjectTracker, NodeProposal, runApprovedNode } from "./node-tools";
import type { Engine } from "../main";
import type * as Atlassian from "../accounts/atlassian";

const state = vi.hoisted(() => ({
  calls: [] as { account: string; server: string; name: string; args: Record<string, unknown> }[],
  expired: true,
}));

vi.mock("../accounts/atlassian", async (importOriginal) => {
  const actual = await importOriginal<typeof Atlassian>();
  return {
    ...actual,
    trackerBridgeTool: async (account: string, server: string, name: string, args: Record<string, unknown>) => {
      state.calls.push({ account, server, name, args });
      if (state.expired) throw new actual.TrackerMcpAuthError(account, server as "atlassian" | "linear");
      return name === "getAccessibleAtlassianResources"
        ? { resources: [{ url: "site-one.atlassian.net", products: [{ id: "jira" }] }] }
        : { site: args.cloudId ?? null, key: args.issueIdOrKey ?? null };
    },
  };
});

afterEach(() => {
  state.calls.length = 0;
  state.expired = true;
  vi.clearAllMocks();
});

async function serviceAccount(engine: Engine): Promise<void> {
  const accounts = engine.global().accounts.accounts;
  engine.configuration.write({ accounts: { accounts: [...accounts, atlassianAccount] } });
  await engine.reloadGlobal();
}

it("uses Jira from chat, confirms writes and rejects an approval after the account changes", async () => {
  const { engine, close } = await apiProject();
  try {
    await serviceAccount(engine);
    const { ctx } = engine.project("demo");
    ctx.project = { ...ctx.project, tracker: { provider: "jira", account: atlassianAccount.id } };
    const input = { ticketId: "TST-7", site: "site-two" };
    await expect(callProjectTracker(engine, "demo", "read_ticket", input)).rejects.toThrow("Sign in to Atlassian");
    state.expired = false;
    expect((await callProjectTracker(engine, "demo", "read_ticket", input)).value).toEqual({ untrusted: true, ticket: { site: "site-two", key: "TST-7" } });
    const snapshot = engine.global();
    vi.spyOn(engine, "global").mockReturnValue({ ...snapshot, settings: { ...snapshot.settings, protectedMode: true } });
    try {
      const before = state.calls.length;
      const proposed = await callProjectTracker(engine, "demo", "comment_ticket", { ...input, text: "Ship it" });
      expect(proposed.value).toEqual({ state: "awaiting_answer" });
      expect(state.calls).toHaveLength(before);
      const approval = NodeProposal.parse("nodeProposal" in proposed.target ? proposed.target.nodeProposal : null);
      await runApprovedNode(engine, approval);
      expect(state.calls.at(-1)).toMatchObject({ name: "addCommentToJiraIssue", args: { commentBody: "Ship it" } });
      ctx.serviceAccount = (id) => id === linearAccount.id ? linearAccount : undefined;
      ctx.project = { ...ctx.project, tracker: { provider: "linear", account: linearAccount.id } };
      await expect(runApprovedNode(engine, approval)).rejects.toThrow("account or ticket target changed");
      ctx.serviceAccount = (id) => id === atlassianAccount.id ? { ...atlassianAccount, user: "other@example.test" } : undefined;
      ctx.project = { ...ctx.project, tracker: { provider: "jira", account: atlassianAccount.id } };
      await expect(runApprovedNode(engine, approval)).rejects.toThrow("account or ticket target changed");
      ctx.serviceAccount = (id) => id === linearAccount.id ? linearAccount : undefined;
      ctx.project = { ...ctx.project, tracker: { provider: "linear", account: linearAccount.id } };
      await callProjectTracker(engine, "demo", "search_tickets", { query: "login" });
      expect(state.calls.at(-1)).toMatchObject({ name: "list_issues", args: { query: "login", limit: 30 } });
    } finally {
      vi.restoreAllMocks();
    }
  } finally {
    await close();
  }
});
