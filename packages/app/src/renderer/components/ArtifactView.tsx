import { DocumentArtifact, FindingsArtifact, ReferenceArtifact, SpecArtifact } from "@pecore/schemas";
import type { Artifact } from "@pecore/schemas";
import { useState } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { call } from "../api/client";
import { useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { TextTable } from "../ds/data";
import { DiffView } from "./DiffView";
import { ErrorText, ui } from "./ui";
import { Button } from "../ds/button";
import { Alert, EmptyState } from "../ds/feedback";
import s from "./ArtifactView.module.css";

export { diffFiles } from "./DiffView";

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

function Markdown({ children }: { children: string }) {
  const connected: boolean = useConnected();
  return <ReactMarkdown skipHtml disallowedElements={["img"]} remarkPlugins={[remarkGfm]} components={{
    a: ({ href, children: text }) => connected && href?.startsWith("https://")
      ? <a href={href} target="_blank" rel="noreferrer">{text}</a>
      : <span>{text}</span>,
    table: ({ children: rows }) => <TextTable>{rows}</TextTable>,
  }}>{children}</ReactMarkdown>;
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

function place(item: FindingsArtifact["items"][number]): string {
  if (item.line !== undefined && item.line !== null) return `${item.file}:${item.line}`;
  if (item.hunk !== undefined) return `${item.file} · Hunk ${item.hunk + 1}`;
  return item.file;
}

export function Findings({ findings }: { findings: FindingsArtifact }) {
  return (
    <div>
      {findings.verdict && <strong>{findings.verdict}</strong>}
      <ArtifactList items={findings.items} render={(item) => (
        <><code>{place(item)}</code> · {item.level}<Markdown>{item.text}</Markdown></>
      )} />
    </div>
  );
}

export function Reference({ content }: { content: string }) {
  const connected: boolean = useConnected();
  const parsed = ReferenceArtifact.safeParse(json(content));
  if (!parsed.success) return <Plain content={content} />;
  const { url, ref, sha } = parsed.data;
  if (!connected || !url?.startsWith("https://") || !URL.canParse(url)) return <span>{url ?? ref ?? sha}</span>;
  return <a href={url} target="_blank" rel="noreferrer">{url}</a>;
}

export function useDelivery(artifacts: Artifact[]) {
  const references: Artifact[] = artifacts.filter((artifact) => artifact.type === "reference");
  return useData(async () => {
    for (const artifact of references.toReversed()) {
      const content: string = (await readArtifact(artifact)).content;
      const reference = ReferenceArtifact.safeParse(json(content));
      if (reference.success && (reference.data.url !== undefined || reference.data.ref !== undefined)) return content;
    }
    return null;
  }, [references.map((artifact) => artifact.sha256).join()]);
}

export function latestFindings(artifacts: Artifact[], contentState: string | null): Artifact | undefined {
  return artifacts.findLast((artifact) => artifact.type === "findings" && contentState !== null && artifact.contentState === contentState);
}

function ArtifactContent({ artifact, content, findings }: { artifact: Artifact; content: string; findings: FindingsArtifact | undefined }) {
  switch (artifact.type) {
    case "diff":
      return <DiffView content={content} risk={findings} />;
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
    case "reference":
      return <Reference content={content} />;
    case "document": {
      const document = DocumentArtifact.safeParse(json(content));
      if (!document.success) return <Plain content={content} />;
      const reference: string = [document.data.source, document.data.id].filter((item): item is string => typeof item === "string" && item.length > 0).join(" · ");
      return <>
        <h3>{document.data.title}</h3>
        {reference && <p className={ui.muted}>{reference}</p>}
        <Plain content={document.data.body} />
      </>;
    }
    default:
      return <Plain content={content} />;
  }
}

export function ArtifactView({ artifact, findings }: { artifact: Artifact; findings?: Artifact | undefined }) {
  const file = useData(async () => {
    const r = await readArtifact(artifact);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(r.content)));
    return { ...r, sha256: [...digest].map((b) => b.toString(16).padStart(2, "0")).join("") };
  }, [artifact.path, artifact.sha256]);
  const findingsFile = useData(async () => {
    if (artifact.type !== "diff" || !findings) return undefined;
    const result = await readArtifact(findings);
    return FindingsArtifact.parse(json(result.content));
  }, [artifact.type, findings?.path, findings?.sha256]);
  const changed = file.data && file.data.sha256 !== artifact.sha256;
  return (
    <div className={s.artifact}>
      <ErrorText error={file.error ?? findingsFile.error} />
      {changed ? <Alert tone="warning">This artifact differs from the version recorded for this item.</Alert> : null}
      {file.data?.artifact.path === artifact.path
        ? <ArtifactContent key={artifact.sha256} artifact={artifact} content={file.data.content} findings={findingsFile.data} />
        : file.loading && <EmptyState title="Loading artifact…" />}
    </div>
  );
}
