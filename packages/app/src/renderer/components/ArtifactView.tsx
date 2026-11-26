import { CodeAnalysisArtifact, CodeReviewArtifact, PullRequestArtifact, SpecArtifact } from "@pecore/schemas";
import type { Artifact } from "@pecore/schemas";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { call } from "../api/client";
import { useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { TextTable } from "../ds/data";
import { DiffView } from "./DiffView";
import { ErrorText, ui } from "./ui";
import { useViewState } from "./useViewState";
import { Button } from "../ds/button";
import { Alert, EmptyState } from "../ds/feedback";
import s from "./ArtifactView.module.css";

export { diffFiles } from "./DiffView";

export function artifactKey({ jobId, run, name, type }: Artifact): string {
  return JSON.stringify([jobId, run, name, type]);
}

export async function readArtifact({ jobId, run, name }: Artifact) {
  return call("getArtifact", { params: { job: jobId, run, name } });
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

function ArtifactList<T>({ view, items, render }: { view: string; items: T[]; render(item: T, index: number): ReactNode }) {
  const connected: boolean = useConnected();
  const [page, setPage] = useViewState(`artifact.page:${view}`, 0);
  const size: number = 50;
  const index: number = Math.min(page, Math.max(0, Math.ceil(items.length / size) - 1));
  if (!items.length) return null;
  return (
    <>
      <ul>{items.slice(index * size, (index + 1) * size).map((item, offset) => <li key={index * size + offset}>{render(item, index * size + offset)}</li>)}</ul>
      {items.length > size && (
        <div className={ui.row}>
          <Button disabled={!connected || index === 0} onClick={() => setPage(index - 1)}>Previous</Button>
          <Button disabled={!connected || (index + 1) * size >= items.length} onClick={() => setPage(index + 1)}>Show more</Button>
        </div>
      )}
    </>
  );
}

export function PullRequestLink({ url }: { url: string }) {
  const connected: boolean = useConnected();
  return connected && url.startsWith("https://") ? <a href={url} target="_blank" rel="noreferrer">{url}</a> : <span>{url}</span>;
}

export function useDelivery(artifacts: Artifact[]) {
  const requests: Artifact[] = artifacts.filter((artifact) => artifact.type === "pull_request");
  return useData(async () => {
    for (const artifact of requests.toReversed()) {
      const request = PullRequestArtifact.safeParse(json((await readArtifact(artifact)).content));
      if (request.success && request.data.url) return request.data.url;
    }
    return null;
  }, [requests.map((artifact) => artifact.sha256).join()]);
}

export function latestAnalysis(artifacts: Artifact[], filesHash: string | null): Artifact | undefined {
  return artifacts.findLast((artifact) => artifact.type === "code_analysis" && filesHash !== null && artifact.filesHash === filesHash);
}

type ReviewLine = { file: string; line: number };
function ArtifactContent({ view, artifact, content, analysis, onComment }: { view: string; artifact: Artifact; content: string; analysis: CodeAnalysisArtifact | undefined; onComment?: ((line: ReviewLine) => void) | undefined }) {
  switch (artifact.type) {
    case "diff":
      return <DiffView view={view} content={content} risk={analysis} onComment={onComment} />;
    case "spec": {
      const spec = SpecArtifact.safeParse(json(content));
      if (!spec.success) return <Plain content={content} />;
      return <><h3>{spec.data.feature}</h3><ArtifactList view={view} items={spec.data.scenarios} render={({ name, given, when, then, examples }, index) => <>
        <strong>{name}</strong>
        <p>Given {given.join(" · ")}</p><p>When {when}</p><p>Then {then.join(" · ")}</p>
        {examples && <ArtifactList view={`${view}:examples:${index}`} items={examples} render={(example) => <>{Object.entries(example).map(([key, value]) => `${key} = ${value}`).join(" · ")}</>} />}
      </>} /></>;
    }
    case "code_review": {
      const review = CodeReviewArtifact.safeParse(json(content));
      return review.success ? <>
        <Markdown>{review.data.body}</Markdown>
        <ArtifactList view={view} items={review.data.comments} render={({ file, line, hunk, text }) => (
          <><code>{line === undefined ? `${file} · Hunk ${(hunk ?? 0) + 1}` : `${file}:${line}`}</code><Markdown>{text}</Markdown></>
        )} />
      </> : <Plain content={content} />;
    }
    case "code_analysis": {
      const result = CodeAnalysisArtifact.safeParse(json(content));
      return result.success ? <>
        <Markdown>{result.data.summary}</Markdown>
        <ArtifactList view={view} items={result.data.hunks} render={({ file, hunk, level, text }) => (
          <><code>{file} · Hunk {hunk + 1}</code> · {level}<Markdown>{text}</Markdown></>
        )} />
      </> : <Plain content={content} />;
    }
    case "pull_request": {
      const request = PullRequestArtifact.safeParse(json(content));
      return request.success ? <><h3>{request.data.title}</h3><Markdown>{request.data.body}</Markdown>
        {request.data.url && <PullRequestLink url={request.data.url} />}</> : <Plain content={content} />;
    }
    default:
      return <Plain content={content} />;
  }
}

export function ArtifactView({ artifact, analysis, onComment, scope = "" }: { artifact: Artifact; analysis?: Artifact | undefined; onComment?: ((line: ReviewLine) => void) | undefined; scope?: string }) {
  const key: string = artifactKey(artifact);
  const file = useData(async () => {
    const r = await readArtifact(artifact);
    const bytes: Uint8Array<ArrayBuffer> = r.encoding === "base64" ? Uint8Array.from(atob(r.content), (char) => char.charCodeAt(0)) : new TextEncoder().encode(r.content);
    const digest: Uint8Array = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return { ...r, sha256: [...digest].map((b) => b.toString(16).padStart(2, "0")).join("") };
  }, [key, artifact.sha256]);
  const analysisFile = useData(async () => {
    if (artifact.type !== "diff" || !analysis) return undefined;
    const result = await readArtifact(analysis);
    return CodeAnalysisArtifact.parse(json(result.content));
  }, [artifact.type, analysis && artifactKey(analysis), analysis?.sha256]);
  const changed = file.data && file.data.sha256 !== artifact.sha256;
  return (
    <div className={s.artifact}>
      <ErrorText error={file.error ?? analysisFile.error} />
      {changed ? <Alert tone="warning">This artifact differs from the version recorded for this item.</Alert> : null}
      {file.data && artifactKey(file.data.artifact) === key
        ? <ArtifactContent key={artifact.sha256} view={`${scope}:${key}`} artifact={artifact} content={file.data.content} analysis={analysisFile.data} onComment={onComment} />
        : file.loading && <EmptyState title="Loading artifact…" />}
    </div>
  );
}
