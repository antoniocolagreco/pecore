import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { BoundaryCard, NodeCard } from "../components/NodeCard";
import { ProjectManagerAvatar } from "../components/ProjectManager";
import { Button } from "../ds/button";
import { Badge, Card } from "../ds/feedback";
import * as icons from "../ds/icons";
import { PlusIcon, SparkIcon } from "../ds/icons";
import g from "./gallery.module.css";

export function slug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section id={slug(title)} className={g.section}>
      <h2 className={g.sectionTitle}>{title}</h2>
      {note && <p className={g.sectionNote}>{note}</p>}
      <div className={g.grid}>{children}</div>
    </section>
  );
}

export function Example({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className={g.example}>
      <span className={g.caption}>{caption}</span>
      {children}
    </div>
  );
}

function useRootChanges(): number {
  const [version, setVersion] = useState<number>(0);
  useEffect(() => {
    const observer = new MutationObserver(() => setVersion((v) => v + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-palette", "style"] });
    return () => observer.disconnect();
  }, []);
  return version;
}

function tokenValue(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const rules: { title: string; items: ReactNode[] }[] = [
  {
    title: "Components",
    items: [
      <>Build screens only from <code>ds/</code> (this page) and the page shell <code>Page</code>, <code>PageActions</code> and <code>ErrorText</code> from <code>components/</code>. One component per kind: a button is <code>Button</code> (<code>variant="link"</code> for a link inside text or a table), a pick list is <code>List</code> with <code>ListItem</code>, an on/off tag is <code>Chip</code>, a frame is <code>Card</code>, a popup is <code>Dialog</code>, an empty list is <code>EmptyState</code>, a notice is <code>Alert</code>, a table is <code>Table</code> or <code>TextTable</code>, a label and value list is <code>Details</code>.</>,
      <>No native <code>&lt;button&gt;</code>, <code>&lt;input&gt;</code>, <code>&lt;select&gt;</code> or <code>&lt;textarea&gt;</code> in screens. The one exception: a Project Manager's colour uses the system colour picker.</>,
      <>Before writing a new component, look here. If one is close, extend it in <code>ds/</code> instead of copying it into a screen.</>,
      <>A new or changed component is added to this page in the same commit.</>,
    ],
  },
  {
    title: "Tokens",
    items: [
      <>Colours only as <code>var(--token)</code> from the Colours section. No hex, <code>rgb()</code> or named colours in screens: every theme must still work.</>,
      <>Text, control, row, icon and radius sizes only from the size tokens. No text smaller than <code>--text-size-sm</code> (14 px).</>,
      <>Font weights: 400 body, 500 controls and emphasis, 600 titles and labels, 650 page titles.</>,
      <>Colour is never the only signal: a state also has its icon or dot and its label.</>,
    ],
  },
  {
    title: "Pages",
    items: [
      <>Every page uses <code>Page</code>: the title at the top left, the actions at the top right.</>,
      <>One main action, primary style with an icon (“New job”). Every other action is secondary or ghost.</>,
      <>Work definitions (nodes, recipes, knowledge, project settings) have Save at the top right, disabled until something changes. App preferences save by themselves.</>,
      <>Pages use the whole content column. Forms and wizards are narrow and centred, with their buttons at the bottom. Only editors with a work area fill the window height.</>,
      <>Each setting is changed on one page; other pages show it read-only with a link to that page.</>,
    ],
  },
  {
    title: "Words",
    items: [
      <>Short labels in sentence case: “New job”, not “Create New Job”.</>,
      <>Say what the user sees and can do, not how the engine works. No internal names (tables, events, states) in the UI.</>,
      <>Empty states name the next action. Errors say what failed and what to do.</>,
    ],
  },
];

export function Rules() {
  return (
    <Section title="Rules" note="Read these before changing any screen. They apply to people and to coding agents; docs/ui-design.md has the full page rules.">
      {rules.map((group) => (
        <Example key={group.title} caption={group.title}>
          <ul className={g.rules}>
            {group.items.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        </Example>
      ))}
    </Section>
  );
}

type Token = { name: string; use: string };

const colorGroups: { title: string; kind: "fill" | "text" | "line" | "shadow"; tokens: Token[] }[] = [
  {
    title: "Accent",
    kind: "fill",
    tokens: [
      { name: "--accent", use: "focus, links, highlighted text, running" },
      { name: "--accent-hover", use: "hover of accent text" },
      { name: "--accent-fill", use: "primary buttons, selected items, your chat bubble" },
      { name: "--accent-fill-hover", use: "hover of accent fills" },
      { name: "--on-accent", use: "text on accent fills" },
    ],
  },
  {
    title: "Status",
    kind: "fill",
    tokens: [
      { name: "--success", use: "succeeded, success outcomes" },
      { name: "--warning", use: "needs you, waiting, queued" },
      { name: "--danger", use: "failed, validation errors, delete" },
      { name: "--text-3", use: "paused, stopped, skipped, disabled" },
    ],
  },
  {
    title: "Surfaces",
    kind: "fill",
    tokens: [
      { name: "--bg", use: "page background" },
      { name: "--surface", use: "cards and panels" },
      { name: "--control-bg", use: "fields and secondary buttons" },
      { name: "--fill", use: "hover background" },
      { name: "--fill-strong", use: "selected background" },
      { name: "--material", use: "popovers, menus, sticky bars (with --blur)" },
    ],
  },
  {
    title: "Text",
    kind: "text",
    tokens: [
      { name: "--text", use: "body text" },
      { name: "--text-2", use: "secondary text, descriptions" },
      { name: "--text-3", use: "hints, placeholders, captions" },
      { name: "--accent", use: "links" },
    ],
  },
  {
    title: "Lines and focus",
    kind: "line",
    tokens: [
      { name: "--separator", use: "dividers, card outlines, table rows" },
      { name: "--control-border", use: "field and button borders" },
      { name: "--control-border-hover", use: "hovered field borders" },
      { name: "--ring", use: "keyboard focus ring" },
      { name: "--ring-danger", use: "focus ring of a field with an error" },
    ],
  },
  {
    title: "Shadows",
    kind: "shadow",
    tokens: [
      { name: "--control-shadow", use: "fields and secondary buttons" },
      { name: "--popover-shadow", use: "menus, selects, dialogs" },
      { name: "--knob-shadow", use: "switch and slider knobs" },
    ],
  },
];

function Swatch({ token, kind }: { token: Token; kind: "fill" | "text" | "line" | "shadow" }) {
  const style: CSSProperties =
    kind === "fill" ? { background: `var(${token.name})` }
    : kind === "text" ? { color: `var(${token.name})` }
    : kind === "line" ? { boxShadow: token.name.startsWith("--ring") ? `0 0 0 3px var(${token.name})` : `inset 0 0 0 1.5px var(${token.name})` }
    : { boxShadow: `var(${token.name})`, background: "var(--control-bg)" };
  return (
    <div className={g.token}>
      <span className={`${g.swatch} ${kind === "text" ? g.swatchText : ""}`} style={style}>{kind === "text" ? "Aa" : null}</span>
      <span className={g.tokenText}>
        <code>{token.name}</code>
        <span className={g.tokenUse}>{token.use}</span>
        {kind !== "shadow" && <span className={g.tokenValue}>{tokenValue(token.name)}</span>}
      </span>
    </div>
  );
}

export function Colors() {
  useRootChanges();
  return (
    <Section title="Colours" note="Every colour is a token. The values below are the current theme's; switch theme above to see them change.">
      {colorGroups.map((group) => (
        <Example key={group.title} caption={group.title}>
          <div className={g.tokens}>
            {group.tokens.map((token) => <Swatch key={token.name} token={token} kind={group.kind} />)}
          </div>
        </Example>
      ))}
    </Section>
  );
}

const textSizes: Token[] = [
  { name: "--text-size-xl", use: "page titles" },
  { name: "--text-size-lg", use: "section and dialog titles" },
  { name: "--text-size-md", use: "emphasis" },
  { name: "--text-size", use: "body text and controls" },
  { name: "--text-size-sm", use: "captions, badges, table headers, chat, logs and code" },
];

const weights: { weight: number; use: string }[] = [
  { weight: 400, use: "body text" },
  { weight: 500, use: "buttons, controls, emphasis" },
  { weight: 600, use: "section titles, labels, table headers" },
  { weight: 650, use: "page titles" },
];

export function Typography() {
  useRootChanges();
  return (
    <Section title="Typography" note="Inter for text, JetBrains Mono for code, paths and logs. Line height --line-height (1.5).">
      <div className={g.wide}>
        <Example caption="Sizes">
          <div className={g.typeScale}>
            {textSizes.map((size) => (
              <div key={size.name} className={g.typeRow}>
                <span style={{ fontSize: `var(${size.name})` }}>Run the tests and open a pull request</span>
                <span className={g.tokenText}>
                  <code>{size.name}</code>
                  <span className={g.tokenUse}>{tokenValue(size.name)} · {size.use}</span>
                </span>
              </div>
            ))}
          </div>
        </Example>
      </div>
      <Example caption="Weights">
        <div className={g.stack}>
          {weights.map((w) => (
            <div key={w.weight} className={g.tokenText}>
              <span style={{ fontWeight: w.weight }}>Fix login redirect loop</span>
              <span className={g.tokenUse}>{w.weight} · {w.use}</span>
            </div>
          ))}
        </div>
      </Example>
      <Example caption="Fonts">
        <div className={g.stack}>
          <div className={g.tokenText}>
            <span style={{ fontFamily: "var(--font)" }}>The quick brown fox jumps over the lazy dog 0123456789</span>
            <code>--font</code>
          </div>
          <div className={g.tokenText}>
            <span style={{ fontFamily: "var(--mono)", fontSize: "var(--text-size-sm)" }}>git push origin factory/01JQ7 --force-with-lease</span>
            <code>--mono</code>
          </div>
        </div>
      </Example>
    </Section>
  );
}

const sizeGroups: { title: string; tokens: Token[]; shape: "height" | "square" | "radius" }[] = [
  { title: "Controls", shape: "height", tokens: [{ name: "--control-h-lg", use: "large buttons and fields" }, { name: "--control-h", use: "buttons, fields, selects" }, { name: "--control-h-sm", use: "small buttons and fields" }] },
  { title: "Rows", shape: "height", tokens: [{ name: "--row-h-lg", use: "table rows" }, { name: "--row-h", use: "menu and list rows" }, { name: "--row-h-sm", use: "table headers, compact rows" }, { name: "--mini-h", use: "buttons inside fields" }, { name: "--tag-h", use: "badges, counters, key hints" }] },
  { title: "Icons", shape: "square", tokens: [{ name: "--icon-button-size", use: "icon buttons" }, { name: "--icon-button-size-sm", use: "small icon buttons" }, { name: "--icon-size", use: "icon size md" }, { name: "--icon-size-sm", use: "icon next to text (default)" }, { name: "--icon-size-xs", use: "arrows and crosses in fields" }] },
  { title: "Radius", shape: "radius", tokens: [{ name: "--radius-lg", use: "cards, panels, dialogs" }, { name: "--radius", use: "fields, buttons, menus" }, { name: "--radius-sm", use: "small items inside controls" }] },
];

export function Sizes() {
  useRootChanges();
  return (
    <Section title="Sizes" note="Components use only these variables, never a written number for text, control, row, icon or radius size.">
      {sizeGroups.map((group) => (
        <Example key={group.title} caption={group.title}>
          <div className={g.stack}>
            {group.tokens.map((token) => (
              <div key={token.name} className={g.token}>
                <span
                  className={g.sizeShape}
                  style={group.shape === "height" ? { height: `var(${token.name})`, width: 56 }
                    : group.shape === "square" ? { height: `var(${token.name})`, width: `var(${token.name})` }
                    : { height: 44, width: 56, borderRadius: `var(${token.name})` }}
                />
                <span className={g.tokenText}>
                  <code>{token.name}</code>
                  <span className={g.tokenUse}>{tokenValue(token.name)} · {token.use}</span>
                </span>
              </div>
            ))}
          </div>
        </Example>
      ))}
    </Section>
  );
}

const iconList: [string, (props: { size?: icons.IconSize }) => ReactNode][] = Object.entries(icons)
  .filter(([name]) => name.endsWith("Icon"))
  .map(([name, icon]) => [name, icon as (props: { size?: icons.IconSize }) => ReactNode]);

export function Icons() {
  return (
    <Section title="Icons" note={`All ${iconList.length} icons from ds/icons.tsx, 16 px grid, 1.5 px stroke, in currentColor. Use size="md" in icon buttons and menus, the default sm next to text. Add a missing icon there; never paste an SVG into a screen.`}>
      <div className={`${g.wide} ${g.icons}`}>
        {iconList.map(([name, Icon]) => (
          <div key={name} className={g.icon}>
            <Icon size="md" />
            <code>{name}</code>
          </div>
        ))}
      </div>
    </Section>
  );
}

export function Surfaces() {
  return (
    <Section title="Cards and panels" note="Surfaces are --surface with a --separator outline; never draw a new frame with its own border and shadow.">
      <div className={g.wide}>
        <Example caption="Page header (Page)">
          <div className={g.pageHeader}>
            <span className={g.pageTitle}>Jobs</span>
            <div className={g.row}>
              <Button>Import</Button>
              <Button variant="primary" icon={<PlusIcon />}>New job</Button>
            </div>
          </div>
        </Example>
      </div>
      <Example caption="Card with title and action">
        <Card title="Recent jobs" actions={<Button size="sm" variant="ghost">View all</Button>}>
          <span className={g.muted}>Content sits in the card body.</span>
        </Card>
      </Example>
      <Example caption="Card, padded">
        <Card padded>
          <span className={g.muted}>A card without a title, for a single block.</span>
        </Card>
      </Example>
      <Example caption="Card, padded, with a heading">
        <Card padded>
          <h3>Repository</h3>
          <span className={g.muted}>A settings group on a page.</span>
        </Card>
      </Example>
      <div className={g.wide}>
        <Example caption="Node cards (recipes and templates)">
          <div className={g.row}>
            <BoundaryCard boundary="start" />
            <NodeCard icon={<SparkIcon size="md" />} title="Write the fix" kind="agent" />
            <NodeCard icon={<icons.PlayIcon size="md" />} title="Run the tests" kind="command" />
            <NodeCard icon={<icons.CheckCircleIcon size="md" />} title="Review the change" kind="human" />
            <BoundaryCard boundary="end" />
          </div>
        </Example>
      </div>
      <Example caption="Project Managers">
        <div className={g.stack}>
          {[{ name: "Eva", color: "#FFDE38", project: "shop" }, { name: "Marco", color: "#3B82F6", project: "blog" }, { name: "Lia", color: "#E5484D", project: "space-game" }].map((pm) => (
            <div key={pm.name} className={g.row}>
              <ProjectManagerAvatar pm={pm} />
              <span>{pm.name} - Project Manager</span>
              <Badge>{pm.project}</Badge>
            </div>
          ))}
        </div>
      </Example>
    </Section>
  );
}
