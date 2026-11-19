import type { JobView } from "@pecore/schemas";
import { useState } from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { call } from "../api/client";
import { useAction, useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { Button, IconButton } from "../ds/button";
import { TextField } from "../ds/field";
import { ArrowRightIcon, BoxIcon, MoreIcon, PauseIcon, PlayIcon, RefreshIcon, StopIcon, TrashIcon } from "../ds/icons";
import { Dialog, Menu } from "../ds/overlay";
import { readRecipe } from "./JobGraph";
import { ErrorText } from "./ui";
import s from "./JobControls.module.css";

export function isFinal(job: JobView): boolean {
  return job.state === "succeeded" || job.state === "failed" || job.state === "not_delivered" || job.state === "stopped";
}

type Action = "pauseJob" | "playJob" | "stopJob" | "resumeJob" | "realignJob" | "archiveJob" | "deleteJob";
type Confirm = "deleteJob" | "realignJob";

const controls: Record<Action, { label: string; effect: string; icon: ReactNode }> = {
  pauseJob: { label: "Pause", effect: "Finishes the running step, then holds. No work is lost.", icon: <PauseIcon /> },
  playJob: { label: "Play", effect: "Continues from the next step.", icon: <PlayIcon /> },
  stopJob: { label: "Stop", effect: "Kills the running step now and ends the job as Stopped. Resume restarts it.", icon: <StopIcon /> },
  resumeJob: { label: "Resume", effect: "Restarts the failed or stopped step from scratch in the same folder.", icon: <RefreshIcon /> },
  realignJob: { label: "Realign", effect: "Moves the job onto the current head of a target branch and retargets the PR.", icon: <ArrowRightIcon /> },
  archiveJob: { label: "Archive", effect: "Hides the job from default lists.", icon: <BoxIcon /> },
  deleteJob: { label: "Delete", effect: "Removes the folder, local branch, artifacts, logs and history. The forge is untouched.", icon: <TrashIcon /> },
};

const primary: Action[] = ["pauseJob", "playJob", "resumeJob", "stopJob"];
const secondary: Action[] = ["realignJob", "archiveJob", "deleteJob"];

export function JobControls({ job, compact }: { job: JobView; compact?: boolean }) {
  const connected: boolean = useConnected();
  const navigate: ReturnType<typeof useNavigate> = useNavigate();
  const { pathname } = useLocation();
  const [hovered, setHovered] = useState<boolean>(false);
  const [focused, setFocused] = useState<boolean>(false);
  const [dialog, setDialog] = useState<Confirm | null>(null);
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
    if (route === "realignJob") await call(route, { params, body: { target: target.trim() || undefined } });
    else await call(route, { params });
    setDialog(null);
    if (route === "deleteJob" && pathname === `/jobs/${encodeURIComponent(job.id)}`) void navigate("/jobs", { replace: true });
  });
  const run = (route: Action): void => {
    if (route === "deleteJob" || route === "realignJob") {
      action.clear();
      setTarget("");
      setDialog(route);
    } else void action.run(route);
  };
  const busy: boolean = !connected || action.busy;
  const shown: Action[] = primary.filter((route) => enabled[route]);

  return (
    <div
      className={compact ? s.compact : s.full}
      data-job-controls
      data-error={Boolean(action.error || (inspect && (recipe.error || children.error)))}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
      onClick={(event) => event.stopPropagation()}
    >
      {shown.map((route) => compact
        ? <IconButton key={route} size="sm" label={controls[route].label} icon={controls[route].icon} disabled={busy} onClick={() => run(route)} />
        : <Button key={route} variant={route === "stopJob" ? "danger" : "secondary"} icon={controls[route].icon} disabled={busy} title={controls[route].effect} onClick={() => run(route)}>{controls[route].label}</Button>)}
      <Menu
        align="end"
        trigger={<Button variant="ghost" size={compact ? "sm" : "md"} icon={<MoreIcon />} aria-label="More actions" disabled={!connected} />}
        items={secondary.map((route) => ({
          label: controls[route].label,
          icon: controls[route].icon,
          danger: route === "deleteJob",
          disabled: busy || !enabled[route],
          onSelect: () => run(route),
        }))}
      />
      {!compact && <ErrorText error={dialog ? null : action.error} />}
      {inspect && <><ErrorText error={recipe.error} /><ErrorText error={children.error} /></>}
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => { if (!open && !action.busy) setDialog(null); }}
        title={dialog === "deleteJob" ? `Delete “${job.title}”?` : "Realign job"}
        description={dialog === "deleteJob" ? controls.deleteJob.effect : controls.realignJob.effect}
        width={440}
        footer={dialog && <>
          <Button onClick={() => setDialog(null)} disabled={action.busy}>Cancel</Button>
          <Button variant={dialog === "deleteJob" ? "dangerSolid" : "primary"} loading={action.busy} disabled={!connected || !enabled[dialog]} onClick={() => void action.run(dialog)}>
            {dialog === "deleteJob" ? "Delete" : "Realign"}
          </Button>
        </>}
      >
        {dialog === "realignJob" && <TextField label={`Target branch (leave blank to keep ${job.target})`} value={target} onValueChange={setTarget} disabled={busy} mono autoFocus />}
        {dialog && <ErrorText error={action.error} />}
      </Dialog>
    </div>
  );
}
