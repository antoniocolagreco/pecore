import { expect, it } from "vitest";
import { ArtifactType, CodeAnalysisArtifact, CodeReviewArtifact, NodeOutputType, PullRequestArtifact, ShaArtifact, SpecArtifact } from "./artifacts";

it("accepts a BDD scenario and rejects a spec with no scenarios or actions", () => {
  const scenario = { name: "Restore session", given: ["A saved session"], when: "The app starts", then: ["The session is restored"], examples: [{ mode: "dark" }] };
  expect(SpecArtifact.safeParse({ feature: "Restore sessions", scenarios: [scenario] }).success).toBe(true);
  expect(SpecArtifact.safeParse({ feature: "Restore sessions", scenarios: [] }).success).toBe(false);
  expect(SpecArtifact.safeParse({ feature: "Restore sessions", scenarios: [{ ...scenario, when: "" }] }).success).toBe(false);
});

it("keeps review comments distinct from the risk analysis", () => {
  const line = { file: "app.ts", line: 3, text: "Use the existing schema." };
  const hunk = { file: "app.ts", hunk: 0, level: "risky", text: "Changes API validation." };
  expect(CodeReviewArtifact.safeParse({ body: "", comments: [line] }).success).toBe(true);
  expect(CodeReviewArtifact.safeParse({ body: "", comments: [hunk] }).success).toBe(false);
  expect(CodeAnalysisArtifact.safeParse({ summary: "Validation change", hunks: [hunk] }).success).toBe(true);
  expect(CodeAnalysisArtifact.safeParse({ summary: "Validation change", hunks: [{ ...hunk, level: "warning" }] }).success).toBe(false);
});

it("allows a PR draft without a URL and reserves Diff for the engine", () => {
  expect(PullRequestArtifact.safeParse({ title: "Update API", body: "Use the request schema." }).success).toBe(true);
  expect(PullRequestArtifact.safeParse({ title: "", body: "", url: "branch" }).success).toBe(false);
  expect(ShaArtifact.safeParse("c".repeat(40)).success).toBe(true);
  expect(ShaArtifact.safeParse("feature").success).toBe(false);
  expect(ArtifactType.safeParse("diff").success).toBe(true);
  expect(NodeOutputType.safeParse("diff").success).toBe(false);
  expect(NodeOutputType.options).toEqual(["spec", "code_review", "code_analysis", "sha", "pull_request", "feedback", "log"]);
});
