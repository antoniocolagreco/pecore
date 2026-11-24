import { useMemo, useState } from "react";
import type { RiskArtifact } from "@pecore/schemas";
import { ui } from "./ui";
import { Button } from "../ds/button";
import { ChevronDownIcon } from "../ds/icons";
import s from "./DiffView.module.css";

type Hunk = { header: string; lines: string[]; oldStart: number; newStart: number };
type PatchFile = { name: string; header: string[]; hunks: Hunk[] };
type Row = { kind: "ctx" | "del" | "add" | "meta"; old: number | null; new: number | null; text: string; mark: [number, number] | null };

function patchPath(raw: string): string {
  const path: string = raw.split("\t")[0] ?? "";
  if (!path.startsWith('"')) return path.replace(/^[ab]\//, "");
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  for (const match of path.slice(1, -1).matchAll(/\\([0-7]{3}|.)|([^\\]+)/g)) {
    const escape: string | undefined = match[1];
    if (escape && /^[0-7]{3}$/.test(escape)) bytes.push(Number.parseInt(escape, 8));
    else bytes.push(...encoder.encode(escape === "t" ? "\t" : escape === "n" ? "\n" : escape === "r" ? "\r" : (escape ?? match[2] ?? "")));
  }
  return new TextDecoder().decode(Uint8Array.from(bytes)).replace(/^[ab]\//, "");
}

export function parsePatch(content: string): PatchFile[] {
  const files: PatchFile[] = [];
  let file: PatchFile | undefined;
  let hunk: Hunk | undefined;
  for (const line of content.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      const right: string = line.match(/("(?:[^"\\]|\\.)*"|b\/.*)$/)?.[1] ?? "";
      file = { name: patchPath(right), header: [line], hunks: [] };
      files.push(file);
      hunk = undefined;
    } else if (!file && line.startsWith("--- ")) {
      file = { name: patchPath(line.slice(4)), header: [line], hunks: [] };
      files.push(file);
    } else if (file && line.startsWith("@@ ")) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
      hunk = { header: line, lines: [], oldStart: Number(m?.[1] ?? 1), newStart: Number(m?.[2] ?? 1) };
      file.hunks.push(hunk);
    } else if (hunk) {
      if (line !== "" || hunk.lines.length > 0) hunk.lines.push(line);
    } else if (file) {
      file.header.push(line);
      if (line.startsWith("+++ ") && line !== "+++ /dev/null") file.name = patchPath(line.slice(4));
      if (line.startsWith("--- ") && line !== "--- /dev/null") file.name = patchPath(line.slice(4));
      if (line.startsWith("rename to ")) file.name = line.slice("rename to ".length);
    }
  }
  for (const f of files) for (const h of f.hunks) while (h.lines.at(-1) === "") h.lines.pop();
  return files;
}

export function diffFiles(content: string): string[] {
  return [...new Set<string>(parsePatch(content).map((file) => file.name).filter(Boolean))];
}

function changedRange(a: string, b: string): [[number, number], [number, number]] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  return [
    [start, a.length - end],
    [start, b.length - end],
  ];
}

function rows(h: Hunk): Row[] {
  const out: Row[] = [];
  let oldNo = h.oldStart;
  let newNo = h.newStart;
  let i = 0;
  while (i < h.lines.length) {
    const line = h.lines[i]!;
    if (line.startsWith("-") || line.startsWith("+")) {
      const dels: string[] = [];
      const adds: string[] = [];
      while (i < h.lines.length && h.lines[i]!.startsWith("-")) dels.push(h.lines[i++]!.slice(1));
      while (i < h.lines.length && h.lines[i]!.startsWith("+")) adds.push(h.lines[i++]!.slice(1));
      const paired = dels.length === adds.length;
      dels.forEach((text, k) => out.push({ kind: "del", old: oldNo++, new: null, text, mark: paired ? changedRange(text, adds[k]!)[0] : null }));
      adds.forEach((text, k) => out.push({ kind: "add", old: null, new: newNo++, text, mark: paired ? changedRange(dels[k]!, text)[1] : null }));
      continue;
    }
    if (line.startsWith("\\")) out.push({ kind: "meta", old: null, new: null, text: line, mark: null });
    else out.push({ kind: "ctx", old: oldNo++, new: newNo++, text: line.slice(1), mark: null });
    i++;
  }
  return out;
}

function Code({ row }: { row: Row }) {
  if (!row.mark || row.mark[0] >= row.mark[1] || row.mark[1] - row.mark[0] === row.text.length) return <>{row.text}</>;
  const [a, b] = row.mark;
  return (
    <>
      {row.text.slice(0, a)}
      <mark className={row.kind === "del" ? s.markDel : s.markAdd}>{row.text.slice(a, b)}</mark>
      {row.text.slice(b)}
    </>
  );
}

function HunkTable({ hunk, risk }: { hunk: Hunk; risk: string | undefined }) {
  const lines = useMemo(() => rows(hunk), [hunk]);
  return (
    <table className={s.table}>
      <colgroup>
        <col className={s.numCol} />
        <col className={s.numCol} />
        <col className={s.signCol} />
        <col />
      </colgroup>
      <tbody>
        <tr className={s.hunkRow}>
          <td className={s.num} colSpan={2} />
          <td className={s.code} colSpan={2}>
            {hunk.header}
            {risk !== undefined ? <span className={s.risk}>Risky{risk ? ` · ${risk}` : ""}</span> : null}
          </td>
        </tr>
        {lines.map((r, i) => (
          <tr key={i} className={s[r.kind]}>
            <td className={s.num}>{r.old ?? ""}</td>
            <td className={s.num}>{r.new ?? ""}</td>
            <td className={s.sign}>{r.kind === "del" ? "-" : r.kind === "add" ? "+" : ""}</td>
            <td className={s.code}>
              <Code row={r} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FileBlock({ file, hunks }: { file: PatchFile; hunks: { hunk: Hunk; risk: string | undefined }[] }) {
  const [open, setOpen] = useState(true);
  const adds = file.hunks.reduce((n, h) => n + h.lines.filter((l) => l.startsWith("+")).length, 0);
  const dels = file.hunks.reduce((n, h) => n + h.lines.filter((l) => l.startsWith("-")).length, 0);
  const binary = file.hunks.length === 0;
  return (
    <section className={s.file}>
      <button type="button" className={s.fileHeader} aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronDownIcon style={open ? undefined : { rotate: "-90deg" }} />
        <span className={s.fileName}>{file.name || "patch"}</span>
        <span className={s.adds}>+{adds}</span>
        <span className={s.dels}>−{dels}</span>
        {hunks.some((h) => h.risk !== undefined) ? <span className={s.risk}>Risky</span> : null}
      </button>
      {open ? binary ? <pre className={s.meta}>{file.header.slice(1).join("\n") || "No text changes"}</pre> : hunks.map((h, i) => <HunkTable key={i} hunk={h.hunk} risk={h.risk} />) : null}
    </section>
  );
}

export function DiffView({ content, risk }: { content: string; risk?: RiskArtifact | undefined }) {
  const [limit, setLimit] = useState(30);
  const files = useMemo(() => parsePatch(content), [content]);
  const risky = new Map((risk?.hunks ?? []).filter((h) => h.level === "risky").map((h) => [`${h.file}\0${h.hunkIndex}`, h.reason]));
  const blocks = files
    .map((file) => {
      const hunks = file.hunks.map((hunk, i) => ({ hunk, risk: risky.get(`${file.name}\0${i}`) }));
      return { file, hunks: [...hunks.filter((h) => h.risk !== undefined), ...hunks.filter((h) => h.risk === undefined)] };
    })
    .sort((a, b) => Number(b.hunks.some((h) => h.risk !== undefined)) - Number(a.hunks.some((h) => h.risk !== undefined)));
  if (blocks.length === 0) return <pre className={ui.mono}>{content || "Empty diff"}</pre>;
  return (
    <div className={s.diff}>
      <div className={ui.muted}>
        {files.length} file{files.length === 1 ? "" : "s"} changed{risky.size ? ` · ${risky.size} risky hunk${risky.size === 1 ? "" : "s"} shown first` : ""}
      </div>
      {blocks.slice(0, limit).map((b, i) => (
        <FileBlock key={`${b.file.name}:${i}`} file={b.file} hunks={b.hunks} />
      ))}
      {blocks.length > limit ? <Button onClick={() => setLimit(limit + 30)}>Show {Math.min(30, blocks.length - limit)} more files</Button> : null}
    </div>
  );
}
