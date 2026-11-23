import { useState } from "react";
import { appName } from "@pecore/schemas";
import type { BuiltInHarness } from "@pecore/schemas";
import { call } from "../api/client";
import { useAction, useData } from "../api/hooks";
import { useConnected, useLive } from "../api/live";
import { ErrorText, Field, ui } from "../components/ui";
import { Button } from "../ds/button";
import { Alert } from "../ds/feedback";

export const install: Record<BuiltInHarness, { name: string; url: string }> = {
  "claude-code": { name: "Claude Code", url: "https://code.claude.com/docs/en/setup" },
  codex: { name: "Codex", url: "https://developers.openai.com/codex/cli/" },
  opencode: { name: "OpenCode", url: "https://opencode.ai/docs/" },
};

type Progress = { url: string | null; text: string; done: boolean };

export function SetupBanner() {
  const connected: boolean = useConnected();
  const setup = useData(() => call("getSetup"), [], (message) => message.type === "login.progress" && message.done);
  const [loginId, setLoginId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [code, setCode] = useState<string>("");
  useLive((message) => {
    if (message.type !== "login.progress") return;
    setProgress((current) => ({ ...current, [message.loginId]: { url: message.url, text: message.text, done: message.done } }));
  }, []);
  const start = useAction(async (connector: BuiltInHarness) => {
    setLoginId(null);
    setProgress({});
    setCode("");
    const result = await call("startSetupLogin", { params: { connector } });
    setLoginId(result.loginId);
  });
  const send = useAction(async (id: string) => {
    await call("loginCode", { params: { id }, body: { code: code.trim() } });
    setCode("");
  });
  if (!setup.data || setup.data.harnesses.some((harness) => harness.installed && harness.loggedIn)) return null;
  const current: Progress | undefined = loginId ? progress[loginId] : undefined;
  const running: boolean = loginId !== null && !current?.done;
  const url: string | undefined = current?.url?.startsWith("https://") ? current.url : undefined;
  return <aside aria-label="Harness setup">
    <Alert tone="accent" title="Connect an AI coding tool to start">
      <span className={ui.stack}>
        <span>{appName} works through Claude Code, Codex or OpenCode. Install one, or log in to one you already have; {appName} sets up the rest.</span>
        <span className={ui.row}>
          {setup.data.harnesses.map(({ connector, installed }) => installed
            ? <Button key={connector} size="sm" variant="primary" disabled={!connected || running || start.busy} onClick={() => { send.clear(); void start.run(connector); }}>Log in to {install[connector].name}</Button>
            : connected
              ? <a key={connector} href={install[connector].url} target="_blank" rel="noreferrer">Install {install[connector].name}</a>
              : <span key={connector}>{install[connector].name}</span>)}
        </span>
        {url && connected && running && <a href={url} target="_blank" rel="noreferrer">Open login URL</a>}
        {loginId && <span role="status" className={ui.muted}>{current?.text || "Starting login…"}</span>}
        {loginId && running && <form className={ui.row} onSubmit={(event) => {
          event.preventDefault();
          if (connected && !send.busy && code.trim()) void send.run(loginId);
        }}>
          <Field label="Login code"><input type="password" autoComplete="off" disabled={!connected || send.busy} value={code} onChange={(event) => setCode(event.target.value)} /></Field>
          <Button type="submit" size="sm" disabled={!connected || send.busy || !code.trim()}>Send code</Button>
        </form>}
        <ErrorText error={start.error ?? send.error} />
      </span>
    </Alert>
  </aside>;
}
