import type { ArtifactType } from "@pecore/schemas";

export const artifactTypeLabels: Record<ArtifactType, string> = {
  diff: "Diff", spec: "Spec", code_review: "Code review", code_analysis: "Code analysis", sha: "Commit SHA",
  pull_request: "Pull request", feedback: "Feedback", log: "Log",
};

export const artifactTypeExamples: Record<ArtifactType, string> = {
  diff: "Changes to the code, generated from Git.",
  spec: "A feature and the scenarios that describe how it works.",
  code_review: "A general review with comments on specific lines or hunks.",
  code_analysis: "A summary and a risk classification for each hunk.",
  sha: "The SHA of a Git commit.",
  pull_request: "The title and body of a pull request, plus its URL after delivery.",
  feedback: "What needs to change before the work can continue.",
  log: "Output from running a node, such as errors from TypeScript.",
};
