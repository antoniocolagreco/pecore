import { createHash } from "node:crypto";
import { argvShellScript, Node, Recipe } from "@pecore/schemas";
import type { CommandNode, OutcomeRule, OutputRule, RepositoryNode } from "@pecore/schemas";
import type Database from "better-sqlite3";

type NodeRow = {
  name: string;
  description: string;
  icon: string | null;
  kind: Node["kind"];
  timeout_sec: number | null;
  changes_files: number | null;
  retry: number | null;
  prompt: string | null;
  tier: string | null;
  agent_session: string | null;
  agent_tracker_access: string | null;
  agent_tracker_account: string | null;
  human_interface: string | null;
  chat_approved_hash: string | null;
  reads_only: number | null;
  repository_account: string | null;
  repository_script: string | null;
};

type RecipeRow = {
  name: string;
  description: string;
  icon: string | null;
  start: string | null;
  on_base_changed: string | null;
  has_ends: number;
  has_layout: number;
  ci_after: string | null;
  ci_on: string | null;
  ci_interval_sec: number | null;
  ci_timeout_sec: number | null;
  ci_max_corrections: number | null;
};

type StepRow = {
  step: string;
  node: string;
  optional: number;
  agent_id: string | null;
  agent_session: string | null;
  skip_when_unchanged: number;
  has_params: number;
  has_agent: number;
  tier: string | null;
  has_provider_not: number;
};

type EdgeRow = {
  source: string;
  outcome: string;
  target: string | null;
  result: string | null;
  max_rounds: number | null;
};

type CommandAction = "command" | "probe" | "mergedCheck";
type CommandRules = NonNullable<RepositoryNode["probeRules"]>;
type CatalogTable = "nodes" | "recipes" | "node_content" | "icons";

export class Catalog {
  constructor(readonly db: Database.Database) {}

  names(table: CatalogTable): string[] {
    return this.strings(`SELECT name FROM catalog_${table} ORDER BY name`);
  }

  private strings(sql: string, ...args: string[]): string[] {
    return this.db.prepare<string[], string>(sql).pluck().all(...args);
  }

  private params(sql: string, ...args: string[]): Record<string, unknown> {
    return Object.fromEntries(this.db.prepare<string[], { name: string; value: string }>(sql).all(...args).map(({ name, value }) => [name, JSON.parse(value)]));
  }

  node(name: string): Node | null {
    const row: NodeRow | undefined = this.db.prepare<[string], NodeRow>("SELECT * FROM catalog_nodes WHERE name = ?").get(name);
    if (!row) return null;
    const list = (field: string): string[] => this.strings("SELECT value FROM catalog_node_lists WHERE node = ? AND field = ? ORDER BY position", name, field);
    const base = {
      name, kind: row.kind, description: row.description, icon: row.icon ?? undefined, tags: list("tags"),
      params: this.params("SELECT name, value FROM catalog_node_params WHERE node = ? ORDER BY name", name),
    };
    const timeout: { timeoutSec: number | null } = { timeoutSec: row.timeout_sec };
    const outputs: { outcome: string; type: string }[] = this.db.prepare<[string], { outcome: string; type: string }>(
      "SELECT outcome, type FROM catalog_node_outputs WHERE node = ? ORDER BY outcome",
    ).all(name);
    const runnable = {
      outcomes: list("outcomes"), outputs: Object.fromEntries(outputs.map(({ outcome, type }) => [outcome, type])),
      failOutcomes: list("failOutcomes"), scratchPaths: list("scratchPaths"), retry: row.retry,
    };
    if (row.kind === "human") return Node.parse({ ...base, ...runnable, interface: row.human_interface });
    const common = { ...base, ...runnable, ...timeout, changesFiles: !!row.changes_files };
    if (row.kind === "agent") {
      const profiles: string[] = list("profiles");
      return Node.parse({
        ...common, prompt: row.prompt, agentSession: row.agent_session ?? undefined, knowledge: list("knowledge"),
        ...(row.agent_tracker_access ? { tracker: { access: row.agent_tracker_access, account: row.agent_tracker_account } } : {}),
        agent: { tier: row.tier ?? undefined, ...(profiles.length ? { profiles } : {}), providerNot: list("providerNot") },
      });
    }
    const command = this.command(name, "command");
    const probe = this.command(name, "probe");
    const merged = this.command(name, "mergedCheck");
    type RuleRow = { outcome: string; exit_code: number | null; json_field: string | null; json_value: string | null };
    const outcomeRules: OutcomeRule[] = this.db.prepare<[string], RuleRow>(
      "SELECT outcome, exit_code, json_field, json_value FROM catalog_outcome_rules WHERE node = ? ORDER BY position",
    ).all(name).map(({ outcome, exit_code, json_field, json_value }) => {
      if (json_field === null) return { outcome, exitCode: exit_code ?? "other" };
      return json_value === null ? { outcome, stdoutJson: json_field, other: true } : { outcome, stdoutJson: json_field, value: JSON.parse(json_value) };
    });
    const inputs = { inputs: list("inputs"), optionalInputs: list("optionalInputs"), outcomeRules };
    const remote = row.reads_only ? { readOnly: true } : {};
    if (row.kind === "repository") return Node.parse({
      ...remote,
      ...common, ...inputs, account: row.repository_account,
      script: row.repository_script ?? (command?.command?.length ? argvShellScript(command.command) : undefined),
      outputRules: command?.outputRules,
      probe: probe?.command ?? (probe?.script ? { script: probe.script } : undefined), probeRules: probe?.rules,
      mergedCheck: merged?.command ?? (merged?.script ? { script: merged.script } : undefined), mergedCheckRules: merged?.rules,
    });
    return Node.parse({ ...common, ...command, ...inputs });
  }

  private command(node: string, action: CommandAction): { command?: string[]; script?: string; outputRules: Record<string, OutputRule>; rules?: CommandRules } | null {
    const row: { script: string | null; rule_field: string | null } | undefined = this.db.prepare<[string, string], { script: string | null; rule_field: string | null }>(
      "SELECT script, rule_field FROM catalog_commands WHERE node = ? AND action = ?",
    ).get(node, action);
    if (!row) return null;
    type OutputRow = { output: string; kind: string; target: string };
    const outputRules: Record<string, OutputRule> = Object.fromEntries(this.db.prepare<[string, string], OutputRow>(
      "SELECT output, kind, target FROM catalog_output_rules WHERE node = ? AND action = ? ORDER BY output",
    ).all(node, action).map(({ output, kind, target }) => [output, { [kind]: target } as OutputRule]));
    const executable: { command?: string[]; script?: string } = row.script === null
      ? { command: this.strings("SELECT argument FROM catalog_command_args WHERE node = ? AND action = ? ORDER BY position", node, action) }
      : { script: row.script };
    if (row.rule_field === null) return { ...executable, outputRules };
    const values = (result: "done" | "notDone"): unknown[] =>
      this.strings("SELECT value FROM catalog_probe_values WHERE node = ? AND action = ? AND result = ? ORDER BY position", node, action, result)
        .map((value) => JSON.parse(value) as unknown);
    return { ...executable, outputRules, rules: { stdoutJson: row.rule_field, done: values("done"), notDone: values("notDone") } };
  }

  saveNode(value: Node, shipped: boolean = false): void {
    const node: Node = Node.parse(value);
    const { name } = node;
    this.db.transaction(() => {
      const approved: string | null = this.chatApprovedHash(name);
      this.delete("nodes", name);
      this.db.prepare(`INSERT INTO catalog_nodes
        (name, description, icon, kind, shipped, timeout_sec, changes_files, retry, prompt, tier, agent_session, human_interface, repository_account, repository_script, chat_approved_hash, reads_only, agent_tracker_access, agent_tracker_account)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        name, node.description, node.icon ?? null, node.kind, Number(shipped),
        "timeoutSec" in node ? node.timeoutSec : null, "changesFiles" in node ? Number(node.changesFiles) : null,
        "retry" in node ? node.retry : null, node.kind === "agent" ? node.prompt : null,
        node.kind === "agent" ? node.agent.tier ?? null : null, node.kind === "agent" ? node.agentSession : null,
        node.kind === "human" ? node.interface : null,
        node.kind === "repository" ? node.account : null, node.kind === "repository" ? node.script : null,
        approved, "readOnly" in node && node.readOnly ? 1 : null,
        node.kind === "agent" ? node.tracker?.access ?? null : null, node.kind === "agent" ? node.tracker?.account ?? null : null,
      );
      this.writeParams("INSERT INTO catalog_node_params (node, name, value) VALUES (?, ?, ?)", [name], node.params);
      this.writeLists("INSERT INTO catalog_node_lists (node, field, position, value) VALUES (?, ?, ?, ?)", [name], {
        tags: node.tags, ...("outcomes" in node ? { outcomes: node.outcomes, failOutcomes: node.failOutcomes, scratchPaths: node.scratchPaths } : {}),
        ...(node.kind === "agent" ? { knowledge: node.knowledge, profiles: node.agent.profiles, providerNot: node.agent.providerNot } : {}),
        ...("inputs" in node ? { inputs: node.inputs, optionalInputs: node.optionalInputs } : {}),
      });
      if ("outputs" in node) {
        const insert: Database.Statement<[string, string, string]> = this.db.prepare("INSERT INTO catalog_node_outputs (node, outcome, type) VALUES (?, ?, ?)");
        for (const [outcome, type] of Object.entries(node.outputs)) insert.run(name, outcome, type);
      }
      if ("inputs" in node) this.saveCommandNode(node);
    })();
  }

  private chatApprovedHash(name: string): string | null {
    return this.db.prepare<[string], string | null>("SELECT chat_approved_hash FROM catalog_nodes WHERE name = ?").pluck().get(name) ?? null;
  }

  chatNode(name: string) {
    const node: Node | null = this.node(name);
    if (node?.kind !== "repository") return null;
    const checks: Record<string, string> = {};
    for (const check of [node.probe, node.mergedCheck]) {
      if (check && !Array.isArray(check)) checks[check.script] = this.content(check.script) ?? "";
    }
    const executable = { ...node, description: undefined, tags: undefined, icon: undefined };
    const hash: string = createHash("sha256").update(JSON.stringify({ executable, checks })).digest("hex");
    return { node, checks, hash, approved: hash === this.chatApprovedHash(name) };
  }

  approveChatNode(name: string, hash: string): boolean {
    if (this.chatNode(name)?.hash !== hash) return false;
    this.db.prepare("UPDATE catalog_nodes SET chat_approved_hash = ? WHERE name = ?").run(hash, name);
    return true;
  }

  private saveCommandNode(node: CommandNode | RepositoryNode): void {
    this.saveCommand(node.name, "command", node.kind === "command" ? node : { outputRules: node.outputRules });
    if (node.kind === "repository") {
      if (node.probe) this.saveCommand(node.name, "probe", Array.isArray(node.probe) ? { command: node.probe } : node.probe, node.probeRules);
      if (node.mergedCheck) this.saveCommand(node.name, "mergedCheck", Array.isArray(node.mergedCheck) ? { command: node.mergedCheck } : node.mergedCheck, node.mergedCheckRules);
    }
    const insert: Database.Statement<[string, number, string, number | null, string | null, string | null]> =
      this.db.prepare("INSERT INTO catalog_outcome_rules (node, position, outcome, exit_code, json_field, json_value) VALUES (?, ?, ?, ?, ?, ?)");
    for (const [i, rule] of node.outcomeRules.entries()) {
      insert.run(node.name, i, rule.outcome, "exitCode" in rule && typeof rule.exitCode === "number" ? rule.exitCode : null,
        "stdoutJson" in rule ? rule.stdoutJson : null, "value" in rule ? JSON.stringify(rule.value) ?? null : null);
    }
  }

  private saveCommand(node: string, action: CommandAction, spec: { script?: string; command?: string[]; outputRules?: Record<string, OutputRule> }, rules?: CommandRules): void {
    this.db.prepare("INSERT INTO catalog_commands (node, action, script, rule_field) VALUES (?, ?, ?, ?)").run(node, action, spec.script ?? null, rules?.stdoutJson ?? null);
    const arg: Database.Statement<[string, string, number, string]> = this.db.prepare("INSERT INTO catalog_command_args (node, action, position, argument) VALUES (?, ?, ?, ?)");
    for (const [i, value] of (spec.command ?? []).entries()) arg.run(node, action, i, value);
    const output: Database.Statement<[string, string, string, string, string]> =
      this.db.prepare("INSERT INTO catalog_output_rules (node, action, output, kind, target) VALUES (?, ?, ?, ?, ?)");
    for (const [key, rule] of Object.entries(spec.outputRules ?? {})) {
      const [kind, target] = Object.entries(rule)[0]!;
      output.run(node, action, key, kind, target);
    }
    if (!rules) return;
    const probe: Database.Statement<[string, string, string, number, string]> =
      this.db.prepare("INSERT INTO catalog_probe_values (node, action, result, position, value) VALUES (?, ?, ?, ?, ?)");
    for (const result of ["done", "notDone"] as const) {
      for (const [i, value] of rules[result].entries()) probe.run(node, action, result, i, JSON.stringify(value));
    }
  }

  recipe(name: string): Recipe | null {
    const row: RecipeRow | undefined = this.db.prepare<[string], RecipeRow>("SELECT * FROM catalog_recipes WHERE name = ?").get(name);
    if (!row) return null;
    const list = (field: string): string[] => this.strings("SELECT value FROM catalog_recipe_lists WHERE recipe = ? AND field = ? ORDER BY position", name, field);
    const layout: { step: string; x: number; y: number }[] = row.has_layout
      ? this.db.prepare<[string], { step: string; x: number; y: number }>("SELECT step, x, y FROM catalog_recipe_layout WHERE recipe = ? ORDER BY step").all(name) : [];
    const edges: EdgeRow[] = this.db.prepare<[string], EdgeRow>("SELECT * FROM catalog_recipe_edges WHERE recipe = ? ORDER BY position").all(name);
    const connection = (edge: EdgeRow) => ({ from: edge.source, on: edge.outcome });
    return Recipe.parse({
      name, description: row.description, icon: row.icon ?? undefined, start: row.start ?? undefined, onBaseChanged: row.on_base_changed ?? undefined,
      successOutcomes: list("successOutcomes"),
      ...(row.has_layout ? { layout: Object.fromEntries(layout.map(({ step, x, y }) => [step, { x, y }])) } : {}),
      ...(row.ci_after === null ? {} : {
        ci: { after: row.ci_after, on: row.ci_on, intervalSec: row.ci_interval_sec, timeoutSec: row.ci_timeout_sec, maxCorrections: row.ci_max_corrections, checks: list("ciChecks") },
      }),
      nodes: this.recipeSteps(name),
      edges: edges.filter(({ result }) => result === null).map((edge) => ({ ...connection(edge), to: edge.target, maxRounds: edge.max_rounds ?? undefined })),
      ...(row.has_ends ? { ends: edges.filter(({ result }) => result !== null).map((edge) => ({ ...connection(edge), result: edge.result })) } : {}),
    });
  }

  private recipeSteps(name: string): Record<string, unknown> {
    const steps: StepRow[] = this.db.prepare<[string], StepRow>("SELECT * FROM catalog_recipe_steps WHERE recipe = ? ORDER BY position").all(name);
    return Object.fromEntries(steps.map((step) => {
      const list = (field: string): string[] =>
        this.strings("SELECT value FROM catalog_step_lists WHERE recipe = ? AND step = ? AND field = ? ORDER BY position", name, step.step, field);
      const profiles: string[] = step.has_agent ? list("profiles") : [];
      return [step.step, {
        use: step.node, optional: !!step.optional, skipWhenUnchanged: !!step.skip_when_unchanged,
        agentId: step.agent_id ?? undefined, agentSession: step.agent_session ?? undefined,
        requires: list("requires"), reads: list("reads"),
        ...(step.has_params ? { params: this.params("SELECT name, value FROM catalog_step_params WHERE recipe = ? AND step = ? ORDER BY name", name, step.step) } : {}),
        ...(step.has_agent ? { agent: {
          tier: step.tier ?? undefined, ...(profiles.length ? { profiles } : {}),
          ...(step.has_provider_not ? { providerNot: list("providerNot") } : {}),
        } } : {}),
      }];
    }));
  }

  saveRecipe(value: Recipe, shipped: boolean = false): void {
    const recipe: Recipe = Recipe.parse(value);
    const { name, ci } = recipe;
    this.db.transaction(() => {
      this.delete("recipes", name);
      this.db.prepare(`INSERT INTO catalog_recipes
        (name, description, icon, shipped, start, on_base_changed,
          has_ends, has_layout, ci_after, ci_on, ci_interval_sec, ci_timeout_sec, ci_max_corrections)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        name, recipe.description, recipe.icon ?? null, Number(shipped), recipe.start ?? null, recipe.onBaseChanged ?? null,
        Number(recipe.ends !== undefined), Number(recipe.layout !== undefined), ci?.after ?? null, ci?.on ?? null,
        ci?.intervalSec ?? null, ci?.timeoutSec ?? null, ci?.maxCorrections ?? null,
      );
      this.writeLists("INSERT INTO catalog_recipe_lists (recipe, field, position, value) VALUES (?, ?, ?, ?)", [name], {
        successOutcomes: recipe.successOutcomes, ciChecks: ci?.checks,
      });
      this.saveRecipeSteps(recipe);
      const insert: Database.Statement = this.db.prepare(`INSERT INTO catalog_recipe_edges
        (recipe, position, source, outcome, target, result, max_rounds) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      const connections: (Recipe["edges"][number] | NonNullable<Recipe["ends"]>[number])[] = [...recipe.edges, ...(recipe.ends ?? [])];
      for (const [i, edge] of connections.entries()) {
        insert.run(name, i, edge.from, edge.on, "to" in edge ? edge.to : null, "result" in edge ? edge.result : null,
          "to" in edge ? edge.maxRounds ?? null : null);
      }
      const point: Database.Statement<[string, string, number, number]> = this.db.prepare("INSERT INTO catalog_recipe_layout (recipe, step, x, y) VALUES (?, ?, ?, ?)");
      for (const [id, { x, y }] of Object.entries(recipe.layout ?? {})) point.run(name, id, x, y);
    })();
  }

  private saveRecipeSteps(recipe: Recipe): void {
    const insert: Database.Statement = this.db.prepare(`INSERT INTO catalog_recipe_steps
      (recipe, step, position, node, optional, agent_id, agent_session, skip_when_unchanged, has_params, has_agent, tier, has_provider_not)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const [i, [id, step]] of Object.entries(recipe.nodes).entries()) {
      insert.run(recipe.name, id, i, step.use, Number(step.optional), step.agentId ?? null, step.agentSession ?? null, Number(step.skipWhenUnchanged),
        Number(step.params !== undefined), Number(step.agent !== undefined), step.agent?.tier ?? null, Number(step.agent?.providerNot !== undefined));
      this.writeParams("INSERT INTO catalog_step_params (recipe, step, name, value) VALUES (?, ?, ?, ?)", [recipe.name, id], step.params ?? {});
      this.writeLists("INSERT INTO catalog_step_lists (recipe, step, field, position, value) VALUES (?, ?, ?, ?, ?)", [recipe.name, id], {
        reads: step.reads, requires: step.requires, profiles: step.agent?.profiles, providerNot: step.agent?.providerNot,
      });
    }
  }

  private writeParams(sql: string, key: string[], data: Record<string, unknown>): void {
    const insert: Database.Statement<string[]> = this.db.prepare(sql);
    for (const [name, value] of Object.entries(data)) if (value !== undefined) insert.run(...key, name, JSON.stringify(value));
  }

  private writeLists(sql: string, key: string[], data: Record<string, string[] | undefined>): void {
    const insert: Database.Statement<(string | number)[]> = this.db.prepare(sql);
    for (const [field, values] of Object.entries(data)) {
      for (const [i, value] of (values ?? []).entries()) insert.run(...key, field, i, value);
    }
  }

  content(name: string): string | null {
    return this.db.prepare<[string], string>("SELECT body FROM catalog_node_content WHERE name = ?").pluck().get(name) ?? null;
  }

  saveContent(name: string, body: string, shipped: boolean = false): void {
    this.db.prepare(`INSERT INTO catalog_node_content (name, language, body, shipped) VALUES (?, ?, ?, ?)
      ON CONFLICT (name) DO UPDATE SET body = excluded.body, shipped = excluded.shipped`).run(name, name.endsWith(".md") ? "markdown" : "shell", body, Number(shipped));
  }

  icon(name: string): string | null {
    return this.db.prepare<[string], string>("SELECT svg FROM catalog_icons WHERE name = ?").pluck().get(name) ?? null;
  }

  saveIcon(name: string, svg: string, shipped: boolean = false): void {
    this.db.prepare(`INSERT INTO catalog_icons (name, svg, shipped) VALUES (?, ?, ?)
      ON CONFLICT (name) DO UPDATE SET svg = excluded.svg, shipped = excluded.shipped`).run(name, svg, Number(shipped));
  }

  delete(table: CatalogTable, name: string): void {
    this.db.prepare(`DELETE FROM catalog_${table} WHERE name = ?`).run(name);
  }
}
