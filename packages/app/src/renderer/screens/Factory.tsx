import type { JobView } from "@pecore/schemas";
import { useNavigate } from "react-router";
import { call } from "../api/client";
import { useAction, useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { isFinal } from "../components/JobControls";
import { jobState } from "../components/states";
import { Button, ErrorText, Page } from "../components/ui";
import { Stat, Stats } from "../ds/data";
import { Alert } from "../ds/feedback";
import { JobTable, useJobs } from "./Jobs";

const labels: string[] = ["Needs you", "Failed", "Working", "Waiting"];

export function Factory() {
  const connected: boolean = useConnected();
  const navigate: ReturnType<typeof useNavigate> = useNavigate();
  const status = useData(() => call("getStatus"), [], (m) => m.type === "queue.updated" || m.type === "job.updated");
  const jobs = useJobs("false", null);
  const visible: JobView[] = jobs.data ?? [];
  const play = useAction(async () => {
    await call("playInterrupted");
    status.reload();
    jobs.reload();
  });
  const counters: { label: string; value: string | number | undefined; to: string }[] = [
    { label: "Notifications", value: status.data?.notifications, to: "/notifications" },
    ...labels.map((label) => ({ label, value: jobs.data && !jobs.loading ? visible.filter((job) => jobState(job).label === label).length : undefined, to: `/jobs?${new URLSearchParams({ label })}` })),
  ];
  return (
    <Page title="Factory">
      <Stats>
        {counters.map(({ label, value, to }) => (
          <Stat
            key={label}
            value={value ?? "—"}
            label={label}
            tone={label === "Failed" && Number(value) > 0 ? "danger" : (label === "Needs you" || label === "Notifications") && Number(value) > 0 ? "attention" : undefined}
            onClick={connected ? () => void navigate(to) : undefined}
          />
        ))}
      </Stats>
      <ErrorText error={status.error} />
      <ErrorText error={jobs.error} />
      {(status.data?.interrupted ?? 0) > 0 && (
        <Alert tone="warning" title="Jobs were interrupted when PeCore closed" actions={<Button disabled={!connected || play.busy} onClick={() => void play.run()}>Play interrupted jobs</Button>}>
          {status.data?.interrupted} {status.data?.interrupted === 1 ? "job is" : "jobs are"} waiting to continue.
          <ErrorText error={play.error} />
        </Alert>
      )}
      <JobTable jobs={visible.filter((job) => !isFinal(job))} factory loading={jobs.loading} />
    </Page>
  );
}
