import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { ExportProjectResult } from "@pecore/schemas";

type Finding = Extract<ExportProjectResult, { state: "findings" }>["findings"][number];

export const secretRules: Readonly<Record<string, RegExp>> = {
  "github-pat": /\bghp_[A-Za-z0-9]{36}\b/,
  "github-fine-grained-pat": /\bgithub_pat_[A-Za-z0-9_]{82}\b/,
  "github-oauth": /\bgho_[A-Za-z0-9]{36}\b/,
  "github-app-token": /\bgh[us]_[A-Za-z0-9]{36}\b/,
  "github-refresh-token": /\bghr_[A-Za-z0-9]{36}\b/,
  "gitlab-pat": /\bglpat-[A-Za-z0-9_-]{20,}\b/,
  "aws-access-key": /\b(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/,
  "slack-token": /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  "slack-webhook": /https:\/\/hooks\.slack\.com\/(?:services|workflows)\/[A-Za-z0-9+/]{40,}/,
  "stripe-key": /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{24,}\b/,
  "anthropic-api-key": /\bsk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{80,}/,
  "openai-api-key": /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{40,}/,
  "gcp-api-key": /\bAIza[0-9A-Za-z_-]{35}\b/,
  "npm-token": /\bnpm_[A-Za-z0-9]{36}\b/,
  "pypi-token": /\bpypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{50,}/,
  "huggingface-token": /\bhf_[A-Za-z0-9]{34}\b/,
  "atlassian-api-token": /\bATATT3[A-Za-z0-9_=-]{180,}/,
  "jwt": /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  "private-key": /-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----/,
};

export async function scanSecrets(dir: string): Promise<Finding[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const files: string[] = entries.filter((entry) => entry.isFile()).map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join("/")).sort();
  const findings: Finding[] = [];
  for (const file of files) {
    const lines: string[] = (await readFile(join(dir, file), "utf8")).split("\n");
    for (const [index, text] of lines.entries()) {
      for (const [rule, pattern] of Object.entries(secretRules)) {
        if (pattern.test(text)) findings.push({ fingerprint: `${file}:${rule}:${index + 1}`, file, line: index + 1, rule });
      }
    }
  }
  return findings;
}
