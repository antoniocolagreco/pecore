import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "../../test/tmp";
import { gitApp } from "../workdir/git-as";
import { createLocalRepo } from "../workdir/repo";
import { readComposeFile } from "./compose-file";
import { composeProjectName } from "./runtime";

function hasCompose(): boolean {
  try {
    execFileSync("docker", ["compose", "version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function repoWith(source: string) {
  const repo = join(await tempDir(), "repo.git");
  const parent = await createLocalRepo(repo, "main");
  const blob = (await gitApp(repo, ["hash-object", "-w", "--stdin"], { input: source })).trim();
  const tree = (await gitApp(repo, ["mktree"], { input: `100644 blob ${blob}\tcompose.yaml\n` })).trim();
  const commit = (await gitApp(repo, ["commit-tree", tree, "-p", parent, "-m", "compose"])).trim();
  return { repo, commit };
}

const valid = `services:
  db:
    image: postgres:17
    environment:
      POSTGRES_PASSWORD: test
    ports:
      - "127.0.0.1::5432"
    healthcheck:
      test: ["CMD", "pg_isready"]
    volumes:
      - data:/var/lib/postgresql/data
    depends_on:
      migrate:
        condition: service_completed_successfully
  migrate:
    image: busybox:1
    command: ["true"]
volumes:
  data: {}
`;

async function rejects(source: string, message: RegExp) {
  const { repo, commit } = await repoWith(source);
  await expect(readComposeFile(repo, commit, "compose.yaml", "docker")).rejects.toThrow(message);
}

describe("compose project names", () => {
  it("uses pecore- and the lower-case job id", () => {
    expect(composeProjectName("01JABCDEF")).toBe("pecore-01jabcdef");
    expect(() => composeProjectName("../x")).toThrow();
  });
});

describe.skipIf(!hasCompose())("compose file allowlist (design 4.9)", () => {
  it("reads the file from the base commit and returns services, ports and the confirmed bytes", async () => {
    const { repo, commit } = await repoWith(valid);
    const file = await readComposeFile(repo, commit, "compose.yaml", "docker");
    expect(file.services.sort()).toEqual(["db", "migrate"]);
    expect(file.completedServices).toEqual(["migrate"]);
    expect(file.ports).toEqual([{ service: "db", port: 5432, variable: "PECORE_SERVICE_DB_5432" }]);
    expect(file.sha256).toBe(createHash("sha256").update(file.bytes).digest("hex"));
    expect(Object.keys(JSON.parse(file.bytes.toString()))).toEqual(["services", "volumes"]);
  });

  it("rejects keys that load files from the host", async () => {
    await rejects("include:\n  - other.yaml\nservices:\n  a:\n    image: busybox:1\n", /include/);
    await rejects("services:\n  a:\n    image: busybox:1\n    env_file: .env\n", /env_file/);
  });

  it("rejects bind mounts, ports not on loopback and keys outside the allowlist", async () => {
    await rejects("services:\n  a:\n    image: busybox:1\n    volumes:\n      - /etc:/host\n", /named volume/);
    await rejects("services:\n  a:\n    image: busybox:1\n    ports:\n      - \"5432:5432\"\n", /127\.0\.0\.1::/);
    await rejects("services:\n  a:\n    image: busybox:1\n    privileged: true\n", /privileged is not allowed/);
    await rejects("services:\n  a:\n    image: busybox:1\n    network_mode: host\n", /network_mode is not allowed/);
  });

  it("rejects paths outside the repository and bases that are not commit hashes", async () => {
    const { repo, commit } = await repoWith(valid);
    await expect(readComposeFile(repo, commit, "../compose.yaml", "docker")).rejects.toThrow("relative");
    await expect(readComposeFile(repo, "main", "compose.yaml", "docker")).rejects.toThrow("commit hash");
  });
});
