import { describe, expect, it } from "vitest";
import { scanSecrets, secretRules } from "./secrets";

const samples: Record<string, string> = {
  "github-pat": "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8",
  "github-fine-grained-pat": "github_pat_" + "11ABCDEFG0123456789abc_" + "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456",
  "github-oauth": "gho_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8",
  "github-app-token": "ghs_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8",
  "github-refresh-token": "ghr_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8",
  "gitlab-pat": "glpat-" + "a1B2c3D4e5F6g7H8i9J0",
  "aws-access-key": "AKIA" + "IOSFODNN7EXAMPLE",
  "slack-token": "xoxb-" + "123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx",
  "slack-webhook": "https://hooks.slack.com/services/" + "T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "stripe-key": "sk_live_" + "4eC39HqLyjWDarjtT1zdp7dc",
  "anthropic-api-key": "sk-ant-api03-" + "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyz-AA",
  "openai-api-key": "sk-proj-" + "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  "gcp-api-key": "AIza" + "SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q",
  "npm-token": "npm_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8",
  "pypi-token": "pypi-AgEIcHlwaS5vcmc" + "CJGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6YWJjZGVmZ2hpamtsbW5vcA",
  "huggingface-token": "hf_" + "AbCdEfGhIjKlMnOpQrStUvWxYz01234567",
  "atlassian-api-token": "ATATT3" + "xFfGF0" + "A".repeat(180),
  "jwt": "eyJhbGciOiJIUzI1NiJ9." + "eyJzdWIiOiIxMjM0NTY3ODkwIn0." + "dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
  "private-key": "-----BEGIN OPENSSH " + "PRIVATE KEY-----",
};

describe("secret scan before a project export with history (decision 89)", () => {
  it("has one sample per rule, and each rule finds only its own sample", () => {
    expect(Object.keys(samples).sort()).toEqual(Object.keys(secretRules).sort());
    for (const [rule, pattern] of Object.entries(secretRules)) {
      expect(Object.entries(samples).filter(([, sample]) => pattern.test(`token ${sample} end`)).map(([name]) => name), rule).toEqual([rule]);
    }
  });

  it("ignores ordinary text and short look-alikes", () => {
    for (const text of ["ghp_short", "the AKIA prefix alone", "sk-ant-api03-short", "eyJ.eyJ.x", "password=hunter2", "-----BEGIN PUBLIC KEY-----"]) {
      expect(Object.entries(secretRules).filter(([, pattern]) => pattern.test(text)).map(([name]) => name), text).toEqual([]);
    }
  });

  it("reports file, line and rule of each match without the secret", () => {
    expect(scanSecrets([])).toEqual([]);
    const findings = scanSecrets([
      { file: "job/run/log.txt", content: Buffer.from(`first line\nexport GH=${samples["github-pat"]!}\nlast line\n`) },
      { file: "job/run/clean.txt", content: Buffer.from("nothing here\n") },
    ]);
    expect(findings).toEqual([{ fingerprint: "job/run/log.txt:github-pat:2", file: "job/run/log.txt", line: 2, rule: "github-pat" }]);
    expect(JSON.stringify(findings)).not.toContain(samples["github-pat"]!);
  });
});
