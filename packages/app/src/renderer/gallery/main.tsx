import { StrictMode, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "../ds/tokens.css";
import { Button, IconButton } from "../ds/button";
import { Checkbox, RadioGroup, Switch } from "../ds/choice";
import { Stat, Stats, Table, Tabs } from "../ds/data";
import { Alert, Badge, Card, Count, EmptyState, Kbd, Progress, Skeleton, Spinner } from "../ds/feedback";
import { PasswordField, SearchField, TextArea, TextField } from "../ds/field";
import { ArrowUpIcon, BellIcon, ChatIcon, FolderIcon, InboxIcon, LinkIcon, MonitorIcon, MoonIcon, MoreIcon, PauseIcon, PlayIcon, PlusIcon, RefreshIcon, StopIcon, SunIcon, TrashIcon } from "../ds/icons";
import { Dialog, Menu, ToastProvider, TooltipProvider, useToasts } from "../ds/overlay";
import { Combobox, MultiCombobox, Select } from "../ds/select";
import { NumberField, Segmented, Slider } from "../ds/values";
import g from "./gallery.module.css";

type Theme = "system" | "light" | "dark";

function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem("pecore-gallery-theme") as Theme | null) ?? "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme = theme === "system" ? (media.matches ? "dark" : "light") : theme;
    };
    apply();
    media.addEventListener("change", apply);
    try {
      localStorage.setItem("pecore-gallery-theme", theme);
    } catch {
      /* private window */
    }
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  return [theme, setTheme];
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className={g.section}>
      <h2 className={g.sectionTitle}>{title}</h2>
      {note && <p className={g.sectionNote}>{note}</p>}
      <div className={g.grid}>{children}</div>
    </section>
  );
}

function Example({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className={g.example}>
      <span className={g.caption}>{caption}</span>
      {children}
    </div>
  );
}

const recipes = [
  { value: "bugfix", label: "Bug fix" },
  { value: "feature", label: "Feature" },
  { value: "refactor", label: "Refactor" },
  { value: "docs", label: "Documentation" },
];

const models = [
  {
    label: "Claude Code",
    options: [
      { value: "claude-opus", label: "Opus", detail: "frontier" },
      { value: "claude-sonnet", label: "Sonnet", detail: "strong" },
      { value: "claude-haiku", label: "Haiku", detail: "cheap" },
    ],
  },
  {
    label: "Codex",
    options: [
      { value: "gpt-pro", label: "GPT Pro", detail: "frontier" },
      { value: "gpt", label: "GPT", detail: "strong" },
      { value: "gpt-mini", label: "GPT Mini", detail: "cheap" },
    ],
  },
  {
    label: "OpenCode",
    options: [
      { value: "big-pickle", label: "Big Pickle", detail: "standard" },
      { value: "deepseek-flash", label: "DeepSeek Flash", detail: "cheap", disabled: true },
    ],
  },
];

const projects = [
  { value: "pippo", label: "pippo", detail: "~/code/pippo" },
  { value: "shop", label: "shop", detail: "~/code/shop" },
  { value: "game", label: "space-game", detail: "~/code/space-game" },
  { value: "blog", label: "blog", detail: "~/code/blog" },
  { value: "api", label: "payments-api", detail: "~/work/payments-api" },
  { value: "cli", label: "dotfiles", detail: "~/dotfiles" },
];

const labels = [
  { value: "bug", label: "bug" },
  { value: "feature", label: "feature" },
  { value: "security", label: "security" },
  { value: "ui", label: "ui" },
  { value: "docs", label: "docs" },
  { value: "performance", label: "performance" },
  { value: "good-first-issue", label: "good first issue" },
];

const efforts = ["low", "medium", "high", "xhigh", "max"];

function projectNameError(name: string): string | undefined {
  if (name === "") return undefined;
  if (!/^[a-z0-9-]+$/.test(name)) return "Use lowercase letters, digits and dashes.";
  if (name.length > 40) return "Keep it under 40 characters.";
  return undefined;
}

function Gallery() {
  const [theme, setTheme] = useTheme();
  const [name, setName] = useState("Pippo 2");
  const [recipe, setRecipe] = useState<string | null>(null);
  const [effort, setEffort] = useState(2);
  const [budget, setBudget] = useState<number | null>(5);
  const [mode, setMode] = useState("ask");
  const [all, setAll] = useState<boolean[]>([true, false, true]);
  const someChecked = all.some(Boolean);
  const allChecked = all.every(Boolean);

  return (
    <div className={g.page}>
      <header className={g.header}>
        <div>
          <h1 className={g.title}>Components</h1>
          <p className={g.subtitle}>PeCore design system</p>
        </div>
        <Segmented
          label="Theme"
          value={theme}
          onValueChange={(v) => setTheme(v as Theme)}
          options={[
            { value: "system", label: <><span className={g.themeIcon}><MonitorIcon /></span>System</> },
            { value: "light", label: <><span className={g.themeIcon}><SunIcon /></span>Light</> },
            { value: "dark", label: <><span className={g.themeIcon}><MoonIcon /></span>Dark</> },
          ]}
        />
      </header>

      <Section title="Text fields" note="Focus ring, hover, live validation with animated error, prefix, suffix and icon.">
        <Example caption="Default">
          <TextField label="Title" placeholder="What should be done?" />
        </Example>
        <Example caption="Description">
          <TextField label="Repository" placeholder="owner/name" description="The GitHub repository the jobs push to." />
        </Example>
        <Example caption="Live validation">
          <TextField label="Project name" value={name} onValueChange={setName} error={projectNameError(name)} description="Used for the folder and the branch prefix." />
        </Example>
        <Example caption="Disabled">
          <TextField label="Home folder" defaultValue="~/.pecore" disabled />
        </Example>
        <Example caption="Prefix and icon">
          <TextField label="Website" prefix="https://" placeholder="example.com" type="url" />
        </Example>
        <Example caption="Leading icon and suffix">
          <TextField label="Work folder" leading={<FolderIcon />} defaultValue="~/code/pippo" suffix=".git" />
        </Example>
        <Example caption="Monospace">
          <TextField label="Branch" defaultValue="pecore/fix-login-redirect" mono />
        </Example>
        <Example caption="Small">
          <TextField label="Tag" size="sm" leading={<LinkIcon />} placeholder="v1.2.0" />
        </Example>
      </Section>

      <Section title="Text areas, password, search" note="The text area grows with its content. Search: Ctrl K focuses it, Esc clears it.">
        <Example caption="Text area with counter">
          <TextArea label="Ticket" placeholder="Describe the change…" maxLength={280} description="Markdown is supported." />
        </Example>
        <Example caption="Monospace text area">
          <TextArea label="Prompt" mono defaultValue={"You are reviewing a pull request.\nList only real bugs."} />
        </Example>
        <Example caption="Password">
          <PasswordField label="Token" placeholder="ghp_…" description="The eye shows or hides it. Warns when Caps Lock is on." />
        </Example>
        <Example caption="Search">
          <div className={g.stack}>
            <SearchField placeholder="Search jobs, projects, nodes" shortcut="Ctrl K" />
            <SearchField size="sm" placeholder="Filter" />
          </div>
        </Example>
      </Section>

      <Section title="Select and combobox" note="The select opens over its trigger with the chosen item aligned, as on macOS. Type to jump; the combobox filters.">
        <Example caption="Select">
          <Select label="Recipe" options={recipes} value={recipe} onValueChange={setRecipe} placeholder="Choose a recipe" />
          <span className={g.output}>value: {String(recipe)}</span>
        </Example>
        <Example caption="Groups, details, disabled item">
          <Select label="Model" options={models} defaultValue="claude-sonnet" />
        </Example>
        <Example caption="Error">
          <Select label="Account" options={[{ value: "work", label: "work" }]} error="This account is logged out." />
        </Example>
        <Example caption="Disabled">
          <Select label="Harness" options={[{ value: "claude", label: "Claude Code" }]} defaultValue="claude" disabled />
        </Example>
        <Example caption="Combobox">
          <Combobox label="Project" options={projects} placeholder="Find a project" empty="No project with that name" />
        </Example>
        <Example caption="Multiple with chips">
          <MultiCombobox label="Labels" options={labels} defaultValue={["bug", "ui"]} placeholder="Add labels" />
        </Example>
      </Section>

      <Section title="Checkbox, radio, switch" note="Spring animations on press and on change; keyboard focus ring only when using the keyboard.">
        <Example caption="Checkboxes">
          <div className={g.stack}>
            <Checkbox
              label="All notifications"
              checked={allChecked}
              indeterminate={someChecked && !allChecked}
              onCheckedChange={(c) => setAll(all.map(() => c))}
            />
            {["Job finished", "Job needs you", "Quota low"].map((l, i) => (
              <Checkbox key={l} label={l} checked={all[i]} onCheckedChange={(c) => setAll(all.map((v, j) => (j === i ? c : v)))} />
            ))}
            <Checkbox label="Disabled" disabled defaultChecked />
          </div>
        </Example>
        <Example caption="Radio group">
          <RadioGroup
            label="When a job needs a decision"
            value={mode}
            onValueChange={setMode}
            options={[
              { value: "ask", label: "Ask me", detail: "The job waits in the Inbox." },
              { value: "orchestrator", label: "Let the orchestrator decide", detail: "You can review it later." },
              { value: "stop", label: "Stop the job", disabled: true },
            ]}
          />
        </Example>
        <Example caption="Switches">
          <div className={g.stack}>
            <Switch label="Protected mode" detail="Agents run as a separate user." defaultChecked />
            <Switch label="Pause all jobs" />
            <Switch label="Disabled" disabled />
          </div>
        </Example>
      </Section>

      <Section title="Numbers and ranges" note="Drag the number field label left or right to change the value.">
        <Example caption="Number field">
          <NumberField label="Daily budget" value={budget} onValueChange={setBudget} min={0} max={100} step={0.5} unit="USD" />
          <span className={g.output}>value: {String(budget)}</span>
        </Example>
        <Example caption="Number field, small range">
          <NumberField label="Parallel jobs" defaultValue={2} min={1} max={8} />
        </Example>
        <Example caption="Slider with steps">
          <Slider label="Effort" value={effort} onValueChange={setEffort} min={0} max={4} format={(v) => efforts[v]!} ticks={efforts} />
        </Example>
        <Example caption="Slider">
          <Slider label="Volume" defaultValue={40} format={(v) => `${v}%`} />
          <Slider label="Disabled" defaultValue={70} disabled />
        </Example>
        <Example caption="Segmented control">
          <div className={g.stack}>
            <Segmented options={[{ value: "all", label: "All" }, { value: "running", label: "Running" }, { value: "waiting", label: "Waiting" }, { value: "done", label: "Done" }]} />
            <Segmented options={[{ value: "day", label: "Day" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }]} defaultValue="week" />
          </div>
        </Example>
      </Section>

      <MoreComponents />
    </div>
  );
}

type DemoJob = { id: string; title: string; project: string; state: "running" | "waiting" | "failed" | "succeeded"; node: string; age: string };

const demoJobs: DemoJob[] = [
  { id: "1", title: "Fix login redirect loop", project: "shop", state: "running", node: "write", age: "4m" },
  { id: "2", title: "Add dark mode to settings", project: "pippo", state: "waiting", node: "human-review", age: "12m" },
  { id: "3", title: "Upgrade to React 19", project: "blog", state: "failed", node: "test", age: "1h" },
  { id: "4", title: "Rust check for clippy warnings", project: "space-game", state: "succeeded", node: "commit", age: "3h" },
];

function StateBadge({ state }: { state: DemoJob["state"] }) {
  if (state === "running") return <Badge tone="accent" dot pulse>Running</Badge>;
  if (state === "waiting") return <Badge tone="warning" dot>Needs you</Badge>;
  if (state === "failed") return <Badge tone="danger" dot>Failed</Badge>;
  return <Badge tone="success" dot>Done</Badge>;
}

function MoreComponents() {
  const toasts = useToasts();
  const [dialog, setDialog] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Section title="Buttons" note="Press any button: it gives a little under the finger. Hover the icon buttons for tooltips.">
        <Example caption="Variants">
          <div className={g.row}>
            <Button variant="primary" icon={<PlusIcon />}>New job</Button>
            <Button>Cancel</Button>
            <Button variant="ghost">Skip</Button>
            <Button variant="danger" icon={<TrashIcon />}>Delete</Button>
          </div>
        </Example>
        <Example caption="Sizes and states">
          <div className={g.row}>
            <Button size="sm">Small</Button>
            <Button size="lg" variant="primary">Large</Button>
            <Button disabled>Disabled</Button>
            <Button variant="primary" loading={busy} onClick={() => { setBusy(true); setTimeout(() => setBusy(false), 1600); }}>Save</Button>
          </div>
        </Example>
        <Example caption="Icon buttons with tooltip">
          <div className={g.row}>
            <IconButton label="Pause" shortcut="Space" icon={<PauseIcon />} />
            <IconButton label="Resume" icon={<PlayIcon />} />
            <IconButton label="Stop" icon={<StopIcon />} />
            <IconButton label="Retry" icon={<RefreshIcon />} />
            <Menu
              align="end"
              trigger={<Button variant="ghost" icon={<MoreIcon />} aria-label="More" />}
              items={[
                { label: "Open in terminal", onSelect: () => undefined, shortcut: "Ctrl T" },
                { label: "Copy branch name", onSelect: () => undefined },
                "separator",
                { label: "Archive", onSelect: () => undefined },
                { label: "Delete job", icon: <TrashIcon />, danger: true, onSelect: () => setConfirm(true) },
              ]}
            />
          </div>
        </Example>
      </Section>

      <Section title="Status and feedback" note="Badges for job states, counters, alerts with actions, progress and loading placeholders.">
        <Example caption="Job states">
          <div className={g.row}>
            <StateBadge state="running" />
            <StateBadge state="waiting" />
            <StateBadge state="failed" />
            <StateBadge state="succeeded" />
            <Badge>Paused</Badge>
          </div>
        </Example>
        <Example caption="Counters and keys">
          <div className={g.row}>
            <span className={g.inline}><InboxIcon /> Inbox <Count value={3} /></span>
            <span className={g.inline}><ChatIcon /> Orchestrator <Count value={12} /></span>
            <span className={g.inline}>Search <Kbd>Ctrl</Kbd><Kbd>K</Kbd></span>
          </div>
        </Example>
        <Example caption="Progress and loading">
          <div className={g.stack}>
            <Progress value={62} />
            <Progress value={null} />
            <div className={g.row}><Spinner /> <span className={g.output}>Checking the login…</span></div>
            <Skeleton width="70%" />
            <Skeleton width="45%" />
          </div>
        </Example>
        <Example caption="Alerts">
          <div className={g.stack}>
            <Alert tone="warning" title="Global pause is on" actions={<Button size="sm">Resume all</Button>}>Running jobs hold and queued jobs do not start.</Alert>
            <Alert tone="danger" title="Codex is logged out">Jobs that use it wait until you log in again.</Alert>
            <Alert tone="success">PeCore set up Claude Code and Codex: 8 profiles added.</Alert>
          </div>
        </Example>
      </Section>

      <Section title="Overlays" note="Dialogs scale in over a blurred backdrop; toasts stack and expand on hover, swipe right to dismiss.">
        <Example caption="Dialog">
          <div className={g.row}>
            <Button onClick={() => setDialog(true)}>New project…</Button>
            <Button variant="danger" onClick={() => setConfirm(true)}>Delete job…</Button>
          </div>
        </Example>
        <Example caption="Toasts">
          <div className={g.row}>
            <Button
              icon={<BellIcon />}
              onClick={() => toasts.add({ title: "Job finished", description: `“Fix login redirect loop” is ready for review.` })}
            >
              Show a toast
            </Button>
          </div>
        </Example>
      </Section>

      <Section title="Data" note="Stats link to their list; rows are keyboard focusable; tabs slide their indicator.">
        <div className={g.wide}>
          <Stats>
            <Stat value={3} label="Need you" tone="attention" onClick={() => undefined} />
            <Stat value={2} label="Running" />
            <Stat value={1} label="Failed" tone="danger" onClick={() => undefined} />
            <Stat value="184k" label="Tokens today" />
            <Stat value="$1.92" label="Cost today" />
          </Stats>
        </div>
        <div className={g.wide}>
          <Card title="Active jobs" actions={<Button size="sm" variant="ghost">View all</Button>} padded={false}>
            <Table
              label="Active jobs"
              rows={demoJobs}
              rowKey={(j) => j.id}
              onRowClick={() => undefined}
              columns={[
                { key: "title", header: "Title", cell: (j) => j.title },
                { key: "project", header: "Project", cell: (j) => j.project, muted: true, width: 120 },
                { key: "state", header: "State", cell: (j) => <StateBadge state={j.state} />, width: 120 },
                { key: "node", header: "Step", cell: (j) => j.node, muted: true, width: 130 },
                { key: "age", header: "Started", cell: (j) => j.age, muted: true, align: "end", width: 80 },
              ]}
            />
          </Card>
        </div>
        <div className={g.wide}>
          <Tabs
            tabs={[
              { value: "graph", label: "Graph", content: <span className={g.output}>The recipe graph goes here.</span> },
              { value: "history", label: "History", content: <span className={g.output}>Every attempt with its logs.</span> },
              { value: "diff", label: "Changes", content: <span className={g.output}>The diff against the target branch.</span> },
            ]}
          />
        </div>
        <div className={g.wide}>
          <Card padded>
            <EmptyState
              icon={<InboxIcon />}
              title="Nothing needs you"
              action={<Button variant="primary" icon={<ArrowUpIcon />}>Give the orchestrator a task</Button>}
            >
              When a job waits for a review or a decision, it shows up here.
            </EmptyState>
          </Card>
        </div>
      </Section>

      <Dialog
        open={dialog}
        onOpenChange={setDialog}
        title="New project"
        description="PeCore creates the folder and the repository for you."
        footer={<><Button onClick={() => setDialog(false)}>Cancel</Button><Button variant="primary" onClick={() => setDialog(false)}>Create</Button></>}
      >
        <TextField label="Name" defaultValue="space-game" autoFocus />
        <Select label="Recipe" options={recipes} defaultValue="feature" />
      </Dialog>
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Delete “Upgrade to React 19”?"
        description="Its branch, logs and artifacts are removed. This cannot be undone."
        width={400}
        footer={<><Button onClick={() => setConfirm(false)}>Cancel</Button><Button variant="dangerSolid" onClick={() => setConfirm(false)}>Delete</Button></>}
      />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <ToastProvider>
        <Gallery />
      </ToastProvider>
    </TooltipProvider>
  </StrictMode>,
);
