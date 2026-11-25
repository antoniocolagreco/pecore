import { z } from "zod";

const AccountId = z.string().regex(/^[a-z][a-z0-9-]*$/);

export const ModelAccount = z
  .object({
    id: AccountId,
    kind: z.literal("model"),
    provider: z.string().min(1),
    connector: z.string().min(1),
    login: z.enum(["subscription", "api-key"]),
    email: z.email().nullable().default(null),
    maxParallel: z.number().int().positive().default(2),
  })
  .strict();

export const ForgeKind = z.enum(["github", "gitlab", "codecommit", "git"]);
export type ForgeKind = z.infer<typeof ForgeKind>;
export const forgeServices = {
  github: { host: "github.com", tool: "gh", label: "GitHub" },
  gitlab: { host: "gitlab.com", tool: "glab", label: "GitLab" },
  codecommit: { host: "", tool: "aws", label: "AWS CodeCommit" },
  git: { host: "", tool: "git", label: "Private Git server" },
} as const;

export const CommitAuthor = z.object({ name: z.string(), email: z.union([z.email(), z.literal("")]) }).strict();
export type CommitAuthor = z.infer<typeof CommitAuthor>;

export const ForgeAccount = z
  .object({
    id: AccountId,
    kind: z.literal("forge"),
    forge: ForgeKind,
    host: z.string().min(1),
    tool: z.enum(["gh", "glab", "aws", "git"]),
    user: z.string(),
    awsProfile: z.string().trim().min(1).optional(),
    author: CommitAuthor,
  })
  .strict();

export function forgeHost(host: string): string {
  return host.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/^[^@/]*@/, "").split("/")[0]!.toLowerCase();
}

export const ServiceAccount = z
  .object({
    id: AccountId,
    kind: z.literal("service"),
    service: z.string().min(1),
    tool: z.string().min(1),
    user: z.string().min(1),
  })
  .strict();

export const Account = z.discriminatedUnion("kind", [ModelAccount, ForgeAccount, ServiceAccount]);
export type Account = z.infer<typeof Account>;
export type ModelAccount = z.infer<typeof ModelAccount>;
export type ForgeAccount = z.infer<typeof ForgeAccount>;

export function codeCommitProfile(account: ForgeAccount): string {
  return account.awsProfile ?? (account.user || "default");
}

export function nextForgeAccountId(tool: ForgeAccount["tool"], hint: string, taken: ReadonlySet<string>): string {
  const base: string = `${tool}-${hint.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "account"}`;
  let id: string = base;
  for (let suffix: number = 2; taken.has(id); suffix++) id = `${base}-${suffix}`;
  return id;
}
export type ServiceAccount = z.infer<typeof ServiceAccount>;
export const atlassianAccount: ServiceAccount = {
  id: "atlassian", kind: "service", service: "Atlassian", tool: "atlassian", user: "Atlassian account",
};

export const Accounts = z
  .object({
    accounts: z.array(Account).default([]),
  })
  .strict()
  .superRefine((a, ctx) => {
    const seen = new Set<string>();
    for (const [i, acc] of a.accounts.entries()) {
      if (seen.has(acc.id)) ctx.addIssue({ code: "custom", path: ["accounts", i, "id"], message: `duplicate id ${acc.id}` });
      seen.add(acc.id);
    }
  });
export type Accounts = z.infer<typeof Accounts>;

export function withForgeHosts(file: Accounts): Accounts {
  return { ...file, accounts: file.accounts.map((account) => account.kind === "forge" ? { ...account, host: forgeHost(account.host) } : account) };
}
