import { useEffect, useState } from "react";
import { ApiError, artifactContentProblem, NodeOutputType } from "@pecore/schemas";
import type { ArtifactType, Node, NodeTestView } from "@pecore/schemas";
import { call } from "../api/client";
import { useAction, useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { Alert, Badge, Card } from "../ds/feedback";
import { Button } from "../ds/button";
import { TextArea } from "../ds/field";
import { LogView } from "./LogView";
import { ErrorText, ui } from "./ui";
import { artifactTypeExamples, artifactTypeLabels } from "./artifactLabels";
import s from "./NodeTestPanel.module.css";

const allInputTypes: ArtifactType[] = [...NodeOutputType.options, "diff"];

const stateLabels: Record<NodeTestView["state"], string> = {
  running: "Running",
  waiting: "Waiting for you",
  completed: "Completed",
  failed: "Failed",
  stopped: "Stopped",
};

function tone(state: NodeTestView["state"]): "accent" | "success" | "danger" | "warning" | "neutral" {
  if (state === "completed") return "success";
  if (state === "failed") return "danger";
  if (state === "waiting") return "warning";
  if (state === "stopped") return "neutral";
  return "accent";
}

function inputTypes(node: Node): ArtifactType[] {
  if (node.kind === "command") return [...new Set([...node.inputs, ...node.optionalInputs])];
  return allInputTypes;
}

function requiredTypes(node: Node): Set<ArtifactType> {
  return new Set(node.kind === "command" ? node.inputs : []);
}

export function NodeTestPanel({ node, sidecars, sidecarReady, disabled, onStateChange }: {
  node: Node | null;
  sidecars: Record<string, string>;
  sidecarReady: boolean;
  disabled: boolean;
  onStateChange?: (state: NodeTestView["state"] | null) => void;
}) {
  const connected: boolean = useConnected();
  const [values, setValues] = useState<Partial<Record<ArtifactType, string>>>({});
  const [testId, setTestId] = useState<string>();
  const [note, setNote] = useState("");
  const active = useData<NodeTestView | null>(() => call("getActiveNodeTest"), [],
    (message) => message.type === "node_test.updated");
  useEffect(() => {
    if (active.data) setTestId(active.data.id);
  }, [active.data]);
  const view = useData<NodeTestView | null>(() => testId ? call("getNodeTest", { params: { id: testId } }) : Promise.resolve(null), [testId],
    (message) => message.type === "node_test.updated" && message.testId === testId);
  useEffect(() => {
    onStateChange?.(view.data?.state ?? null);
  }, [view.data?.state, onStateChange]);
  useEffect(() => {
    if (view.error instanceof ApiError && view.error.status === 404) {
      setTestId(undefined);
      active.reload();
    }
  }, [view.error]);
  const repository: boolean = node?.kind === "repository";
  const types: ArtifactType[] = node && !repository ? inputTypes(node) : [];
  const required: Set<ArtifactType> = node ? requiredTypes(node) : new Set();
  const problems = types.flatMap((type) => {
    const value = values[type];
    const problem = value?.trim() ? artifactContentProblem(type, value) : null;
    return problem ? [{ type, problem }] : [];
  });
  const missing: ArtifactType[] = [...required].filter((type) => !values[type]?.trim());
  const running: boolean = view.data?.state === "running" || view.data?.state === "waiting";
  const anotherTest: boolean = !!active.data && active.data.id !== testId;
  const start = useAction(async () => {
    if (!node) return;
    const inputs: Partial<Record<ArtifactType, string>> = {};
    for (const type of types) {
      const value = values[type];
      if (value?.trim()) inputs[type] = value;
    }
    const result = await call("runNodeTest", { body: { node, inputs, sidecars } });
    setTestId(result.id);
    setNote("");
    active.reload();
  });
  const stop = useAction(async () => {
    if (!testId) return;
    await call("stopNodeTest", { params: { id: testId } });
    view.reload();
  });
  const answer = useAction(async (choice?: string) => {
    if (!testId) return;
    await call("answerNodeTest", { params: { id: testId }, body: { ...(choice ? { choice } : {}), note } });
    setNote("");
    view.reload();
  });
  const reset = useAction(async () => {
    await call("resetNodeTests");
    setTestId(undefined);
    setNote("");
    active.reload();
  });
  const canRun: boolean = connected && !disabled && !!node && !repository && sidecarReady && !running && !anotherTest && !missing.length && !problems.length;
  return <Card title="Test" actions={<Button disabled={!connected || reset.busy} loading={reset.busy} onClick={() => void reset.run()}>Reset test folder</Button>}>
    <div className={ui.stack}>
      <p className={ui.muted}>Runs the node with the editor's current content, saved or not. All tests share one folder and keep their changes until you reset it.</p>
      {repository && <p>Repository nodes change real remotes, so they cannot be tested here.</p>}
      {!repository && node && <>
        {types.length === 0
          ? <p className={ui.muted}>This node takes no inputs.</p>
          : <div className={s.inputs}>
            {types.map((type) => {
              const problem = problems.find((entry) => entry.type === type);
              return <TextArea key={type} label={`${artifactTypeLabels[type]} input${required.has(type) ? " (required)" : ""}`}
                value={values[type] ?? ""} rows={3} mono={type !== "feedback"}
                description={artifactTypeExamples[type]} error={problem?.problem}
                onValueChange={(value) => setValues((current) => ({ ...current, [type]: value }))} />;
            })}
          </div>}
        {missing.length > 0 && <ErrorText error={`Fill the ${missing.map((type) => artifactTypeLabels[type]).join(", ")} ${missing.length === 1 ? "input" : "inputs"}.`} />}
        {!sidecarReady && <ErrorText error="Write the node's prompt or script file before running a test." />}
        <div className={ui.row}>
          <Button variant="primary" disabled={!canRun || start.busy} loading={start.busy} onClick={() => void start.run()}>Run</Button>
          {running && <Button disabled={!connected || stop.busy} loading={stop.busy} onClick={() => void stop.run()}>Stop</Button>}
        </div>
        <ErrorText error={start.error ?? stop.error ?? answer.error ?? reset.error ?? active.error} />
      </>}
      {!repository && !node && <ErrorText error="The node definition is not valid. Fix it before testing." />}
      <ErrorText error={view.error} />
      {view.data && <>
        <div className={ui.row}>
          <Badge tone={tone(view.data.state)} dot={view.data.state === "running"} pulse={view.data.state === "running"}>{stateLabels[view.data.state]}</Badge>
          {view.data.outcome && <span>Outcome: <code>{view.data.outcome}</code></span>}
          {view.data.failureReason && <span>Failure: <code>{view.data.failureReason}</code></span>}
        </div>
        <ErrorText error={view.data.error} />
        {view.data.notice && <Alert tone="warning">{view.data.notice}</Alert>}
        {view.data.state === "waiting" && view.data.question && <section className={s.question} aria-label="Node question">
          <strong>{view.data.question.kind === "human" ? "Your answer" : "The node asks"}</strong>
          <p>{view.data.question.text}</p>
          {view.data.question.inputs.length > 0 && <div>
            <strong>Inputs</strong>
            {view.data.question.inputs.map((input, index) => <div key={`${input.type}-${index}`}>
              <strong>{artifactTypeLabels[input.type]}</strong>
              <pre className={s.pre}>{input.content}</pre>
            </div>)}
          </div>}
          {(view.data.question.kind === "agent" || view.data.question.notes.length > 0) && <TextArea label="Note" value={note} rows={3} onValueChange={setNote} />}
          <div className={ui.row}>
            {view.data.question.choices.length > 0
              ? view.data.question.choices.map((choice) => <Button key={choice} disabled={!connected || answer.busy} onClick={() => void answer.run(choice)}>{choice}</Button>)
              : <Button variant="primary" disabled={!connected || answer.busy || !note.trim()} loading={answer.busy} onClick={() => void answer.run()}>Send answer</Button>}
          </div>
        </section>}
        <section className={s.outputs} aria-label="Output artifacts">
          <strong>Output artifacts</strong>
          {view.data.outputs.length === 0
            ? <p className={ui.muted}>No output artifacts.</p>
            : view.data.outputs.map((output, index) => <div key={`${output.type}-${index}`}>
              <strong>{artifactTypeLabels[output.type]}</strong>
              <pre className={s.pre}>{output.content}</pre>
            </div>)}
        </section>
        <section className={s.outputs} aria-label="File changes in the test folder">
          <strong>File changes</strong>
          {view.data.files.length === 0
            ? <p className={ui.muted}>No file changes.</p>
            : <>
              <ul>{view.data.files.map((file) => <li key={`${file.status}-${file.path}`}><code>{file.status}</code> {file.path}</li>)}</ul>
              <pre className={s.pre}>{view.data.diff}</pre>
            </>}
        </section>
        <LogView attemptId={view.data.id} running={view.data.state === "running"} />
      </>}
    </div>
  </Card>;
}
