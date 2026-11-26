import { describe, expect, it } from "vitest";
import { JobDefinitions } from "./job-definitions";
import type { NodeInput } from "./node";
import { AgentNode, automaticOutputs, Node, placeholderEnvName, unknownPlaceholders } from "./node";

const githubPr = {
  name: "github-pr",
  description: "Open a pull request on GitHub for the pushed job branch, or move an existing one to the job's target branch",
  kind: "repository",
  account: "project.account",
  inputs: ["spec"],
  optionalInputs: ["pull_request"],
  outcomes: ["opened", "failed"],
  outputs: { opened: "sha" },
  failOutcomes: ["failed"],
  changesFiles: false,
  script: 'gh pr create --head "$PECORE_JOB_BRANCH"',
  outcomeRules: [
    { exitCode: 0, outcome: "opened" },
    { exitCode: "other", outcome: "failed" },
  ],
  outputRules: { opened: { stdoutLastLine: "url" } },
  probe: ["gh", "pr", "list", "--repo", "{project.repo.owner}/{project.repo.name}", "--head", "{job.branch}", "--base", "{job.target}", "--json", "url", "--jq", ".[0].url // empty"],
  timeoutSec: 120,
};

const builder = {
  name: "builder",
  description: "Fills the stubs; never edits tests",
  kind: "agent",
  prompt: "builder.md",
  agent: { tier: "strong" },
  outcomes: ["done", "tests_disputed"],
  outputs: { tests_disputed: "feedback" },
  changesFiles: true,
  timeoutSec: 3600,
};

const review = { name: "review", description: "Review the job", kind: "human", interface: "code-review", outcomes: ["approve", "changes", "reject"], outputs: { changes: "feedback" } };

const issues = (value: unknown) => {
  const r = Node.safeParse(value);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
};

describe("node schema", () => {
  it("validates Tracker permissions only on Agent nodes", () => {
    expect(AgentNode.parse(builder).tracker).toBeUndefined();
    expect(AgentNode.parse({ ...builder, tracker: { access: "read", account: "atlassian" } }).tracker)
      .toEqual({ access: "read", account: "atlassian" });
    expect(AgentNode.safeParse({ ...builder, tracker: { access: "read-write" } }).success).toBe(false);
    expect(AgentNode.safeParse({ ...builder, tracker: { access: "none", account: "atlassian" } }).success).toBe(false);
    expect(Node.safeParse({ ...githubPr, tracker: { access: "read", account: "atlassian" } }).success).toBe(false);
  });

  it("accepts the delivery node of design 3.1", () => {
    expect(issues(githubPr)).toEqual([]);
    const n = Node.parse(githubPr);
    expect(n.kind === "repository" && n.retry).toBe(1);
  });

  it("accepts an agent node and fills defaults", () => {
    const n = Node.parse(builder);
    expect(n.kind === "agent" && n.agentSession).toBe("job");
    const empty: Node = Node.parse({ ...builder, outputs: undefined });
    expect(empty.kind === "agent" && empty.outputs).toEqual({});
  });

  it("validates agent session values and reads older agent definitions", () => {
    const node: Node = Node.parse({ ...builder, resume: true, agentContext: "isolated" });
    expect(node).toMatchObject({ agentSession: "new" });
    expect(node).not.toHaveProperty("resume");
    expect(node).not.toHaveProperty("agentContext");
    expect(Node.parse({ ...builder, agentContext: "shared" })).toMatchObject({ agentSession: "job" });
    for (const agentSession of ["job", "node", "new"]) {
      expect(Node.parse({ ...builder, agentSession })).toMatchObject({ agentSession });
    }
    expect(Node.safeParse({ ...builder, agentSession: "shared" }).success).toBe(false);
    expect(Node.safeParse({ ...githubPr, agentSession: "node" }).success).toBe(false);
    expect(Node.safeParse({ ...githubPr, agentContext: "isolated" }).success).toBe(false);
  });

  it("gives each outcome at most one output, of a known type, on a known outcome", () => {
    expect(issues({ ...builder, outputs: { done: "feedback", tests_disputed: "code_review" } })).toEqual([]);
    expect(issues({ ...builder, outputs: { merged: "feedback" } })).toContain("outputs.merged: merged is not in outcomes");
    expect(issues({ ...builder, outputs: { done: "risk" } }).length).toBeGreaterThan(0);
    expect(issues({ ...builder, outputs: { done: ["feedback", "spec"] } }).length).toBeGreaterThan(0);
  });

  it("declares inputs only on commands", () => {
    expect(issues({ ...builder, inputs: ["spec"] }).length).toBeGreaterThan(0);
    expect(issues({ ...review, inputs: ["diff"] }).length).toBeGreaterThan(0);
    expect(issues({ ...githubPr, optionalInputs: ["spec"] })).toContain("optionalInputs.0: spec is already a required input");
  });

  it("drops the agent output schema", () => {
    expect(issues({ ...builder, outputSchema: { type: "object" } }).length).toBeGreaterThan(0);
  });

  it("requires an account and a script for a Repository node and accepts nodes without repeat checks", () => {
    expect(issues({ ...githubPr, account: undefined })).toContain("account: Choose a Git hosting account.");
    expect(issues({ ...githubPr, script: "" })).toContain("script: Enter a repository script.");
    expect(issues({ ...githubPr, probe: undefined })).toEqual([]);
  });

  it("requires exactly one command or script file and rejects credentials on Command nodes", () => {
    const command: NodeInput = { name: "check", description: "Run a check", kind: "command",
      changesFiles: false, timeoutSec: 30, outcomes: ["done"], outcomeRules: [{ exitCode: 0, outcome: "done" }] };
    expect(issues({ ...command, command: ["true"], script: "check.sh" })).toContain("command: exactly one of command and script");
    expect(issues(command)).toContain("command: exactly one of command and script");
    expect(issues({ ...command, command: ["true"] })).toEqual([]);
    for (const removed of [{ account: "gh-user" }, { credentials: ["gh-user"] }, { runsAs: "engine" }, { probe: ["true"] }]) {
      expect(Node.safeParse({ ...command, command: ["true"], ...removed }).success).toBe(false);
    }
  });

  it("rejects failOutcomes and rule outcomes not in outcomes", () => {
    expect(issues({ ...githubPr, failOutcomes: ["broken"] })).toContain("failOutcomes.0: broken is not in outcomes");
    expect(issues({ ...githubPr, outcomeRules: [{ exitCode: 0, outcome: "merged" }] })).toContain("outcomeRules.0.outcome: merged is not in outcomes");
  });

  it("pairs each command output with an output rule on the same outcome", () => {
    expect(issues({ ...githubPr, outputRules: { failed: { file: "x" } } })).toEqual(expect.arrayContaining(["outputRules.failed: failed has no output", "outputs.opened: opened needs an output rule"]));
  });

  it("rejects unknown placeholders in argument arrays", () => {
    expect(issues({ name: "check", description: "Run a check", kind: "command", command: ["gh", "{job.secret}"],
      changesFiles: false, timeoutSec: 30, outcomes: ["done"], outcomeRules: [{ exitCode: 0, outcome: "done" }] })).toContain("command.1: unknown placeholder {job.secret}");
  });

  it("requires exactly one of tier and profiles on agent nodes", () => {
    expect(issues({ ...builder, agent: {} })).toContain("agent: exactly one of tier and profiles");
  });

  it("rejects unknown fields", () => {
    expect(issues({ ...builder, colour: "red" }).length).toBeGreaterThan(0);
  });

  it("lists the outputs the engine adds", () => {
    expect(automaticOutputs(Node.parse(builder))).toEqual(["diff"]);
    expect(automaticOutputs(Node.parse(githubPr))).toEqual([]);
    expect(automaticOutputs(Node.parse(review))).toEqual([]);
  });
});

it("rejects the former CLI Tracker kind", () => {
  const input = { kind: "tracker", name: "read-ticket", description: "Read a ticket", provider: "github",
    account: "project.account", script: "echo checked", outcomes: ["done"], outcomeRules: [{ exitCode: 0, outcome: "done" }] };
  expect(Node.safeParse(input).success).toBe(false);
});

it("rejects the former MCP Tracker kind", () => {
  const node = { kind: "tracker", mode: "mcp", provider: "jira", name: "jira-mcp", description: "Read Jira",
    server: "atlassian", tool: "getJiraIssue", account: "atlassian", arguments: { cloudId: "{params.cloudId}" },
    outcomes: ["done"], outputs: { done: "document" }, outcomeRules: [{ exitCode: 0, outcome: "done" }] };
  expect(Node.safeParse(node).success).toBe(false);
});

it("reads a saved delivery with its old script and repeat check", () => {
  const old: Record<string, unknown> = {
    name: "publish", kind: "command", description: "Publish the branch", runsAs: "engine",
    credentials: ["gh-user"], script: "publish.sh", probe: { script: "check.sh" },
    timeoutSec: 30, changesFiles: false, outcomes: ["done"], outcomeRules: [{ exitCode: 0, outcome: "done" }],
  };
  const snapshot: JobDefinitions = JobDefinitions.parse({
    recipeHash: "a".repeat(64),
    nodes: { publish: { definition: old, sidecars: { "publish.sh": "gh pr create", "check.sh": "gh pr view" }, hash: "b".repeat(64) } },
  });
  expect(snapshot.nodes.publish?.definition).toMatchObject({
    kind: "repository", account: "gh-user", script: "gh pr create", probe: { script: "check.sh" },
  });
  expect(snapshot.nodes.publish?.sidecars["check.sh"]).toBe("gh pr view");
});

describe("human node", () => {
  it("chooses an interface and removes kind tags", () => {
    expect(issues({ ...review, interface: undefined }).length).toBeGreaterThan(0);
    expect(issues({ ...review, interface: "video-call" }).length).toBeGreaterThan(0);
    const decision: Node = Node.parse({ name: "pick", description: "Choose a branch", kind: "human", interface: "decision", outcomes: ["yes", "no"], tags: ["Human", "decision", "Run command"] });
    expect(decision).toMatchObject({ kind: "human", interface: "decision", tags: ["decision"] });
  });

  it("gives review interfaces result names and reads legacy reviews", () => {
    expect(issues(review)).toEqual([]);
    expect(issues({ ...review, interface: "report-review", outcomes: ["approved", "changes_requested", "rejected"], outputs: { changes_requested: "feedback" } })).toEqual([]);
    expect(issues({ ...review, outcomes: ["approve", "reject"], outputs: {} })).toEqual(["outcomes: Code review needs approved, changes_requested, rejected"]);
  });

  it("lets a person write feedback or a code review", () => {
    expect(issues({ ...review, outputs: { changes: "code_analysis" } })).toEqual(["outputs.changes: Choose feedback or a code review for human input."]);
  });

  it("rejects the old mode, view and answer fields", () => {
    expect(issues({ ...review, mode: "review" }).length).toBeGreaterThan(0);
    expect(issues({ ...review, reviewView: "code" }).length).toBeGreaterThan(0);
    expect(issues({ ...review, answer: true }).length).toBeGreaterThan(0);
  });
});

describe("placeholders", () => {
  it("knows every placeholder of design 3.1", () => {
    const all = "{params.suite} {job.id} {job.title} {job.branch} {job.base} {job.oldBase} {job.target} {job.commit} {ticket.id} {workdir} {project.repoDir} {project.repo.url} {project.repo.owner} {project.repo.name}";
    expect(unknownPlaceholders(all)).toEqual([]);
  });

  it("rejects input path placeholders and source placeholders outside sources", () => {
    expect(unknownPlaceholders("{inputs.spec.path} {comment.path}")).toEqual(["{inputs.spec.path}", "{comment.path}"]);
  });

  it("ignores jq expressions", () => {
    expect(unknownPlaceholders('select(.state=="MERGED") | .state')).toEqual([]);
  });

  it("names environment variables as in design 3.1", () => {
    expect(placeholderEnvName("job.branch")).toBe("PECORE_JOB_BRANCH");
    expect(placeholderEnvName("project.repoDir")).toBe("PECORE_PROJECT_REPODIR");
    expect(placeholderEnvName("ticket.id")).toBe("PECORE_TICKET_ID");
  });
});
