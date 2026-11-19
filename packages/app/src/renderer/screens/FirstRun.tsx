import { useState } from "react";
import { Link, useNavigate } from "react-router";
import type { FirstRunView } from "@pecore/schemas";
import { call } from "../api/client";
import { useAction, useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { Button, ErrorText, Page, Panel, ui } from "../components/ui";
import { settingUrl } from "./NodeEditor";
import s from "./Editors.module.css";

const steps: Record<FirstRunView["steps"][number]["step"], { title: string; link: string; action: string }> = {
  prerequisites: { title: "Prerequisites", link: settingUrl("prerequisites"), action: "Check prerequisites" },
  home: { title: "PECORE_HOME", link: settingUrl("home"), action: "Review permissions" },
  accounts: { title: "Accounts", link: settingUrl("accounts"), action: "Open accounts" },
  tiers: { title: "Profiles and tiers", link: settingUrl("tiers"), action: "Open profiles and tiers" },
  orchestrator: { title: "Orchestrator", link: settingUrl("orchestrator"), action: "Choose an orchestrator profile" },
  project: { title: "First project", link: "/projects/new", action: "New project" },
};

export function FirstRun() {
  const connected: boolean = useConnected();
  const navigate = useNavigate();
  const checklist = useData(() => call("getFirstRun"), [], (message) => message.type === "definition.changed" || message.type === "project.updated" || (message.type === "login.progress" && message.done));
  const [skip, setSkip] = useState(false);
  const finish = useAction(async () => {
    const latest = await call("getFirstRun");
    if (!latest.steps.every(({ step, ok }) => ok || (step === "project" && skip))) {
      checklist.reload();
      throw new Error("A required step needs attention.");
    }
    const { value, sha256 } = await call("getSettings");
    await call("putSettings", { body: { value: { ...value, firstRunDone: true }, baseSha256: sha256 } });
    await navigate("/", { replace: true });
  });
  const ready: boolean = !!checklist.data?.steps.length && checklist.data.steps.every(({ step, ok }) => ok || (step === "project" && skip));

  return <div className={s.fullPage}><Page title="Set up PeCore" actions={<Button disabled={!connected || checklist.loading || finish.busy} onClick={checklist.reload}>Recheck</Button>}>
    {!connected && <div className={ui.banner}>Disconnected, reconnecting</div>}
    <ErrorText error={finish.error ?? checklist.error} />
    {checklist.loading && <p className={ui.muted}>Checking setup…</p>}
    <Panel><ol className={ui.stack}>
      {checklist.data?.steps.map(({ step, ok, problems }) => {
        const entry = steps[step];
        const skipped: boolean = step === "project" && skip && !ok;
        return <li key={step}>
          <strong>{entry.title}</strong> · {ok ? "Ready" : skipped ? "Skipped" : "Needs attention"}
          {problems.length > 0 && !skipped && <ul>{problems.map((problem, index) => <li key={index}>{problem}</li>)}</ul>}
          {!ok && <div className={ui.row}>
            {connected && <Link to={entry.link}>{entry.action}</Link>}
            {step === "project" && <Button disabled={!connected || finish.busy} onClick={() => setSkip(!skip)}>{skip ? "Include project" : "Skip"}</Button>}
          </div>}
        </li>;
      })}
    </ol></Panel>
    <div><Button kind="primary" disabled={!connected || !ready || finish.busy} onClick={() => void finish.run()}>Finish</Button></div>
  </Page></div>;
}
