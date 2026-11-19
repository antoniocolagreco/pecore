import { useEffect, useState } from "react";
import type { JobView, UsageView } from "@pecore/schemas";
import { useNavigate } from "react-router";
import { call } from "../api/client";
import { useAction, useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { isFinal } from "../components/JobControls";
import { jobState } from "../components/states";
import { Button, ErrorText, Page, ui } from "../components/ui";
import { useProjectFilter } from "../shell/filter";
import { JobTable, NewJobButton, useJobs } from "./Jobs";

const labels: string[] = ["Needs you", "Failed", "Working", "Waiting"];
const usd = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 6 });

function localDay(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function Factory() {
  const connected: boolean = useConnected();
  const navigate: ReturnType<typeof useNavigate> = useNavigate();
  const { project } = useProjectFilter();
  const [day, setDay] = useState<string>(localDay);
  useEffect(() => {
    const timer: ReturnType<typeof setInterval> = setInterval(() => setDay(localDay()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const status = useData(() => call("getStatus"), [], (m) => m.type === "queue.updated" || m.type === "job.updated");
  const usage = useData(() => call("getUsage", { query: { from: day, to: day } }), [day], (m) => m.type === "node_run.updated" || m.type === "job.updated");
  const jobs = useJobs("false");
  const visible: JobView[] = (jobs.data ?? []).filter((job) => !project || job.projectId === project);
  const totals = usage.data?.days.reduce((total, row: UsageView["days"][number]) => {
    if (row.day === day && (!project || row.project === project)) {
      total.tokens += row.tokens.input + row.tokens.output + row.tokens.cacheWrite;
      total.cost += row.cost;
    }
    return total;
  }, { tokens: 0, cost: 0 });
  const play = useAction(async () => {
    await call("playInterrupted");
    status.reload();
    jobs.reload();
  });
  const counters: { label: string; value: string | number | undefined; to: string }[] = [
    { label: "Inbox items", value: status.data?.inbox, to: "/inbox" },
    ...labels.map((label) => ({ label, value: jobs.data && !jobs.loading ? visible.filter((job) => jobState(job).label === label).length : undefined, to: `/jobs?${new URLSearchParams({ label })}` })),
    { label: "Tokens today", value: totals?.tokens.toLocaleString(), to: "/usage" },
    { label: "Cost today", value: totals ? usd.format(totals.cost) : undefined, to: "/usage" },
  ];
  return (
    <Page title="Factory" actions={<NewJobButton />}>
      <div className={ui.row}>
        {counters.map(({ label, value, to }) => (
          <Button key={label} disabled={!connected} onClick={() => void navigate(to)}><strong>{value ?? "—"}</strong> {label}</Button>
        ))}
      </div>
      <ErrorText error={status.error} />
      <ErrorText error={usage.error} />
      <ErrorText error={jobs.error} />
      {(status.data?.interrupted ?? 0) > 0 && (
        <div className={ui.banner}><Button disabled={!connected || play.busy} onClick={() => void play.run()}>Play interrupted jobs</Button><ErrorText error={play.error} /></div>
      )}
      <JobTable key={project ?? ""} jobs={visible.filter((job) => !isFinal(job))} factory loading={jobs.loading} />
    </Page>
  );
}
