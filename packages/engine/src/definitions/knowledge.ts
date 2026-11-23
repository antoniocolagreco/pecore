import { readdir, readFile } from "node:fs/promises";
import { join, matchesGlob } from "node:path";
import { lint } from "markdownlint/sync";
import type { Configuration, MicromarkToken, Rule } from "markdownlint";
import { KnowledgeFileName } from "@pecore/schemas";

export type KnowledgeIssue = { line: number; column: number; length: number; message: string };
type Destination = { text: string; line: number; column: number };

const formatting: Configuration = {
  default: false,
  MD001: true, MD003: true, MD004: true, MD005: true, MD007: true, MD011: true, MD018: true, MD019: true, MD022: true, MD023: true,
  MD025: true, MD031: true, MD032: true, MD037: true, MD038: true, MD039: true, MD042: true, MD046: true, MD048: true, MD051: true, MD052: true,
};

const scheme: RegExp = /^[a-z][a-z0-9+.-]*:/i;

function scan(content: string, config: Configuration): { found: Destination[]; warnings: KnowledgeIssue[] } {
  const found: Destination[] = [];
  const collect: Rule = {
    names: ["knowledge-links"],
    description: "Knowledge links",
    tags: ["links"],
    parser: "micromark",
    function: (params) => {
      const walk = (tokens: readonly MicromarkToken[]): void => {
        for (const token of tokens) {
          if (token.type === "resourceDestinationString" || token.type === "definitionDestinationString") {
            found.push({ text: token.text, line: token.startLine, column: token.startColumn });
          }
          walk(token.children);
        }
      };
      walk(params.parsers.micromark.tokens);
    },
  };
  const results = lint({ strings: { file: content }, config: { ...config, "knowledge-links": true }, customRules: [collect] }).file ?? [];
  const warnings: KnowledgeIssue[] = results.map((result) => ({
    line: result.lineNumber,
    column: result.errorRange?.[0] ?? 1,
    length: result.errorRange?.[1] ?? 0,
    message: result.ruleDescription + (result.errorDetail ? ` (${result.errorDetail})` : ""),
  }));
  return { found, warnings };
}

function target(destination: string): string | null {
  if (scheme.test(destination) || destination.startsWith("#")) return null;
  const file: string = destination.split(/[#?]/)[0]!;
  try {
    return decodeURIComponent(file);
  } catch {
    return file;
  }
}

export function knowledgeLinks(content: string): string[] {
  return [...new Set(scan(content, { default: false }).found.flatMap(({ text }) => target(text) ?? []))];
}

export function checkKnowledge(content: string, files: ReadonlySet<string>): { errors: KnowledgeIssue[]; warnings: KnowledgeIssue[]; links: string[] } {
  const { found, warnings } = scan(content, formatting);
  const errors: KnowledgeIssue[] = [];
  const links = new Set<string>();
  for (const { text, line, column } of found) {
    const file: string | null = target(text);
    if (file === null) continue;
    links.add(file);
    const at = { line, column, length: text.length };
    if (file.includes("/") || file.includes("\\")) {
      errors.push({ ...at, message: `${text} uses a path: link another knowledge file by its name only, for example naming.md` });
    } else if (!files.has(file)) {
      errors.push({ ...at, message: `${file} is not a knowledge file of this project` });
    }
  }
  return { errors, warnings, links: [...links] };
}

export function renameKnowledgeLinks(content: string, from: string, to: string): string {
  const lines: string[] = content.split("\n");
  const matches: Destination[] = scan(content, { default: false }).found
    .filter(({ text }) => target(text) === from && text.startsWith(from))
    .sort((a, b) => b.line - a.line || b.column - a.column);
  for (const { line, column } of matches) {
    const text: string = lines[line - 1]!;
    lines[line - 1] = text.slice(0, column - 1) + to + text.slice(column - 1 + from.length);
  }
  return lines.join("\n");
}

export async function knowledgeNames(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return [];
    throw e;
  });
  return entries.filter((entry) => entry.isFile() && KnowledgeFileName.safeParse(entry.name).success).map(({ name }) => name).sort();
}

export async function knowledgeClosure(dir: string, wanted: readonly string[]): Promise<string[]> {
  if (wanted.length === 0) return [];
  const names = new Set<string>(await knowledgeNames(dir));
  const queue: string[] = [...names].filter((name) => wanted.some((entry) => entry === name || matchesGlob(name, entry)));
  const seen = new Set<string>(queue);
  for (let index = 0; index < queue.length; index++) {
    const content: string = await readFile(join(dir, queue[index]!), "utf8");
    for (const link of knowledgeLinks(content)) {
      if (!names.has(link) || seen.has(link)) continue;
      seen.add(link);
      queue.push(link);
    }
  }
  return queue;
}
