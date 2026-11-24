import { readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { ApiError, appName } from "@pecore/schemas";
import type { ApiClient, ExportProjectResult, ImportProjectResult, WhyView } from "@pecore/schemas";
import { connect, NotRunningError, pecoreHome } from "./connect";

export const usage = `${appName}

Usage:
  pecore project list
  pecore project export <id> [--out <file>] [--history] [--logs] [--accept-findings]
  pecore project import <file> [--id <new-id>] [--account <from>=<to> ...]
  pecore project analyze <file>
  pecore job list [--project <id>] [--archived]
  pecore job why <job>
  pecore job stop|pause|play|resume|archive|delete <job>
  pecore job realign <job> [--target <branch>]
  pecore validate <definition>...`;

export type Out = { log(text: string): void; error(text: string): void };

function clock(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function formatWhy(w: WhyView): string {
  const lines = [`${w.jobId}: ${w.state}`];
  if (w.reasons.length === 0) lines.push(w.state === "running" ? "  running, nothing blocks it" : "  nothing blocks it");
  for (const r of w.reasons) lines.push(`  ${r.text}${r.until ? ` (until ${clock(r.until)})` : ""}`);
  return lines.join("\n");
}

function table(rows: string[][]): string {
  const widths = rows[0]?.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length))) ?? [];
  return rows.map((r) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]!))).join("  ")).join("\n");
}

const controls = { stop: "stopJob", pause: "pauseJob", play: "playJob", resume: "resumeJob", archive: "archiveJob", delete: "deleteJob" } as const;

async function command(call: ApiClient, home: string, args: string[], out: Out): Promise<number> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    project: { type: "string" }, archived: { type: "boolean" }, target: { type: "string" },
    out: { type: "string" }, history: { type: "boolean" }, logs: { type: "boolean" }, "accept-findings": { type: "boolean" },
    id: { type: "string" }, account: { type: "string", multiple: true },
  } });
  const [group, action, id] = positionals;
  if (group === "project" && action === "list") {
    const projects = await call("listProjects");
    out.log(table([["ID", "NAME", "REPO", "BASE"], ...projects.map((p) => [p.id, p.project?.name ?? "(invalid)", p.project ? (p.project.repo?.url ?? "local only") : "", p.project?.baseBranch ?? ""])]));
    return 0;
  }
  if (group === "project" && action === "export" && id && positionals.length === 3) {
    const path: string = resolve(values.out ?? `${id}.tar.zst`);
    const body = { path, history: values.history ?? false, logs: values.logs ?? false };
    let result: ExportProjectResult = await call("exportProject", { params: { id }, body });
    if (result.state === "findings" && values["accept-findings"]) {
      result = await call("exportProject", { params: { id }, body: { ...body, acceptFindings: result.findings.map((f) => f.fingerprint) } });
    }
    if (result.state === "findings") {
      out.error(table([["FILE", "LINE", "RULE", "FINGERPRINT"], ...result.findings.map((f) => [f.file, String(f.line), f.rule, f.fingerprint])]));
      return 1;
    }
    out.log(result.path);
    return 0;
  }
  if (group === "project" && action === "import" && id && positionals.length === 3) {
    const accounts: Map<string, string> = new Map();
    for (const mapping of values.account ?? []) {
      const [from, to, extra]: string[] = mapping.split("=");
      if (!from || !to || extra !== undefined || accounts.has(from)) {
        out.error(`invalid account mapping ${mapping}. Use --account <from>=<to> once per source account.`);
        return 2;
      }
      accounts.set(from, to);
    }
    out.error("Review every script and prompt in the archive before importing. They can contain malicious code and run with access to your accounts.");
    const result: ImportProjectResult = await call("importProject", { body: { path: resolve(id), ...(values.id === undefined ? {} : { id: values.id }), accounts: Object.fromEntries(accounts) } });
    if (result.state === "needs-accounts") {
      out.error(table([["ACCOUNT", "KIND"], ...result.accounts.map((a) => [a.id, a.kind])]));
      return 1;
    }
    out.log(result.id);
    return 0;
  }
  if (group === "project" && action === "analyze" && id && positionals.length === 3) {
    const report = await call("analyzeArchive", { body: { path: resolve(id) } });
    out.log(JSON.stringify(report, null, 2));
    return 0;
  }
  if (group === "job" && action === "list") {
    const jobs = await call("listJobs", { query: { ...(values.project ? { project: values.project } : {}), archived: values.archived ? "true" : "false" } });
    out.log(table([["ID", "STATE", "PROJECT", "TITLE"], ...jobs.map((j) => [j.id, j.waitingReason ? `${j.state} (${j.waitingReason})` : j.state, j.projectId, j.title])]));
    return 0;
  }
  if (group === "job" && action === "why" && id) {
    out.log(formatWhy(await call("whyJob", { params: { id } })));
    return 0;
  }
  if (group === "job" && action === "realign" && id) {
    await call("realignJob", { params: { id }, body: values.target ? { target: values.target } : {} });
    out.log(`${id}: realign requested`);
    return 0;
  }
  if (group === "job" && action && action in controls && id) {
    await call(controls[action as keyof typeof controls], { params: { id } });
    out.log(`${id}: ${action} done`);
    return 0;
  }
  if (group === "validate" && positionals.length > 1) {
    let failed = 0;
    for (const file of positionals.slice(1)) {
      const rel = relative(home, resolve(file));
      if (rel.startsWith("..") || resolve(file) === resolve(home)) {
        out.error(`${file}: not under PECORE_HOME (${home})`);
        failed++;
        continue;
      }
      const path: string = rel.split(sep).join("/");
      const content: string = await readFile(file, "utf8").catch(async (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
        return (await call("getDefinition", { params: { path } })).content;
      });
      const { errors } = await call("validateDefinition", { body: { path, content } });
      if (errors.length === 0) out.log(`${file}: ok`);
      for (const e of errors) out.error(`${file} ${e.path}: ${e.message}`);
      if (errors.length) failed++;
    }
    return failed ? 1 : 0;
  }
  out.error(usage);
  return 2;
}

export async function run(args: string[], out: Out, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  if (args.length === 0 || args[0] === "help" || args[0] === "--help") {
    out.log(usage);
    return args.length === 0 ? 2 : 0;
  }
  try {
    const home = await pecoreHome(env);
    return await command(await connect(home), home, args, out);
  } catch (e) {
    if (e instanceof NotRunningError) {
      out.error(e.message);
      return 1;
    }
    if (e instanceof ApiError) {
      out.error(`${e.code}: ${e.message}`);
      return 1;
    }
    out.error((e as Error).message);
    return 1;
  }
}
