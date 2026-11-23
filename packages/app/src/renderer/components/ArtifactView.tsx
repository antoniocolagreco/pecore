import { DeliveryArtifact, FindingsArtifact, RiskArtifact, SpecArtifact } from "@pecore/schemas";
import type { Artifact, ReviewView } from "@pecore/schemas";
import { useState } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { call } from "../api/client";
import { useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { CodeSnapshot } from "./CodeSnapshot";
import { DiffView } from "./DiffView";
import { Button, Empty, ErrorText, ui } from "./ui";
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
  return <ReactMarkdown skipHtml disallowedElements={["img"]} components={{
    a: ({ href, children: text }) => connected && href?.startsWith("https://")
      ? <a href={href} target="_blank" rel="noreferrer">{text}</a>
      : <span>{text}</span>,
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

function ArtifactContent({ artifact, content, risk, reviewView }: {
  artifact: Artifact; content: string; risk: RiskArtifact | undefined; reviewView?: ReviewView;
}) {
  if (reviewView === "code") {
    const language: "json" | "shell" | undefined = json(content) !== undefined ? "json"
      : /^#![^\n]*(?:\/|\s)(?:ba|da|z|k)?sh(?:\s|$)/.test(content) ? "shell" : undefined;
    return <CodeSnapshot content={content} language={language} label="Review code" numbered />;
  }
  if (reviewView === "text" && artifact.type === "diff") return <Plain content={content} />;
  switch (artifact.type) {
    case "diff":
      return <DiffView content={content} risk={risk} />;
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
      if (typeof value !== "object" || value === null || !("text" in value) || typeof value.text !== "string") return <Plain content={content} />;
      if (reviewView !== "text") return <Plain content={value.text} />;
      const reference: string = ["source" in value ? value.source : null, "id" in value ? value.id : null]
        .filter((item): item is string => typeof item === "string" && item.length > 0).join(" · ");
      return <>
        {"title" in value && typeof value.title === "string" && <h3>{value.title}</h3>}
        {reference && <p className={ui.muted}>{reference}</p>}
        <Plain content={value.text} />
      </>;
    }
    default:
      return <Plain content={content} />;
  }
}

export function ArtifactView({ artifact, risk, reviewView }: { artifact: Artifact; risk?: Artifact | undefined; reviewView?: ReviewView }) {
  const file = useData(async () => {
    const r = await readArtifact(artifact);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(r.content)));
    return { ...r, sha256: [...digest].map((b) => b.toString(16).padStart(2, "0")).join("") };
  }, [artifact.path, artifact.sha256]);
  const riskFile = useData(async () => {
    if (artifact.type !== "diff" || !risk) return undefined;
    const result = await readArtifact(risk);
    return RiskArtifact.parse(json(result.content));
  }, [artifact.type, risk?.path, risk?.sha256]);
  const changed = file.data && file.data.sha256 !== artifact.sha256;
  return (
    <div className={s.artifact}>
      <ErrorText error={file.error ?? riskFile.error} />
      {changed ? <div className={ui.banner}>This artifact differs from the version recorded for this item.</div> : null}
      {file.data?.artifact.path === artifact.path
        ? <ArtifactContent key={artifact.sha256} artifact={artifact} content={file.data.content} risk={riskFile.data} reviewView={reviewView} />
        : file.loading && <Empty>Loading artifact…</Empty>}
    </div>
  );
}
