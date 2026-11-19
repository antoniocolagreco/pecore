import type { JobView } from "@pecore/schemas";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { call } from "../api/client";
import { useAction, useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { readRecipe } from "./JobGraph";
import { Button, ErrorText, Field, Modal, ui } from "./ui";
import s from "./JobControls.module.css";

export function isFinal(job: JobView): boolean {
  return job.state === "succeeded" || job.state === "failed" || job.state === "not_delivered" || job.state === "stopped";
}

const controls = [
  ["Pause", "pauseJob", "Finishes the running node, then holds. No work is lost."],
  ["Play", "playJob", "Continues from the next node."],
  ["Stop", "stopJob", "Kills the running node now and ends the job as Stopped. Resume restarts it."],
  ["Resume", "resumeJob", "Restarts the failed or stopped node from scratch in the same workdir."],
  ["Realign", "realignJob", "Moves the job onto the current head of the chosen target branch and retargets the PR. A started job re-runs the recipe’s rebase path."],
  ["Archive", "archiveJob", "Hides the job from default lists."],
  ["Delete", "deleteJob", "Removes the workdir, local branch, artifacts, logs and history. The forge is untouched."],
] as const;
type Action = (typeof controls)[number][1];
type Dialog = "deleteJob" | "realignJob";

export function JobControls({ job, compact }: { job: JobView; compact?: boolean }) {
  const connected: boolean = useConnected();
  const navigate: ReturnType<typeof useNavigate> = useNavigate();
  const { pathname } = useLocation();
  const [hovered, setHovered] = useState<boolean>(false);
  const [focused, setFocused] = useState<boolean>(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [target, setTarget] = useState<string>("");
  const path: string = `projects/${job.projectId}/recipes/${job.recipe}.json`;
  const final: boolean = isFinal(job);
  const inspect: boolean = final && (!compact || hovered || focused || dialog !== null);
  const recipe = useData(() => inspect ? readRecipe(job) : Promise.resolve(null), [inspect, path], (m) => m.type === "definition.changed" && m.path === path);
  const children = useData(async () => {
    if (!inspect) return null;
    const jobs: JobView[] = await call("listJobs", { query: { project: job.projectId } });
    return jobs.some((child) => child.parentJobId === job.id && !isFinal(child));
  }, [inspect, job.id, job.projectId], (m) => m.type === "job.updated" && m.projectId === job.projectId);
  const enabled: Record<Action, boolean> = {
    pauseJob: job.state === "running" || job.state === "waiting",
    playJob: job.state === "paused",
    stopJob: !final,
    resumeJob: !job.archived && (job.state === "failed" || job.state === "stopped"),
    realignJob: job.state === "queued" || (final && !recipe.error && Boolean(recipe.data?.onBaseChanged)),
    archiveJob: final && !job.archived,
    deleteJob: final && !children.error && children.data === false,
  };
  const action = useAction(async (route: Action) => {
    const params = { id: job.id };
    if (route === "realignJob") {
      await call(route, { params, body: { target: target.trim() || undefined } });
    } else {
      await call(route, { params });
    }
    setDialog(null);
    if (route === "deleteJob" && pathname === `/jobs/${encodeURIComponent(job.id)}`) void navigate("/jobs", { replace: true });
  });

  return (
    <div
      className={compact ? s.compact : undefined}
      data-job-controls
      data-error={Boolean(action.error || (inspect && (recipe.error || children.error)))}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
      onClick={(event) => event.stopPropagation()}
    >
      <div className={ui.row}>
        {controls.map(([label, route, effect]) => (
          <span title={route === "realignJob" && final && recipe.data && !recipe.data.onBaseChanged ? effect + " This recipe has no rebase path." : effect} key={route}>
            <Button
              disabled={!connected || action.busy || !enabled[route]}
              onClick={() => {
                if (route === "deleteJob" || route === "realignJob") {
                  action.clear();
                  setTarget("");
                  setDialog(route);
                } else void action.run(route);
              }}
            >
              {label}
            </Button>
          </span>
        ))}
      </div>
      <ErrorText error={dialog ? null : action.error} />
      {inspect && <><ErrorText error={recipe.error} /><ErrorText error={children.error} /></>}
      {dialog && (
        <Modal open onClose={() => { if (!action.busy) setDialog(null); }} title={dialog === "deleteJob" ? "Delete job" : "Realign job"}>
          <div className={ui.stack}>
            {dialog === "deleteJob" ? (
              <p>Delete “{job.title}” and its workdir, local branch, artifacts, logs and history. The forge is untouched.</p>
            ) : (
              <Field label={`Target branch (leave blank to keep ${job.target})`}>
                <input value={target} onChange={(event) => setTarget(event.target.value)} disabled={!connected || action.busy} />
              </Field>
            )}
            <ErrorText error={action.error} />
            <div className={ui.row}>
              <Button onClick={() => setDialog(null)} disabled={action.busy}>Cancel</Button>
              <Button kind={dialog === "deleteJob" ? "danger" : "primary"} disabled={!connected || action.busy || !enabled[dialog]} onClick={() => void action.run(dialog)}>
                {dialog === "deleteJob" ? "Delete" : "Realign"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
