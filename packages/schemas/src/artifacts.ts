import { z } from "zod";

export const ArtifactType = z.enum(["text", "diff", "document", "spec", "findings", "reference"]);
export type ArtifactType = z.infer<typeof ArtifactType>;

export const Artifact = z.object({
  type: ArtifactType.or(z.literal("attachment")),
  jobId: z.string().min(1),
  run: z.string().min(1),
  name: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  contentState: z.string().nullable(),
});
export type Artifact = z.infer<typeof Artifact>;

export const DocumentArtifact = z.object({
  title: z.string(),
  body: z.string(),
  source: z.string().nullable().optional(),
  id: z.string().nullable().optional(),
});
export type DocumentArtifact = z.infer<typeof DocumentArtifact>;

export const SpecArtifact = z.object({
  criteria: z.array(z.string()),
  tests: z.array(z.string()),
  interfaces: z.array(z.object({ name: z.string(), signature: z.string() })),
  optionalNodes: z.array(z.string()).default([]),
});
export type SpecArtifact = z.infer<typeof SpecArtifact>;

export const FindingsArtifact = z.object({
  verdict: z.string().optional(),
  items: z.array(
    z.object({
      file: z.string(),
      line: z.number().int().nonnegative().nullable().optional(),
      hunk: z.number().int().nonnegative().optional(),
      level: z.string(),
      text: z.string(),
    }),
  ),
});
export type FindingsArtifact = z.infer<typeof FindingsArtifact>;

export const ReferenceArtifact = z.object({
  sha: z.string().regex(/^[0-9a-f]{40,64}$/).optional(),
  url: z.string().optional(),
  ref: z.string().optional(),
  contentState: z.string().optional(),
});
export type ReferenceArtifact = z.infer<typeof ReferenceArtifact>;

export const artifactTypes: Readonly<Record<ArtifactType, { readonly description: string; readonly schema: z.ZodType | null }>> = {
  text: { description: "plain text, for example a command log, a reason or a note", schema: z.string() },
  diff: { description: "a patch of code changes", schema: z.string() },
  document: { description: "a title and a body, for example a ticket or a pull request description", schema: DocumentArtifact },
  spec: { description: "acceptance criteria, what tests must check, interfaces, and optional nodes to run", schema: SpecArtifact },
  findings: { description: "points in the code, each with file, line or hunk, level and text", schema: FindingsArtifact },
  reference: { description: "a pointer to something outside the files: commit sha, URL or ref", schema: ReferenceArtifact },
};
