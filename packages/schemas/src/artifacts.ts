import { z } from "zod";

export const ArtifactType = z.enum(["ticket", "spec", "findings", "risk", "check-log", "diff", "user-note", "commit", "delivery"]);
export type ArtifactType = z.infer<typeof ArtifactType>;

export const Artifact = z.object({
  type: ArtifactType.or(z.literal("attachment")),
  path: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  contentState: z.string().nullable(),
});
export type Artifact = z.infer<typeof Artifact>;

export const SpecArtifact = z.object({
  criteria: z.array(z.string()),
  tests: z.array(z.string()),
  interfaces: z.array(z.object({ name: z.string(), signature: z.string() })),
  optionalNodes: z.array(z.string()).default([]),
});
export type SpecArtifact = z.infer<typeof SpecArtifact>;

export const FindingsArtifact = z.object({
  verdict: z.string(),
  items: z.array(
    z.object({
      file: z.string(),
      line: z.number().int().nonnegative().nullable(),
      severity: z.string(),
      text: z.string(),
    }),
  ),
});
export type FindingsArtifact = z.infer<typeof FindingsArtifact>;

export const RiskArtifact = z.object({
  hunks: z.array(
    z.object({
      file: z.string(),
      hunkIndex: z.number().int().nonnegative(),
      level: z.enum(["safe", "risky"]),
      reason: z.string(),
    }),
  ),
});
export type RiskArtifact = z.infer<typeof RiskArtifact>;

export const CommitArtifact = z.object({
  sha: z.string().regex(/^[0-9a-f]{40,64}$/),
  contentState: z.string(),
});
export type CommitArtifact = z.infer<typeof CommitArtifact>;

export const DeliveryArtifact = z.object({
  url: z.string().optional(),
  ref: z.string().optional(),
});
export type DeliveryArtifact = z.infer<typeof DeliveryArtifact>;
