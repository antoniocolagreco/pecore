import { chmod, cp, lstat, readFile, rm, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { monotonicFactory } from "ulid";
import { artifactContentProblem, defaultAgentId } from "@pecore/schemas";
import type { AgentNode, ArtifactType, CommandNode, FailureReason, LiveMessage, Node, NodeAgent, NodeTestAnswerBody, NodeTestFile, NodeTestOutput, NodeTestRunBody, NodeTestView } from "@pecore/schemas";
import type { AgentQuestion } from "../runners/agent";
import type { AgentServices } from "../accounts/agents";
import { spawnFor } from "../accounts/agents";
import { nodeSidecars } from "../definitions/load";
import { homePaths } from "../home/layout";
import { logEvents } from "../observability/log-events";
import type { LogLine } from "../observability/logs";
import { privateDirectory } from "../osuser/acl";
import { runAgentNode } from "../runners/agent";
import { outcomeOutputs, runCommandNode } from "../runners/command";
import type { CommandInput } from "../runners/command";
import { paramsWithDefaults } from "../runners/placeholders";
import { appUser, baseEnv, killJobProcesses, run, stopGroup } from "../runners/process";
import { deleteScratch, restoreState } from "../workdir/files-hash";
import { gitWork, gitWorkResult } from "../workdir/git-as";

const ulid = monotonicFactory();

export class NodeTestError extends Error {
  constructor(
    readonly code: "bad_request" | "not_found" | "conflict",
    message: string,
  ) {
    super(message);
  }
}

export type NodeTestManagerOptions = {
  home: string;
  sampleProject: string;
  nodeDir: string;
  agents: () => AgentServices | null;
  agentCard: (id: string) => NodeAgent | undefined;
  agentContext: (id: string) => string;
  user: () => string;
  development: boolean;
  live: (message: LiveMessage) => void;
};

type TestState = {
  id: string;
  node: Node;
  sidecars: Record<string, string>;
  inputs: CommandInput[];
  params: Record<string, unknown>;
  user: string;
  folder: string;
  head: string;
  beforeTree: string;
  state: NodeTestView["state"];
  outcome: string | null;
  failureReason: FailureReason | null;
  outputs: NodeTestOutput[];
  diff: string;
  files: NodeTestFile[];
  question: NodeTestView["question"];
  error: string | null;
  logs: LogLine[];
  startedAt: number;
  endedAt: number | null;
  stopRequested: boolean;
  pgid: number | null;
  pending: AgentQuestion | null;
  done: Promise<void> | null;
};

function asyncExists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class NodeTestManager {
  private readonly tests = new Map<string, TestState>();
  private active: string | null = null;
  private lock: Promise<void> = Promise.resolve();

  constructor(private readonly opts: NodeTestManagerOptions) {}

  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    const previous: Promise<void> = this.lock;
    let release!: () => void;
    this.lock = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }

  run(body: NodeTestRunBody): Promise<string> {
    return this.exclusive(async () => {
      if (this.active !== null) throw new NodeTestError("conflict", "A node test is already running.");
      const node = body.node;
      if (node.kind === "repository") throw new NodeTestError("bad_request", "Repository nodes change real remotes and cannot be tested.");
      const inputs = this.checkedInputs(node, body.inputs);
      const sidecars = await this.sidecars(node, body.sidecars);
      const id = `node-test-${ulid()}`;
      this.active = id;
      const user = this.opts.user();
      let folder: string;
      let head: string;
      let beforeTree: string;
      try {
        folder = await this.ensureFolder();
        head = (await gitWork(user, folder, ["rev-parse", "HEAD"])).trim();
        beforeTree = await this.treeOf(folder, user);
      } catch (error) {
        this.active = null;
        throw error;
      }
      const test: TestState = {
        id,
        node,
        sidecars,
        inputs,
        params: paramsWithDefaults(node.params, undefined),
        user,
        folder,
        head,
        beforeTree,
        state: "running",
        outcome: null,
        failureReason: null,
        outputs: [],
        diff: "",
        files: [],
        question: null,
        error: null,
        logs: [],
        startedAt: Date.now(),
        endedAt: null,
        stopRequested: false,
        pgid: null,
        pending: null,
        done: null,
      };
      this.tests.set(id, test);
      this.changed(test);
      test.done = this.execute(test).catch(async (error: unknown) => {
        if (test.stopRequested) await this.finish(test, "stopped");
        else await this.fail(test, "HARNESS_ERROR", errorMessage(error));
      });
      return id;
    });
  }

  get(id: string): NodeTestView {
    return this.view(this.test(id));
  }

  logs(id: string): LogLine[] | null {
    return this.tests.get(id)?.logs ?? null;
  }

  stop(id: string): Promise<void> {
    return this.exclusive(() => this.stopTest(id));
  }

  answer(id: string, body: NodeTestAnswerBody): Promise<void> {
    return this.exclusive(() => this.answerTest(id, body));
  }

  reset(): Promise<void> {
    return this.exclusive(async () => {
      if (this.active !== null) await this.stopTest(this.active);
      await this.killAllProcesses();
      this.tests.clear();
      this.active = null;
      await this.removeFolder();
      await this.ensureFolder();
    });
  }

  close(): Promise<void> {
    return this.exclusive(async () => {
      if (this.active !== null) await this.stopTest(this.active).catch(() => undefined);
      await this.killAllProcesses();
    });
  }

  private async killAllProcesses(): Promise<void> {
    for (const test of this.tests.values()) await killJobProcesses(test.user, test.id).catch(() => undefined);
  }

  private async stopTest(id: string): Promise<void> {
    const test = this.test(id);
    if (test.state === "completed" || test.state === "failed" || test.state === "stopped") return;
    test.stopRequested = true;
    if (test.pgid !== null) await stopGroup(test.user, test.pgid);
    await killJobProcesses(test.user, test.id).catch(() => undefined);
    if (test.state === "waiting") {
      await this.finish(test, "stopped");
      return;
    }
    await test.done;
  }

  private async answerTest(id: string, body: NodeTestAnswerBody): Promise<void> {
    const test = this.test(id);
    if (test.state !== "waiting" || !test.question) throw new NodeTestError("bad_request", "This node test is not waiting for an answer.");
    if (test.question.kind === "human") {
      const choice = body.choice;
      if (!choice || !test.node.outcomes.includes(choice)) throw new NodeTestError("bad_request", "Choose one of the node's outcomes.");
      test.outcome = choice;
      const type = test.node.outputs[choice];
      const note = body.note.trim();
      if (type && note) test.outputs.push({ type, content: type === "code_review" ? JSON.stringify({ body: note, comments: [] }) : note });
      await this.finish(test, "completed");
      return;
    }
    if (!body.note.trim()) throw new NodeTestError("bad_request", "An answer is required.");
    const pending = test.pending;
    if (!pending) throw new NodeTestError("bad_request", "This node test has no question to answer.");
    test.question = null;
    test.pending = null;
    test.state = "running";
    test.error = null;
    this.changed(test);
    test.done = this.runAgent(test, { ...pending, answer: body.note.trim() }).catch(async (error: unknown) => {
      if (test.stopRequested) await this.finish(test, "stopped");
      else await this.fail(test, "HARNESS_ERROR", errorMessage(error));
    });
  }

  private test(id: string): TestState {
    const test = this.tests.get(id);
    if (!test) throw new NodeTestError("not_found", `node test ${id} not found`);
    return test;
  }

  private view(test: TestState): NodeTestView {
    return {
      id: test.id,
      state: test.state,
      outcome: test.outcome,
      failureReason: test.failureReason,
      outputs: test.outputs,
      diff: test.diff,
      files: test.files,
      question: test.question,
      error: test.error,
      startedAt: test.startedAt,
      endedAt: test.endedAt,
    };
  }

  private changed(test: TestState): void {
    this.opts.live({ type: "node_test.updated", testId: test.id });
  }

  private log(test: TestState, line: LogLine): void {
    test.logs.push(line);
    for (const event of logEvents(line)) this.opts.live({ type: "log.line", attemptId: test.id, event });
  }

  private async execute(test: TestState): Promise<void> {
    if (test.node.kind === "human") {
      const question = typeof test.params.question === "string" && test.params.question.trim() ? test.params.question.trim() : test.node.description;
      test.state = "waiting";
      test.question = {
        kind: "human",
        text: question,
        choices: [...test.node.outcomes],
        notes: test.node.outcomes.filter((outcome) => ["feedback", "code_review"].includes(test.node.outputs[outcome] ?? "")),
        inputs: test.inputs.map(({ type, content }) => ({ type, content })),
      };
      this.changed(test);
      return;
    }
    if (test.node.kind === "command") {
      await this.runCommand(test);
      return;
    }
    await this.runAgent(test, null);
  }

  private async runCommand(test: TestState): Promise<void> {
    const node = test.node as CommandNode;
    const result = await runCommandNode({
      node,
      outputs: outcomeOutputs(node),
      nodeDir: this.opts.nodeDir,
      sidecars: test.sidecars,
      params: test.params,
      user: test.user,
      workdir: test.folder,
      context: this.context(test),
      inputs: test.inputs,
      extraEnv: { PECORE_JOB_ID: test.id },
      onStart: (pgid) => {
        test.pgid = pgid;
        if (test.stopRequested) void stopGroup(test.user, pgid);
      },
      stopping: () => test.stopRequested,
    });
    test.pgid = null;
    if (result.log) this.log(test, { dir: "cmd", text: result.log, at: Date.now() });
    if (test.stopRequested) return this.finish(test, "stopped");
    if (result.kind === "completed") {
      test.outputs = result.outputs;
      test.outcome = result.outcome;
      await this.finish(test, "completed");
      return;
    }
    if (result.kind === "failed") return this.fail(test, result.reason, result.log);
    await this.fail(test, "HARNESS_ERROR", `The node is waiting for ${result.reason}.`);
  }

  private async runAgent(test: TestState, continuation: (AgentQuestion & { answer: string }) | null): Promise<void> {
    const node = test.node as AgentNode;
    if (node.tracker) return this.fail(test, "AGENT_UNAVAILABLE", "Tracker access is not available in a node test.");
    const agents = this.opts.agents();
    if (!agents) return this.fail(test, "AGENT_UNAVAILABLE", "No harness service is available.");
    const card = this.opts.agentCard(defaultAgentId);
    const model = card?.model;
    if (!card || !model) return this.fail(test, "AGENT_UNAVAILABLE", `Choose a provider and model on the ${card?.name ?? "Default Agent"} card.`);
    const account = agents.account(model.account);
    if (!account) return this.fail(test, "AGENT_UNAVAILABLE", `The model account ${model.account} is unavailable.`);
    let connector;
    try {
      connector = await agents.resolve(account.connector);
    } catch (error) {
      return this.fail(test, "AGENT_UNAVAILABLE", `${account.connector}: ${errorMessage(error)}`);
    }
    const login = await agents.login(account.id);
    test.user = login.osUser;
    test.pgid = null;
    const result = await runAgentNode({
      node,
      nodeDir: this.opts.nodeDir,
      sidecars: test.sidecars,
      params: test.params,
      user: login.osUser,
      workdir: test.folder,
      context: this.context(test),
      inputs: test.inputs.map(({ type, content }) => ({ type, content, from: "the test inputs" })),
      attachments: [],
      knowledge: [],
      development: this.opts.development,
      agentContext: this.opts.agentContext(card.id),
      connector,
      login,
      spawn: spawnFor(login.osUser, { PECORE_JOB_ID: test.id }),
      model: model.model,
      effort: model.effort,
      resumeId: null,
      ...(continuation ? { continuation } : {}),
      timeoutMs: node.timeoutSec * 1000,
      onStart: (pgid) => {
        test.pgid = pgid;
        if (test.stopRequested) void stopGroup(login.osUser, pgid);
      },
      onRaw: (line) => {
        this.log(test, line);
      },
    });
    test.pgid = null;
    if (test.stopRequested) return this.finish(test, "stopped");
    if (result.kind === "completed") {
      test.outputs = result.outputs;
      test.outcome = result.outcome;
      await this.finish(test, "completed");
      return;
    }
    if (result.kind === "question") {
      test.pending = result.pending;
      test.question = { kind: "agent", text: result.pending.question, choices: [], notes: [], inputs: [] };
      test.state = "waiting";
      this.changed(test);
      return;
    }
    if (result.kind === "waiting") return this.fail(test, result.reason === "auth" ? "AGENT_UNAVAILABLE" : "HARNESS_ERROR", result.detail);
    await this.fail(test, result.reason, result.detail);
  }

  private async fail(test: TestState, reason: FailureReason, error: string): Promise<void> {
    test.error = error || null;
    test.failureReason = reason;
    await this.finish(test, "failed");
  }

  private async finish(test: TestState, state: "completed" | "failed" | "stopped"): Promise<void> {
    let finalState = state;
    if (state === "completed" && test.node.kind !== "human") {
      try {
        await deleteScratch(test.user, test.folder, test.node.scratchPaths, test.beforeTree);
        if (!test.node.changesFiles) {
          const after: string = await this.treeOf(test.folder, test.user);
          if (after !== test.beforeTree) {
            await gitWorkResult(test.user, test.folder, ["reset", "--hard", test.head]);
            await restoreState(test.user, test.folder, test.beforeTree);
            test.failureReason = "READ_ONLY_VIOLATION";
            test.error = "The node changed files but is marked read-only.";
            test.outcome = null;
            test.outputs = [];
            finalState = "failed";
          }
        }
      } catch (error) {
        test.failureReason = "HARNESS_ERROR";
        test.error = `The node's files could not be checked: ${errorMessage(error)}`;
        finalState = "failed";
      }
    }
    if (finalState === "completed" && test.node.kind === "command") {
      for (const output of test.outputs) {
        const problem = artifactContentProblem(output.type, output.content);
        if (problem) {
          test.failureReason = "INVALID_OUTPUT";
          test.error = `The ${output.type} output is not valid: ${problem}`;
          test.outcome = null;
          test.outputs = [];
          finalState = "failed";
          break;
        }
      }
    }
    test.endedAt = Date.now();
    await this.recordChanges(test);
    test.state = finalState;
    test.question = null;
    test.pending = null;
    if (this.active === test.id) this.active = null;
    this.changed(test);
  }

  private async recordChanges(test: TestState): Promise<void> {
    try {
      const after = await this.treeOf(test.folder, test.user);
      if (after === test.beforeTree) return;
      test.diff = await gitWork(test.user, test.folder, ["diff", "--binary", "--no-color", test.beforeTree, after]);
      const names = await gitWork(test.user, test.folder, ["diff", "--name-status", "--no-renames", test.beforeTree, after]);
      test.files = names.split("\n").flatMap((line) => {
        const [status, ...path] = line.split("\t");
        return status && path.length ? [{ status, path: path.join("\t") }] : [];
      });
    } catch (error) {
      test.error ??= `The file changes could not be read: ${errorMessage(error)}`;
    }
  }

  private context(test: TestState): {
    job: { id: string; title: string; request: string; branch: string; base: string; oldBase: string; target: string; commit: string | null };
    ticketId: null;
    project: { repoDir: string; repoUrl: null; baseBranch: string };
  } {
    return {
      job: { id: test.id, title: test.node.name, request: test.node.description, branch: "test", base: test.head, oldBase: test.head, target: "main", commit: test.head },
      ticketId: null,
      project: { repoDir: join(test.folder, ".git"), repoUrl: null, baseBranch: "main" },
    };
  }

  private checkedInputs(node: Node, values: NodeTestRunBody["inputs"]): CommandInput[] {
    const declared: Set<ArtifactType> = node.kind === "command" ? new Set([...node.inputs, ...node.optionalInputs]) : new Set();
    const inputs: CommandInput[] = [];
    for (const [type, content] of Object.entries(values) as [ArtifactType, string | undefined][]) {
      if (content === undefined || content.trim() === "") continue;
      if (node.kind === "command" && !declared.has(type)) throw new NodeTestError("bad_request", `${node.name} does not take a ${type} input.`);
      const problem = artifactContentProblem(type, content);
      if (problem) throw new NodeTestError("bad_request", `The ${type} input is not valid: ${problem}`);
      inputs.push({ type, content });
    }
    if (node.kind === "command") {
      const missing = node.inputs.filter((type) => !inputs.some((input) => input.type === type));
      if (missing.length) throw new NodeTestError("bad_request", `Fill the ${missing.join(", ")} ${missing.length === 1 ? "input" : "inputs"}.`);
    }
    return inputs;
  }

  private async sidecars(node: Node, provided: Record<string, string>): Promise<Record<string, string>> {
    const sidecars = { ...provided };
    for (const [, name] of nodeSidecars(node)) {
      if (sidecars[name] !== undefined) continue;
      const content = await readFile(join(this.opts.nodeDir, name), "utf8").catch(() => undefined);
      if (content === undefined) throw new NodeTestError("bad_request", `The node's ${name} file is missing.`);
      sidecars[name] = content;
    }
    return sidecars;
  }

  private async ensureFolder(): Promise<string> {
    const folder = homePaths(this.opts.home).test;
    if (await asyncExists(join(folder, ".git"))) {
      const link = await lstat(folder);
      if (!link.isSymbolicLink()) {
        await this.makeAccessible(folder, true).catch(() => this.makeAccessible(folder, false));
        return folder;
      }
    }
    await this.removeFolder();
    try {
      await cp(this.opts.sampleProject, folder, { recursive: true, dereference: true });
    } catch (error) {
      throw new NodeTestError("bad_request", `The sample project could not be copied: ${errorMessage(error)}`);
    }
    await rm(join(folder, ".git"), { recursive: true, force: true });
    await chmod(folder, 0o700);
    const user = this.opts.user();
    await this.makeAccessible(folder, true);
    await gitWork(user, folder, ["init", "-q", "-b", "main"]);
    await gitWork(user, folder, ["add", "-A"]);
    await gitWork(user, folder, ["commit", "-q", "-m", "Sample project"]);
    return folder;
  }

  private async removeFolder(): Promise<void> {
    const folder = homePaths(this.opts.home).test;
    const info = await lstat(folder).catch(() => null);
    if (info?.isSymbolicLink()) {
      await unlink(folder);
      return;
    }
    await rm(folder, { recursive: true, force: true }).catch(async (error: unknown) => {
      const user = this.opts.user();
      if (user === appUser) throw error;
      const result = await run({ user, argv: ["rm", "-rf", "--", folder], env: await baseEnv(user), cwd: "/" });
      if (result.code !== 0) throw new Error(`the test folder could not be removed: ${result.stderr.trim()}`);
    });
  }

  private async makeAccessible(folder: string, recursive: boolean): Promise<void> {
    const user = this.opts.user();
    await privateDirectory(folder, user, this.opts.home);
    if (user === appUser) return;
    const env = await baseEnv(appUser);
    if (recursive) {
      const files = await run({ user: appUser, argv: ["setfacl", "-R", "-m", `u:${user}:rwX`, "--", folder], env, cwd: "/" });
      if (files.code !== 0) throw new Error(`setfacl failed for ${folder}: ${files.stderr.trim()}`);
    }
    const dirs = await run({
      user: appUser,
      argv: ["find", folder, "-maxdepth", "0", "-type", "d", "-exec", "setfacl", "-m", `d:u:${user}:rwx,d:u:${appUser}:rwx`, "--", "{}", "+"],
      env,
      cwd: "/",
    });
    if (dirs.code !== 0) throw new Error(`setfacl failed for ${folder}: ${dirs.stderr.trim()}`);
  }

  private async treeOf(folder: string, user: string): Promise<string> {
    const path = (await gitWork(user, folder, ["rev-parse", "--path-format=absolute", "--git-path", "pecore-node-test.index"])).trim();
    const env = { GIT_INDEX_FILE: path };
    try {
      await gitWork(user, folder, ["read-tree", "HEAD"], { env });
      await gitWork(user, folder, ["add", "-A"], { env });
      return (await gitWork(user, folder, ["write-tree"], { env })).trim();
    } finally {
      await run({ user, argv: ["rm", "-f", "--", path], env: await baseEnv(user), cwd: "/" }).catch(() => undefined);
    }
  }
}
