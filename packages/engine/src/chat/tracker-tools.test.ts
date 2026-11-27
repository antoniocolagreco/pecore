import { atlassianAccount, linearAccount, Project } from "@pecore/schemas";
import type { ForgeAccount } from "@pecore/schemas";
import { afterEach, expect, it, vi } from "vitest";
import * as bridge from "../accounts/atlassian";
import * as jira from "../accounts/jira";
import * as forgeEnv from "../runners/forge-env";
import * as process from "../runners/process";
import { bindTrackerSite, callTracker, trackerAccount, trackerTool } from "./tracker-tools";

const github: ForgeAccount = {
  id: "gh-account", kind: "forge", forge: "github", tool: "gh", host: "github.com", user: "alice",
  author: { name: "Alice", email: "alice@example.test" },
};
const gitlab: ForgeAccount = {
  id: "gl-account", kind: "forge", forge: "gitlab", tool: "glab", host: "gitlab.com", user: "bob",
  author: { name: "Bob", email: "bob@example.test" },
};
const ctx = {
  project: Project.parse({ id: "example", name: "Example", repo: { url: "git@github.com:team/repo.git", account: github.id } }),
  forgeAccount: (id: string): ForgeAccount | undefined => [github, gitlab].find((account) => account.id === id),
  serviceAccount: (id: string) => [atlassianAccount, linearAccount].find((account) => account.id === id),
  serviceAccounts: () => [atlassianAccount, linearAccount],
};

const success = (value: unknown): process.RunResult => ({ stdout: JSON.stringify(value), stderr: "", code: 0, signal: null, timedOut: false });

afterEach(() => vi.restoreAllMocks());

it("keeps GitHub credentials in the CLI call and refuses ticket links on a different host", async () => {
  vi.spyOn(forgeEnv, "forgeEnv").mockResolvedValue({ GH_TOKEN: "test-token" });
  vi.spyOn(process, "baseEnv").mockResolvedValue({ HOME: "/private" });
  const run = vi.spyOn(process, "run").mockResolvedValue(success({ title: "Hello", body: "Token: test-token" }));
  const account = await trackerAccount(ctx, "project.account");
  const result: unknown = await callTracker(ctx, account, trackerTool("read_ticket", { ticketId: "9" }, "read"));
  expect(result).toEqual({ untrusted: true, ticket: { title: "Hello", body: "Token: [redacted]" } });
  expect(run).toHaveBeenCalledWith(expect.objectContaining({
    argv: ["gh", "api", "--hostname", "github.com", "--method", "GET", "repos/team/repo/issues/9"],
    env: { HOME: "/private", GH_TOKEN: "test-token" },
  }));
  await expect(callTracker(ctx, account, trackerTool("read_ticket", { ticketId: "https://example.test/team/repo/issues/9" }, "read"))).rejects.toThrow("selected account");
  expect(run).toHaveBeenCalledTimes(1);
  await callTracker(ctx, account, trackerTool("update_ticket_fields", {
    ticketId: "9", fields: { projectField: { project: 1, owner: "team", name: "Status", value: "In review" } },
  }, "read-write"));
  expect(run.mock.lastCall?.[0].argv).toEqual([
    "gh", "project", "item-edit", "1", "--owner", "team", "--url", "https://github.com/team/repo/issues/9",
    "--field", "Status", "--value", "In review", "--format", "json",
  ]);
});

it("updates a custom GitLab field by the selected work item's global ID", async () => {
  vi.spyOn(forgeEnv, "forgeEnv").mockResolvedValue({ GITLAB_TOKEN: "outside-agent" });
  vi.spyOn(process, "baseEnv").mockResolvedValue({ HOME: "/private" });
  const run = vi.spyOn(process, "run")
    .mockResolvedValueOnce(success({ id: 442 }))
    .mockResolvedValueOnce(success({ data: { workItemUpdate: { errors: [], workItem: { id: "gid://gitlab/WorkItem/442" } } } }));
  const account = await trackerAccount(ctx, gitlab.id);
  const update = trackerTool("update_ticket_fields", {
    ticketId: "https://gitlab.com/team/sub/repo/-/issues/6",
    fields: { customFields: [{ customFieldId: "gid://gitlab/Issuables::CustomField/55", numberValue: 3 }] },
  }, "read-write");
  await expect(callTracker(ctx, account, update)).resolves.toEqual({ untrusted: true, result: { id: "gid://gitlab/WorkItem/442" } });
  expect(run.mock.calls[0]?.[0].argv.at(-1)).toBe("projects/team%2Fsub%2Frepo/issues/6");
  expect(run.mock.calls[1]?.[0].argv).toEqual(["glab", "api", "--hostname", "gitlab.com", "--method", "POST", "graphql", "--input", "-"]);
  expect(JSON.parse(String(run.mock.calls[1]?.[0].input))).toMatchObject({
    variables: { input: { id: "gid://gitlab/WorkItem/442", customFieldsWidget: [{ customFieldId: "gid://gitlab/Issuables::CustomField/55", numberValue: 3 }] } },
  });
});

it("binds Jira writes to the site's Cloud ID and forwards custom fields", async () => {
  const tool = vi.spyOn(bridge, "trackerBridgeTool")
    .mockResolvedValueOnce([{ cloudId: "first", url: "https://one.atlassian.net" }, { cloudId: "second", url: "https://two.atlassian.net" }])
    .mockResolvedValueOnce({ ok: true });
  const account = await trackerAccount(ctx, atlassianAccount.id);
  const update = trackerTool("update_ticket_fields", {
    ticketId: "https://two.atlassian.net/browse/TST-7?filter=active", fields: { customfield_10055: "value" },
  }, "read-write");
  const bound = await bindTrackerSite(account, update);
  expect(bound.args.site).toBe("second");
  await callTracker(ctx, account, bound);
  expect(tool.mock.calls.map(([, , name]) => name)).toEqual(["getAccessibleAtlassianResources", "editJiraIssue"]);
  expect(tool.mock.lastCall).toEqual([atlassianAccount.id, "atlassian", "editJiraIssue", {
    cloudId: "second", issueIdOrKey: "TST-7", fields: { customfield_10055: "value" },
  }]);
});

it("maps Linear links and passes the intended status and fields to the bridge", async () => {
  const tool = vi.spyOn(bridge, "trackerBridgeTool").mockResolvedValue({ ok: true });
  const account = await trackerAccount(ctx, linearAccount.id);
  const ticketId: string = "https://linear.app/workspace/issue/ENG-3/login";
  await callTracker(ctx, account, trackerTool("change_ticket_status", { ticketId, status: "In Review" }, "read-write"));
  await callTracker(ctx, account, trackerTool("update_ticket_fields", { ticketId, fields: { priority: 2 } }, "read-write"));
  expect(tool.mock.calls).toEqual([
    [linearAccount.id, "linear", "save_issue", { id: "ENG-3", state: "In Review" }],
    [linearAccount.id, "linear", "save_issue", { id: "ENG-3", priority: 2 }],
  ]);
});

it("prefers verified Jira MCP access for automatic calls to the requested site", async () => {
  vi.spyOn(jira, "activeJiraAccount").mockResolvedValue({
    account: { id: "jira-alice", kind: "service", service: "Jira", tool: "acli", user: "alice@example.test" }, site: "one.atlassian.net",
  });
  vi.spyOn(bridge, "trackerBridgeTool").mockResolvedValue({
    data: { resources: [
      { cloudId: "first", url: "https://one.atlassian.net" },
      { cloudId: "second", url: "https://two.atlassian.net" },
    ] },
  });
  const account = await trackerAccount(ctx, "active-jira", { ticketId: "https://two.atlassian.net/browse/TST-7" });
  expect(account).toMatchObject({ id: atlassianAccount.id, bridge: "atlassian", site: "second" });
});

it("falls back to the active Jira CLI login when MCP cannot reach the same site", async () => {
  vi.spyOn(jira, "activeJiraAccount").mockResolvedValue({
    account: { id: "jira-alice", kind: "service", service: "Jira", tool: "acli", user: "alice@example.test" }, site: "two.atlassian.net",
  });
  vi.spyOn(bridge, "trackerBridgeTool").mockResolvedValue({
    data: { resources: [{ cloudId: "first", url: "https://one.atlassian.net" }] },
  });
  const account = await trackerAccount(ctx, "active-jira", { ticketId: "https://two.atlassian.net/browse/TST-7" });
  expect(account).toMatchObject({ id: "jira-alice", jira: "two.atlassian.net" });
});

it("refuses an automatic Jira call when neither transport reaches the requested site", async () => {
  vi.spyOn(jira, "activeJiraAccount").mockResolvedValue({
    account: { id: "jira-alice", kind: "service", service: "Jira", tool: "acli", user: "alice@example.test" }, site: "one.atlassian.net",
  });
  vi.spyOn(bridge, "trackerBridgeTool").mockResolvedValue({
    data: { resources: [{ cloudId: "first", url: "https://one.atlassian.net" }] },
  });
  await expect(trackerAccount(ctx, "active-jira", { ticketId: "https://three.atlassian.net/browse/TST-7" }))
    .rejects.toThrow("cannot reach this Jira site");
});

it("refuses an automatic Jira CLI fallback for a different site", async () => {
  vi.spyOn(jira, "activeJiraAccount").mockResolvedValue({
    account: { id: "jira-alice", kind: "service", service: "Jira", tool: "acli", user: "alice@example.test" }, site: "one.atlassian.net",
  });
  const cliOnly = {
    ...ctx,
    serviceAccount: (id: string) => id === linearAccount.id ? linearAccount : undefined,
    serviceAccounts: () => [linearAccount],
  };
  await expect(trackerAccount(cliOnly, "active-jira", { site: "https://two.atlassian.net" }))
    .rejects.toThrow("cannot reach this Jira site");
});

it("keeps an explicit Jira CLI account selection on the CLI", async () => {
  const active = vi.spyOn(jira, "activeJiraAccount").mockResolvedValue({
    account: { id: "jira-alice", kind: "service", service: "Jira", tool: "acli", user: "alice@example.test" }, site: "one.atlassian.net",
  });
  const bridgeTool = vi.spyOn(bridge, "trackerBridgeTool");
  const account = await trackerAccount(ctx, "jira-alice", { ticketId: "https://one.atlassian.net/browse/TST-7" });
  expect(account).toMatchObject({ id: "jira-alice", jira: "one.atlassian.net" });
  expect(active).toHaveBeenCalled();
  expect(bridgeTool).not.toHaveBeenCalled();
});

it("refuses a Jira CLI search on a different site", async () => {
  vi.spyOn(process, "baseEnv").mockResolvedValue({ HOME: "/private" });
  const run = vi.spyOn(process, "run").mockResolvedValue(success({ issues: [] }));
  const account = { id: "jira-alice", jira: "one.atlassian.net", user: "alice@example.test" };
  await expect(callTracker(ctx, account, trackerTool("search_tickets", { query: "login", site: "https://two.atlassian.net" }, "read")))
    .rejects.toThrow("active Jira site");
  expect(run).not.toHaveBeenCalled();
});

it("reports the Jira CLI transition-ID limitation", async () => {
  vi.spyOn(process, "baseEnv").mockResolvedValue({ HOME: "/private" });
  const run = vi.spyOn(process, "run").mockResolvedValue(success({ updated: true }));
  const account = { id: "jira-alice", jira: "one.atlassian.net", user: "alice@example.test" };
  await expect(callTracker(ctx, account, trackerTool("change_ticket_status", {
    ticketId: "https://one.atlassian.net/browse/TST-7", status: "31",
  }, "read-write"))).rejects.toThrow("status name");
  expect(run).not.toHaveBeenCalled();
});

it("edits ordinary Jira CLI fields on the active site and sends custom fields to MCP", async () => {
  vi.spyOn(jira, "activeJiraAccount").mockResolvedValue({
    account: { id: "jira-alice", kind: "service", service: "Jira", tool: "acli", user: "alice@example.test" }, site: "team.atlassian.net",
  });
  vi.spyOn(bridge, "trackerBridgeTool").mockRejectedValue(new bridge.TrackerMcpAuthError(atlassianAccount.id, "atlassian"));
  vi.spyOn(process, "baseEnv").mockResolvedValue({ HOME: "/private" });
  const run = vi.spyOn(process, "run").mockResolvedValue(success({ updated: true }));
  const account = await trackerAccount(ctx, "active-jira", { ticketId: "https://team.atlassian.net/browse/ENG-3" });
  const ticketId: string = "https://team.atlassian.net/browse/ENG-3";
  await callTracker(ctx, account, trackerTool("update_ticket_fields", { ticketId, fields: { labels: ["bug", "web"], summary: "Login" } }, "read-write"));
  expect(run.mock.lastCall?.[0].argv).toEqual([
    "acli", "jira", "workitem", "edit", "--key", "ENG-3", "--yes", "--summary=Login", "--labels=bug,web", "--json",
  ]);
  await expect(callTracker(ctx, account, trackerTool("update_ticket_fields", {
    ticketId, fields: { customfield_10055: "new" },
  }, "read-write"))).rejects.toThrow("Atlassian MCP account");
  expect(run).toHaveBeenCalledTimes(1);
});
