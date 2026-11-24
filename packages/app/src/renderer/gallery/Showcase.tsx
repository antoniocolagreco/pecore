import { useEffect, useState } from "react";
import { Page } from "../components/ui";
import { SidebarItem, SidebarSection } from "../shell/sidebar";
import { applyTheme, builtInThemes, defaultTheme } from "../theme/themes";
import type { Mode } from "../theme/themes";
import { Button, IconButton } from "../ds/button";
import { Checkbox, Chip, Chips, RadioGroup, Switch } from "../ds/choice";
import { Details, List, ListItem, Stat, Stats, Table, Tabs, TextTable } from "../ds/data";
import { Alert, Badge, Card, Count, EmptyState, Kbd, Progress, Skeleton, Spinner } from "../ds/feedback";
import { PasswordField, SearchField, TextArea, TextField } from "../ds/field";
import { ArrowUpIcon, BellIcon, ChatIcon, FolderIcon, InboxIcon, LinkIcon, MonitorIcon, MoonIcon, MoreIcon, PauseIcon, PlayIcon, PlusIcon, RefreshIcon, StopIcon, SunIcon, TrashIcon } from "../ds/icons";
import { Dialog, Menu, useToasts } from "../ds/overlay";
import { Combobox, MultiCombobox, Select } from "../ds/select";
import { ColorPicker, NumberField, Segmented, Slider } from "../ds/values";
import { Colors, Example, Icons, Rules, Section, Sizes, Surfaces, Typography, slug } from "./foundations";
import g from "./gallery.module.css";

type PreviewMode = "app" | Mode;
type Saved = { theme: string | undefined; palette: string | undefined; style: string | null };

function restore(saved: Saved): void {
  const root = document.documentElement;
  if (saved.theme === undefined) delete root.dataset.theme;
  else root.dataset.theme = saved.theme;
  if (saved.palette === undefined) delete root.dataset.palette;
  else root.dataset.palette = saved.palette;
  if (saved.style === null) root.removeAttribute("style");
  else root.setAttribute("style", saved.style);
}

function ThemePreview() {
  const [saved] = useState<Saved>(() => {
    const root = document.documentElement;
    return { theme: root.dataset.theme, palette: root.dataset.palette, style: root.getAttribute("style") };
  });
  const [mode, setMode] = useState<PreviewMode>("app");
  const [theme, setTheme] = useState<string>(() => saved.palette ? `builtin:${saved.palette.replace(/-(light|dark)$/, "")}` : defaultTheme);
  useEffect(() => {
    if (mode === "app") {
      restore(saved);
      return;
    }
    document.documentElement.removeAttribute("style");
    applyTheme(mode, theme, null);
  }, [mode, theme, saved]);
  useEffect(() => () => restore(saved), [saved]);
  return (
    <>
      <Select ariaLabel="Theme" options={builtInThemes} value={theme} onValueChange={(v) => v && setTheme(v)} disabled={mode === "app"} />
      <Segmented
        label="Theme preview"
        value={mode}
        onValueChange={(v) => setMode(v as PreviewMode)}
        options={[
          { value: "app", label: <><span className={g.themeIcon}><MonitorIcon /></span>App</> },
          { value: "light", label: <><span className={g.themeIcon}><SunIcon /></span>Light</> },
          { value: "dark", label: <><span className={g.themeIcon}><MoonIcon /></span>Dark</> },
        ]}
      />
    </>
  );
}

const sections: string[] = [
  "Rules", "Colours", "Typography", "Sizes", "Icons", "Cards and panels",
  "Text fields", "Text areas, password, search", "Select and combobox", "Checkbox, radio, switch", "Numbers and ranges",
  "Buttons", "Status and feedback", "Overlays", "Data",
];

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

export function Showcase() {
  const [name, setName] = useState("Pippo 2");
  const [recipe, setRecipe] = useState<string | null>(null);
  const [effort, setEffort] = useState(2);
  const [freeDisk, setFreeDisk] = useState<number | null>(10);
  const [color, setColor] = useState("#DC2626");
  const [mode, setMode] = useState("ask");
  const [all, setAll] = useState<boolean[]>([true, false, true]);
  const [traits, setTraits] = useState<string[]>(["Concise"]);
  const someChecked = all.some(Boolean);
  const allChecked = all.every(Boolean);

  return (
    <Page title="Showcase" actions={<ThemePreview />}>
      <SidebarSection title="Showcase">
        {sections.map((title) => (
          <SidebarItem key={title} onClick={() => document.getElementById(slug(title))?.scrollIntoView({ behavior: "smooth", block: "start" })}>{title}</SidebarItem>
        ))}
      </SidebarSection>
      <Rules />
      <Colors />
      <Typography />
      <Sizes />
      <Icons />
      <Surfaces />

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
              { value: "pm", label: "Let the Project Manager decide", detail: "You can review it later." },
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
        <Example caption="Chips">
          <Chips label="Personality">
            {["Concise", "Formal", "Playful"].map((trait) => (
              <Chip key={trait} pressed={traits.includes(trait)} onClick={() => setTraits(traits.includes(trait) ? traits.filter((t) => t !== trait) : [...traits, trait])}>{trait}</Chip>
            ))}
            <Chip pressed={false} aria-disabled>Blocked</Chip>
          </Chips>
        </Example>
      </Section>

      <Section title="Numbers and ranges" note="Drag the number field label left or right to change the value.">
        <Example caption="Number field">
          <NumberField label="Minimum free disk" value={freeDisk} onValueChange={setFreeDisk} min={0} max={100} step={0.5} unit="GB" />
          <span className={g.output}>value: {String(freeDisk)}</span>
        </Example>
        <Example caption="Number field, small range">
          <NumberField label="Concurrent jobs" defaultValue={2} min={1} max={8} />
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
        <Example caption="Colour">
          <ColorPicker label="Colour" description="The 24 agent colours, or a custom one." value={color} onValueChange={setColor} />
        </Example>
      </Section>

      <MoreComponents />
    </Page>
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
  const [file, setFile] = useState("brand.md");
  return (
    <>
      <Section title="Buttons" note="Press any button: it gives a little under the finger. Hover the icon buttons for tooltips.">
        <Example caption="Variants">
          <div className={g.row}>
            <Button variant="primary" icon={<PlusIcon />}>New job</Button>
            <Button>Cancel</Button>
            <Button variant="ghost">Skip</Button>
            <Button variant="danger" icon={<TrashIcon />}>Delete</Button>
            <Button variant="link">Open parent job</Button>
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
            <span className={g.inline}><ChatIcon /> Project Manager <Count value={12} /></span>
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
            <Alert tone="success">&lt;PE/CORE&gt; set up Claude Code and Codex: 8 profiles added.</Alert>
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
          <TextTable>
            <thead><tr><th>Agent</th><th>Model</th><th>Effort</th></tr></thead>
            <tbody>
              <tr><td>Agent A</td><td><code>opus</code></td><td>high</td></tr>
              <tr><td>Agent B</td><td><code>gpt-6.2-sol</code></td><td>high</td></tr>
            </tbody>
          </TextTable>
        </div>
        <Example caption="Details (label and value)">
          <Details>
            <dt>Model</dt><dd>opus</dd>
            <dt>Tokens</dt><dd>12,400 in · 1,830 out</dd>
            <dt>Cost</dt><dd>$0.21</dd>
          </Details>
        </Example>
        <Example caption="List">
          <List label="Knowledge files">
            {["brand.md", "glossary.md", "release-notes.md"].map((name) => <ListItem key={name} mono active={file === name} onClick={() => setFile(name)}>{name}</ListItem>)}
            <ListItem disabled>Disabled</ListItem>
          </List>
        </Example>
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
              action={<Button variant="primary" icon={<ArrowUpIcon />}>Give the Assistant a task</Button>}
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
        description="&lt;PE/CORE&gt; creates the folder and the repository for you."
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
