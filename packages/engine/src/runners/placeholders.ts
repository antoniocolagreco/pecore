import { placeholderEnvName } from "@pecore/schemas";

export type PlaceholderValues = Record<string, string>;

export class PlaceholderError extends Error {
  constructor(readonly placeholder: string) {
    super(`no value for placeholder {${placeholder}}`);
  }
}

const token = /\{([A-Za-z][A-Za-z0-9_.-]*)\}/g;

export function substitute(text: string, values: PlaceholderValues): string {
  return text.replace(token, (whole, name: string) => {
    const known = name.startsWith("params.") || name.startsWith("inputs.") || name.startsWith("job.") || name.startsWith("project.") || name.startsWith("ticket.") || name.startsWith("comment.") || name === "workdir";
    if (!known) return whole;
    const v = values[name];
    if (v === undefined) throw new PlaceholderError(name);
    return v;
  });
}

export function substituteArgv(argv: string[], values: PlaceholderValues): string[] {
  return argv.map((a) => substitute(a, values));
}

export function placeholderEnv(values: PlaceholderValues): Record<string, string> {
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [placeholderEnvName(k), v]));
}

export type PlaceholderContext = {
  job?: { id: string; title: string; branch: string; base: string; oldBase: string; target: string; commit: string | null };
  ticketId: string | null;
  commentPath?: string;
  workdir: string;
  project: { repoDir: string; repoUrl: string | null; baseBranch: string };
  params: Record<string, unknown>;
};

export function repoOwnerAndName(url: string): { owner: string; name: string } {
  const path = url.replace(/^[a-z+]+:\/\/[^/]+\//, "").replace(/^[^@]+@[^:]+:/, "").replace(/\.git$/, "").replace(/\/$/, "");
  const parts = path.split("/");
  const name = parts.pop() ?? "";
  return { owner: parts.join("/"), name };
}

export function placeholderValues(c: PlaceholderContext): PlaceholderValues {
  const v: PlaceholderValues = {
    workdir: c.workdir,
    "project.repoDir": c.project.repoDir,
    "project.baseBranch": c.project.baseBranch,
  };
  if (c.job) {
    for (const [key, value] of Object.entries(c.job)) if (value !== null) v[`job.${key}`] = value;
  }
  if (c.ticketId !== null) v["ticket.id"] = c.ticketId;
  if (c.commentPath !== undefined) v["comment.path"] = c.commentPath;
  if (c.project.repoUrl !== null) {
    const { owner, name } = repoOwnerAndName(c.project.repoUrl);
    v["project.repo.url"] = c.project.repoUrl;
    v["project.repo.owner"] = owner;
    v["project.repo.name"] = name;
  }
  for (const [k, val] of Object.entries(c.params)) v[`params.${k}`] = typeof val === "string" ? val : JSON.stringify(val);
  return v;
}

export function paramsWithDefaults(schema: Record<string, unknown>, overrides: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const props = (schema.properties ?? {}) as Record<string, { default?: unknown }>;
  for (const [k, p] of Object.entries(props)) if (p && "default" in p) out[k] = p.default;
  return { ...out, ...overrides };
}
