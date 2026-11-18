import { z } from "zod";
import { Argv, SchemaRef, platformValue } from "./common";

export const ErrorRule = z
  .object({
    pattern: z.string().min(1),
    in: z.enum(["error", "text"]),
    kind: z.enum(["quota", "rate_limit", "auth", "other"]),
    resetAt: z.string().nullable().default(null),
    resetFormat: z.enum(["epoch", "iso", "seconds"]).optional(),
  })
  .strict()
  .superRefine((r, ctx) => {
    try {
      new RegExp(r.pattern);
    } catch {
      ctx.addIssue({ code: "custom", path: ["pattern"], message: "invalid regular expression" });
    }
    if (r.resetAt !== null && r.resetFormat === undefined) ctx.addIssue({ code: "custom", path: ["resetFormat"], message: "required with resetAt" });
  });
export type ErrorRule = z.infer<typeof ErrorRule>;

const SessionConfigEntry = z.tuple([z.string().min(1), z.string()]);

export const Connector = z
  .object({
    $schema: SchemaRef,
    name: z.string().regex(/^[a-z][a-z0-9-]*$/),
    title: z.string().min(1),
    kind: z.enum(["native", "adapter"]),
    harness: z
      .object({
        program: z.string().min(1),
        versionArgs: z.array(z.string()),
        versionRange: z.string().min(1),
      })
      .strict(),
    command: Argv,
    env: z.record(z.string(), z.string()).default({}),
    configDirEnv: z.string().nullable().default(null),
    configDirFiles: z.array(z.object({ path: z.string().min(1), content: z.string() }).strict()).default([]),
    sessionConfig: z.array(SessionConfigEntry).default([]),
    sessionMeta: z.record(z.string(), z.unknown()).nullable().default(null),
    reader: z.enum(["claude-code", "codex"]).nullable().default(null),
    errors: z.array(ErrorRule).default([]),
    loginCommand: platformValue(Argv).nullable().default(null),
    loginUrlPattern: z.string().nullable().default(null),
    loginReadsCode: z.boolean().default(false),
    beforeLogin: platformValue(z.array(Argv)).optional(),
    beforeStart: platformValue(z.array(Argv)).optional(),
    identityCommand: Argv.nullable().default(null),
    identityField: z.string().nullable().default(null),
  })
  .strict();
export type Connector = z.infer<typeof Connector>;
