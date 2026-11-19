import { DeliveryArtifact, FindingsArtifact, RiskArtifact, SpecArtifact } from "@pecore/schemas";
import type { Artifact } from "@pecore/schemas";
import { MergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { call } from "../api/client";
import { useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { Button, Empty, ErrorText, ui } from "./ui";
import s from "./ArtifactView.module.css";

export async function readArtifact(artifact: Artifact) {
  const [dir, job, run, name, extra] = artifact.path.split("/");
  if (dir !== "artifacts" || !job || !run || !name || extra !== undefined) throw new Error("Invalid artifact path");
  return call("getArtifact", { params: { job, run, name } });
}

function json(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

type Hunk = { header: string; lines: string[] };
type PatchFile = { name: string; header: string[]; hunks: Hunk[] };

function Markdown({ children }: { children: string }) {
  const connected: boolean = useConnected();
  return <ReactMarkdown skipHtml disallowedElements={["img"]} components={{
    a: ({ href, children: text }) => connected && href?.startsWith("https://")
      ? <a href={href} target="_blank" rel="noreferrer">{text}</a>
      : <span>{text}</span>,
  }}>{children}</ReactMarkdown>;
}

function patchPath(raw: string): string {
  const path: string = raw.split("\t")[0] ?? "";
  if (!path.startsWith('"')) return path.replace(/^[ab]\//, "");
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  for (const match of path.slice(1, -1).matchAll(/\\([0-7]{3}|.)|([^\\]+)/g)) {
    const escape: string | undefined = match[1];
    if (escape && /^[0-7]{3}$/.test(escape)) bytes.push(Number.parseInt(escape, 8));
    else bytes.push(...encoder.encode(escape === "t" ? "\t" : escape === "n" ? "\n" : escape === "r" ? "\r" : escape ?? match[2] ?? ""));
  }
  return new TextDecoder().decode(Uint8Array.from(bytes)).replace(/^[ab]\//, "");
}

function parsePatch(content: string): PatchFile[] {
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
      hunk = { header: line, lines: [] };
      file.hunks.push(hunk);
    } else if (hunk) {
      hunk.lines.push(line);
    } else if (file) {
      file.header.push(line);
      if (line.startsWith("+++ ") && line !== "+++ /dev/null") file.name = patchPath(line.slice(4));
      if (line.startsWith("--- ") && line !== "--- /dev/null") file.name = patchPath(line.slice(4));
      if (line.startsWith("rename to ")) file.name = line.slice("rename to ".length);
    }
  }
  return files;
}

export function diffFiles(content: string): string[] {
  return [...new Set<string>(parsePatch(content).map((file) => file.name).filter(Boolean))];
}

function HunkMerge({ hunk }: { hunk: Hunk }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const extensions = [EditorState.readOnly.of(true), EditorView.editable.of(false)];
    const merge = new MergeView({
      a: { doc: hunk.lines.filter((line) => /^[ -]/.test(line)).map((line) => line.slice(1)).join("\n"), extensions },
      b: { doc: hunk.lines.filter((line) => /^[ +]/.test(line)).map((line) => line.slice(1)).join("\n"), extensions },
      parent: host.current,
    });
    return () => merge.destroy();
  }, [hunk]);
  return <div ref={host} className={s.merge} aria-label="Before and after" />;
}

function Patch({ content, risk }: { content: string; risk: RiskArtifact | undefined }) {
  const connected: boolean = useConnected();
  const [page, setPage] = useState<number>(0);
  const [expanded, setExpanded] = useState<string | null | undefined>(undefined);
  const files: PatchFile[] = useMemo(() => parsePatch(content), [content]);
  const risky = new Map<string, string>((risk?.hunks ?? []).filter((hunk) => hunk.level === "risky").map((hunk) => [JSON.stringify([hunk.file, hunk.hunkIndex]), hunk.reason]));
  const groups = files.flatMap((file, index) => {
    const hunks = file.hunks.map((hunk, hunkIndex) => ({ hunk, key: String(hunkIndex), risk: risky.get(JSON.stringify([file.name, hunkIndex])) }));
    const flagged = hunks.filter((hunk) => hunk.risk !== undefined);
    const other = hunks.filter((hunk) => hunk.risk === undefined);
    return [
      ...(flagged.length ? [{ id: 'risk-' + index, file, hunks: flagged, risky: true }] : []),
      ...(other.length || !flagged.length ? [{ id: 'file-' + index, file, hunks: other, risky: false }] : []),
    ];
  }).sort((a, b) => Number(b.risky) - Number(a.risky));
  type Entry = { group: (typeof groups)[number]; hunk?: (typeof groups)[number]["hunks"][number] };
  const entries: Entry[] = groups.flatMap<Entry>((group) => group.hunks.length
    ? group.hunks.map((hunk) => ({ group, hunk }))
    : [{ group, hunk: undefined }]);
  if (!entries.length) return <Plain content={content} />;
  const pageSize: number = 50;
  const pageIndex: number = Math.min(page, Math.ceil(entries.length / pageSize) - 1);
  const visible = entries.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);
  return (
    <div className={ui.stack}>
      {visible.map(({ group, hunk: entry }, index) => {
        const key: string = group.id + ":" + (entry?.key ?? "");
        const selected: boolean = expanded === key || (expanded === undefined && index === 0);
        return (
          <div key={key} className={s.file}>
            {visible[index - 1]?.group.id !== group.id && <strong>{group.file.name || "Patch"}</strong>}
            {entry ? (
              <div className={s.hunk}>
                <Button disabled={!connected} aria-expanded={selected} onClick={() => setExpanded(selected ? null : key)}>
                  <code>{entry.hunk.header}</code>{entry.risk !== undefined && <span className={s.risk}>Risky{entry.risk && " · " + entry.risk}</span>}
                </Button>
                {selected && <HunkMerge hunk={entry.hunk} />}
              </div>
            ) : <Plain content={group.file.header.join("\n")} />}
          </div>
        );
      })}
      {entries.length > pageSize && (
        <div className={ui.row}>
          <Button disabled={!connected || pageIndex === 0} onClick={() => { setExpanded(undefined); setPage(pageIndex - 1); }}>Previous</Button>
          <Button disabled={!connected || (pageIndex + 1) * pageSize >= entries.length} onClick={() => { setExpanded(undefined); setPage(pageIndex + 1); }}>Show more</Button>
        </div>
      )}
    </div>
  );
}

function Plain({ content }: { content: string }) {
  return <pre className={s.plain}>{content}</pre>;
}

function ArtifactList<T>({ items, render }: { items: T[]; render(item: T): ReactNode }) {
  const connected: boolean = useConnected();
  const [page, setPage] = useState<number>(0);
  const size: number = 50;
  const index: number = Math.min(page, Math.max(0, Math.ceil(items.length / size) - 1));
  if (!items.length) return null;
  return (
    <>
      <ul>{items.slice(index * size, (index + 1) * size).map((item, offset) => <li key={index * size + offset}>{render(item)}</li>)}</ul>
      {items.length > size && (
        <div className={ui.row}>
          <Button disabled={!connected || index === 0} onClick={() => setPage(index - 1)}>Previous</Button>
          <Button disabled={!connected || (index + 1) * size >= items.length} onClick={() => setPage(index + 1)}>Show more</Button>
        </div>
      )}
    </>
  );
}

export function Findings({ findings }: { findings: FindingsArtifact }) {
  return (
    <div>
      <strong>{findings.verdict}</strong>
      <ArtifactList items={findings.items} render={(item) => (
        <><code>{item.file}{item.line !== null ? ":" + item.line : ""}</code> · {item.severity}<Markdown>{item.text}</Markdown></>
      )} />
    </div>
  );
}

export function Delivery({ content }: { content: string }) {
  const connected: boolean = useConnected();
  const parsed = DeliveryArtifact.safeParse(json(content));
  if (!parsed.success) return <Plain content={content} />;
  const { url, ref } = parsed.data;
  if (!connected || !url?.startsWith("https://") || !URL.canParse(url)) return <span>{url ?? ref}</span>;
  return <a href={url} target="_blank" rel="noreferrer">{url}</a>;
}

function ArtifactContent({ artifact, content, risk }: { artifact: Artifact; content: string; risk: RiskArtifact | undefined }) {
  switch (artifact.type) {
    case "diff":
      return <Patch content={content} risk={risk} />;
    case "spec": {
      const spec = SpecArtifact.safeParse(json(content));
      if (!spec.success) return <Markdown>{content}</Markdown>;
      return (
        <>
          <h3>Acceptance criteria</h3>
          <ArtifactList items={spec.data.criteria} render={(text) => <Markdown>{text}</Markdown>} />
          <h3>Tests</h3>
          <ArtifactList items={spec.data.tests} render={(text) => <Markdown>{text}</Markdown>} />
          {!!spec.data.interfaces.length && <><h3>Interfaces</h3><ArtifactList items={spec.data.interfaces} render={(item) => <>{item.name} · <code>{item.signature}</code></>} /></>}
          {!!spec.data.optionalNodes.length && <p>Optional nodes · {spec.data.optionalNodes.join(", ")}</p>}
        </>
      );
    }
    case "findings": {
      const findings = FindingsArtifact.safeParse(json(content));
      return findings.success ? <Findings findings={findings.data} /> : <Markdown>{content}</Markdown>;
    }
    case "risk": {
      const parsed = RiskArtifact.safeParse(json(content));
      return parsed.success
        ? <ArtifactList items={parsed.data.hunks} render={(hunk) => <><code>{hunk.file}</code> · Hunk {hunk.hunkIndex + 1} · {hunk.level} · {hunk.reason}</>} />
        : <Plain content={content} />;
    }
    case "delivery":
      return <Delivery content={content} />;
    case "ticket": {
      const value: unknown = json(content);
      const ticket = typeof value === "object" && value !== null && "text" in value && typeof value.text === "string" ? value.text : content;
      return <Plain content={ticket} />;
    }
    default:
      return <Plain content={content} />;
  }
}

export function ArtifactView({ artifact, risk }: { artifact: Artifact; risk?: Artifact }) {
  const file = useData(() => readArtifact(artifact), [artifact.path, artifact.sha256]);
  const riskFile = useData(async () => {
    if (artifact.type !== "diff" || !risk) return undefined;
    const result = await readArtifact(risk);
    return RiskArtifact.parse(json(result.content));
  }, [artifact.type, risk?.path, risk?.sha256]);
  return (
    <div className={s.artifact}>
      <ErrorText error={file.error ?? riskFile.error} />
      {file.data?.artifact.path === artifact.path
        ? <ArtifactContent key={artifact.sha256} artifact={artifact} content={file.data.content} risk={riskFile.data} />
        : file.loading && <Empty>Loading artifact…</Empty>}
    </div>
  );
}
