import { useState } from "react";
import { call } from "../api/client";
import { useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { Button, dateTime, Empty, ErrorText, Field, Page, Panel, ui } from "../components/ui";

function day(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

export function Usage() {
  const connected: boolean = useConnected();
  const [range, setRange] = useState(() => ({ from: day(-6), to: day(0) }));
  const [offset, setOffset] = useState(0);
  const inverted: boolean = !!range.from && !!range.to && range.from > range.to;
  const usage = useData(() => inverted ? Promise.resolve(undefined) : call("getUsage", { query: { from: range.from || undefined, to: range.to || undefined } }), [range.from, range.to], (message) => message.type === "job.updated" || message.type === "node_run.updated");
  const data = usage.data;
  const start: number = Math.min(offset, Math.max(0, Math.ceil((data?.days.length ?? 0) / 100) - 1) * 100);
  const rows = (data?.days ?? []).slice(start, start + 100);
  const hasCost: boolean = rows.some((row) => row.cost > 0);
  const budgets = (data?.budgets ?? []).filter((item) => item.dayTokens !== null || item.dayUsd !== null);
  return <Page title="Usage" actions={<Button disabled={!connected || inverted} onClick={usage.reload}>Refresh</Button>}>
    <div className={ui.row}>
      <Field label="From"><input type="date" disabled={!connected} value={range.from} onChange={(event) => { setRange({ ...range, from: event.target.value }); setOffset(0); }} /></Field>
      <Field label="To"><input type="date" disabled={!connected} value={range.to} onChange={(event) => { setRange({ ...range, to: event.target.value }); setOffset(0); }} /></Field>
    </div>
    <ErrorText error={inverted ? "Choose an end date on or after the start date." : usage.error} />
    {usage.loading && <p className={ui.muted}>Loading usage…</p>}
    {data && !inverted && <>
      <Panel>
        <h2>Daily tokens</h2>
        {rows.length ? <table className={ui.table}><thead><tr><th>Day</th><th>Account</th><th>Project</th><th>Input</th><th>Output</th><th>Cache read</th><th>Cache write</th>{hasCost && <th>Cost (USD)</th>}</tr></thead>
          <tbody>{rows.map((row) => <tr key={JSON.stringify([row.day, row.account, row.project])}>
            <td>{row.day}</td><td>{row.account}</td><td>{row.project}</td><td>{row.tokens.input.toLocaleString()}</td><td>{row.tokens.output.toLocaleString()}</td>
            <td>{row.tokens.cacheRead.toLocaleString()}</td><td>{row.tokens.cacheWrite.toLocaleString()}</td>
            {hasCost && <td>{row.cost > 0 ? row.cost.toLocaleString(undefined, { maximumSignificantDigits: 12 }) : ""}</td>}
          </tr>)}</tbody>
        </table> : <Empty>No token usage in this date range.</Empty>}
        <div className={ui.row}>
          {start > 0 && <Button disabled={!connected} onClick={() => setOffset(start - 100)}>Previous</Button>}
          {data.days.length > start + 100 && <Button disabled={!connected} onClick={() => setOffset(start + 100)}>Show more</Button>}
        </div>
      </Panel>
      <Panel>
        <h2>Budgets today</h2>
        {budgets.length ? <ul>{budgets.map((item) => <li key={item.project}>
          {item.project}{item.dayTokens !== null && ` · ${item.usedTokens.toLocaleString()} / ${item.dayTokens.toLocaleString()} tokens`}{item.dayUsd !== null && ` · $${item.usedUsd} / $${item.dayUsd}`}
        </li>)}</ul> : <Empty>No daily budgets configured.</Empty>}
      </Panel>
      <Panel>
        <h2>Cooldowns</h2>
        {data.cooldowns.length ? <ul>{data.cooldowns.map((item) => <li key={item.account}>{item.account} · {item.kind === "quota" ? "Quota" : "Rate limit"}{item.until > 0 && " until " + dateTime(item.until)}</li>)}</ul> : <Empty>No accounts cooling down.</Empty>}
      </Panel>
      <Panel>
        <h2>Reported quotas</h2>
        {data.quotas.length ? <ul>{data.quotas.map((item) => <li key={item.account}>
          {item.account} · {item.status} · Seen {dateTime(item.seenAt)}{item.resetAt !== null && item.resetAt > 0 && " · Resets " + dateTime(item.resetAt)}
          {Object.entries(item.windows).length > 0 && <ul>{Object.entries(item.windows).map(([window, quota]) => <li key={window}>{window} · {quota.utilization.toLocaleString(undefined, { style: "percent", maximumFractionDigits: 2 })} used{quota.resetAt > 0 && " · Resets " + dateTime(quota.resetAt)}</li>)}</ul>}
        </li>)}</ul> : <Empty>No connector has reported a quota.</Empty>}
      </Panel>
    </>}
  </Page>;
}
