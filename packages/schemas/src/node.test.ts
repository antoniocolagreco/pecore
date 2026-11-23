import { describe, expect, it } from "vitest";
import { Node, placeholderEnvName, StoredNode, unknownPlaceholders } from "./node";

const githubPr = {
  $schema: "../../../schemas/node.json",
  name: "github-pr",
  description: "Open a pull request on GitHub for the pushed job branch, or move an existing one to the job's target branch",
  kind: "command",
  runsAs: "engine",
  credentials: ["project.account"],
  inputs: ["commit", "spec"],
  outputs: ["delivery"],
  outcomes: ["opened", "failed"],
  failOutcomes: ["failed"],
  changesFiles: false,
  script: "github-pr.sh",
  outcomeRules: [
    { exitCode: 0, outcome: "opened" },
    { exitCode: "other", outcome: "failed" },
  ],
  outputRules: { delivery: { stdoutLastLine: "url" } },
  probe: ["gh", "pr", "list", "--repo", "{project.repo.owner}/{project.repo.name}", "--head", "{job.branch}", "--base", "{job.target}", "--json", "url", "--jq", ".[0].url // empty"],
  timeoutSec: 120,
};

it("reads a legacy human decision without carrying unused fields forward", () => {
  const legacy = {
    name: "pick", description: "Choose a branch", kind: "human", mode: "decision",
    outcomes: ["approve", "cancel"], show: ["diff"], changesFiles: false, timeoutSec: 2592000,
  };
  const loaded: Node = StoredNode.parse(legacy);
  expect(loaded).toMatchObject({ kind: "human", mode: "decision", outcomes: ["approve", "cancel"], show: ["diff"] });
  expect(loaded).not.toHaveProperty("changesFiles");
  expect(loaded).not.toHaveProperty("timeoutSec");
  expect(Node.safeParse(legacy).success).toBe(false);
});

it("preserves the outcomes of stored split human definitions", () => {
  const decision: Node = StoredNode.parse({ name: "pick", description: "Choose a branch", kind: "human-decision", outcomes: ["accept", "decline"] });
  const review: Node = StoredNode.parse({ name: "custom-review", description: "Review a report", kind: "human-review", show: ["diff"], outcomes: ["accept", "reject"] });
  expect(decision).toMatchObject({ kind: "human", mode: "decision", outcomes: ["accept", "decline"] });
  expect(review).toMatchObject({ kind: "human", mode: "review", outcomes: ["accept", "reject"] });
});

it("requires a mode on new human definitions and removes kind tags", () => {
  expect(Node.safeParse({ name: "pick", description: "Choose a branch", kind: "human", outcomes: ["yes", "no"] }).success).toBe(false);
  const decision: Node = Node.parse({ name: "pick", description: "Choose a branch", kind: "human", mode: "decision", outcomes: ["yes", "no"], tags: ["Human", "decision", "Run command"] });
  expect(decision).toMatchObject({ kind: "human", mode: "decision", tags: ["decision"] });
});

const builder = {
  name: "builder",
  description: "Fills the stubs; never edits tests",
  kind: "agent",
  prompt: "builder.md",
  agent: { tier: "strong" },
  inputs: ["spec"],
  outputs: [],
  outcomes: ["done", "tests_disputed"],
  changesFiles: true,
  timeoutSec: 3600,
  outputSchema: { type: "object", properties: { outcome: { enum: ["done", "tests_disputed"] } }, required: ["outcome"] },
};

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

  it("rejects output rules for types not in outputs", () => {
    expect(issues({ ...githubPr, outputRules: { spec: { file: "x" } } })).toContain("outputRules.spec: spec is not in outputs");
  });

  it("rejects unknown placeholders in argument arrays", () => {
    expect(issues({ ...githubPr, probe: ["gh", "{job.secret}"] })).toContain("probe.1: unknown placeholder {job.secret}");
  });

  it("requires an outcome property in the agent output schema", () => {
    expect(issues({ ...builder, outputSchema: { type: "object" } })).toContain("outputSchema: outputSchema needs a property outcome");
  });

  it("requires exactly one of tier and profiles on agent nodes", () => {
    expect(issues({ ...builder, agent: {} })).toContain("agent: exactly one of tier and profiles");
  });

  it("rejects unknown fields", () => {
    expect(issues({ ...builder, colour: "red" }).length).toBeGreaterThan(0);
  });
});

describe("placeholders", () => {
  it("knows every placeholder of design 3.1", () => {
    const all = "{params.suite} {job.id} {job.title} {job.branch} {job.base} {job.oldBase} {job.target} {job.commit} {ticket.id} {workdir} {project.repoDir} {project.repo.url} {project.repo.owner} {project.repo.name} {inputs.spec.path} {inputs.check-log.path}";
    expect(unknownPlaceholders(all)).toEqual([]);
  });

  it("rejects inputs of unknown artifact types and source placeholders outside sources", () => {
    expect(unknownPlaceholders("{inputs.secret.path} {comment.path}")).toEqual(["{inputs.secret.path}", "{comment.path}"]);
    expect(unknownPlaceholders("{comment.path}", { source: true })).toEqual([]);
  });

  it("ignores jq expressions", () => {
    expect(unknownPlaceholders('select(.state=="MERGED") | .state')).toEqual([]);
  });

  it("names environment variables as in design 3.1", () => {
    expect(placeholderEnvName("job.branch")).toBe("PECORE_JOB_BRANCH");
    expect(placeholderEnvName("project.repoDir")).toBe("PECORE_PROJECT_REPODIR");
    expect(placeholderEnvName("inputs.spec.path")).toBe("PECORE_INPUTS_SPEC_PATH");
  });
});
