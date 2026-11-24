import { describe, expect, it } from "vitest";
import { automaticOutputs, Node, placeholderEnvName, unknownPlaceholders } from "./node";

const githubPr = {
  $schema: "../../../schemas/node.json",
  name: "github-pr",
  description: "Open a pull request on GitHub for the pushed job branch, or move an existing one to the job's target branch",
  kind: "command",
  runsAs: "engine",
  credentials: ["project.account"],
  inputs: ["spec"],
  optionalInputs: ["document"],
  outcomes: ["opened", "failed"],
  outputs: { opened: "reference" },
  failOutcomes: ["failed"],
  changesFiles: false,
  script: "github-pr.sh",
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
  outputs: { tests_disputed: "text" },
  changesFiles: true,
  timeoutSec: 3600,
};

const review = { name: "review", description: "Review the job", kind: "human", interface: "code-review", outcomes: ["approve", "changes", "reject"], outputs: { changes: "text" } };

const issues = (value: unknown) => {
  const r = Node.safeParse(value);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
};

describe("node schema", () => {
  it("accepts the delivery node of design 3.1", () => {
    expect(issues(githubPr)).toEqual([]);
    const n = Node.parse(githubPr);
    expect(n.kind === "command" && n.retry).toBe(1);
  });

  it("accepts an agent node and fills defaults", () => {
    const n = Node.parse(builder);
    expect(n.kind === "agent" && n.resume).toBe(false);
    const empty: Node = Node.parse({ ...builder, outputs: undefined });
    expect(empty.kind === "agent" && empty.outputs).toEqual({});
  });

  it("gives each outcome at most one output, of a known type, on a known outcome", () => {
    expect(issues({ ...builder, outputs: { done: "text", tests_disputed: "findings" } })).toEqual([]);
    expect(issues({ ...builder, outputs: { merged: "text" } })).toContain("outputs.merged: merged is not in outcomes");
    expect(issues({ ...builder, outputs: { done: "risk" } }).length).toBeGreaterThan(0);
    expect(issues({ ...builder, outputs: { done: ["text", "spec"] } }).length).toBeGreaterThan(0);
  });

  it("declares inputs only on commands", () => {
    expect(issues({ ...builder, inputs: ["spec"] }).length).toBeGreaterThan(0);
    expect(issues({ ...review, inputs: ["diff"] }).length).toBeGreaterThan(0);
    expect(issues({ ...githubPr, optionalInputs: ["spec"] })).toContain("optionalInputs.0: spec is already a required input");
  });

  it("drops the agent output schema", () => {
    expect(issues({ ...builder, outputSchema: { type: "object" } }).length).toBeGreaterThan(0);
  });

  it("requires a probe on runsAs: engine", () => {
    expect(issues({ ...githubPr, probe: undefined })).toContain("probe: a runsAs: engine node needs a probe");
  });

  it("requires exactly one of command and script", () => {
    expect(issues({ ...githubPr, command: ["true"] })).toContain("command: exactly one of command and script");
    expect(issues({ ...githubPr, script: undefined })).toContain("command: exactly one of command and script");
  });

  it("rejects credentials on project-user nodes", () => {
    expect(issues({ ...githubPr, runsAs: "project-user" })).toContain("credentials: credentials need runsAs: engine");
  });

  it("rejects failOutcomes and rule outcomes not in outcomes", () => {
    expect(issues({ ...githubPr, failOutcomes: ["broken"] })).toContain("failOutcomes.0: broken is not in outcomes");
    expect(issues({ ...githubPr, outcomeRules: [{ exitCode: 0, outcome: "merged" }] })).toContain("outcomeRules.0.outcome: merged is not in outcomes");
  });

  it("pairs each command output with an output rule on the same outcome", () => {
    expect(issues({ ...githubPr, outputRules: { failed: { file: "x" } } })).toEqual(expect.arrayContaining(["outputRules.failed: failed has no output", "outputs.opened: opened needs an output rule"]));
  });

  it("rejects unknown placeholders in argument arrays", () => {
    expect(issues({ ...githubPr, probe: ["gh", "{job.secret}"] })).toContain("probe.1: unknown placeholder {job.secret}");
  });

  it("requires exactly one of tier and profiles on agent nodes", () => {
    expect(issues({ ...builder, agent: {} })).toContain("agent: exactly one of tier and profiles");
  });

  it("rejects unknown fields", () => {
    expect(issues({ ...builder, colour: "red" }).length).toBeGreaterThan(0);
  });

  it("lists the outputs the engine adds", () => {
    expect(automaticOutputs(Node.parse(builder))).toEqual(["diff"]);
    expect(automaticOutputs(Node.parse(githubPr))).toEqual(["text"]);
    expect(automaticOutputs(Node.parse(review))).toEqual([]);
  });
});

describe("human node", () => {
  it("chooses an interface and removes kind tags", () => {
    expect(issues({ ...review, interface: undefined }).length).toBeGreaterThan(0);
    expect(issues({ ...review, interface: "video-call" }).length).toBeGreaterThan(0);
    const decision: Node = Node.parse({ name: "pick", description: "Choose a branch", kind: "human", interface: "decision", outcomes: ["yes", "no"], tags: ["Human", "decision", "Run command"] });
    expect(decision).toMatchObject({ kind: "human", interface: "decision", tags: ["decision"] });
  });

  it("gives the review interfaces approve, changes and reject", () => {
    expect(issues(review)).toEqual([]);
    expect(issues({ ...review, interface: "report-review" })).toEqual([]);
    expect(issues({ ...review, outcomes: ["approve", "reject"], outputs: {} })).toEqual(["outcomes: Code review needs approve, changes, reject"]);
  });

  it("lets a person write only text", () => {
    expect(issues({ ...review, outputs: { changes: "findings" } })).toEqual(["outputs.changes: a person can only write text"]);
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
    expect(unknownPlaceholders("{comment.path}", { source: true })).toEqual([]);
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
