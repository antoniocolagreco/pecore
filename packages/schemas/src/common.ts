import { z } from "zod";

export const SchemaRef = z.string().optional();

export const Name = z.string().regex(/^[a-z][a-z0-9-]*$/, "lower case letters, digits and dashes, starting with a letter");

export const Outcome = z.string().regex(/^[a-z][a-z0-9_]*$/, "lower case letters, digits and underscores, starting with a letter");

export const Argv = z.array(z.string()).min(1);

export const JsonSchemaObject = z.record(z.string(), z.unknown());

export const TierName = z.enum(["frontier", "strong", "standard", "cheap"]);
export type TierName = z.infer<typeof TierName>;

export function platformValue<T extends z.ZodType>(value: T) {
  return z.union([value, z.object({ linux: value.optional(), darwin: value.optional() }).strict()]);
}
