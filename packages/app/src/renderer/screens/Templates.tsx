import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import type { DefinitionEntry } from "@pecore/schemas";
import { call } from "../api/client";
import { useData } from "../api/hooks";
import { useConnected } from "../api/live";
import { DefinitionIcon, useDefinitionIcons } from "../components/DefinitionIcon";
import type { DefinitionType } from "../components/DefinitionIcon";
import { ErrorText, Page, ui } from "../components/ui";
import { Button } from "../ds/button";
import { Tabs } from "../ds/data";
import { Card, EmptyState, Spinner } from "../ds/feedback";
import { AlertIcon, PlusIcon } from "../ds/icons";
import { MultiCombobox } from "../ds/select";
import type { Option } from "../ds/select";
import { definitionUrl, object, string } from "./NodeEditor";
import s from "./Templates.module.css";

const nameWords: ReadonlyMap<string, string> = new Map<string, string>([
  ["bugfix", "Bug Fix"],
  ["eslint", "ESLint"],
  ["github", "GitHub"],
  ["gitlab", "GitLab"],
  ["mr", "MR"],
  ["pr", "PR"],
  ["typecheck", "Type Check"],
]);

function TemplateList({ type, icons }: { type: DefinitionType; icons: ReadonlyMap<string, string> | undefined }) {
  const connected: boolean = useConnected();
  const [filter, setFilter] = useState<string[]>([]);
  const dir: string = `templates/${type}s`;
  const templates = useData(() => call("listDefinitions", { query: { dir } }), [dir],
    (event) => event.type === "definition.changed" && event.path.startsWith(dir + "/"));
  const labels: Map<string, string> = new Map();
  const definitions: { entry: DefinitionEntry; tags: Set<string> }[] = (templates.data ?? []).flatMap((entry) => {
    if (!entry.path.endsWith(".json")) return [];
    const tags: unknown = object(entry.value).tags;
    const values: Set<string> = new Set();
    if (type === "node" && Array.isArray(tags)) {
      for (const candidate of tags) {
        const label: string = string(candidate).trim();
        if (!label) continue;
        const value: string = label.toLowerCase();
        if (!labels.has(value)) labels.set(value, label);
        values.add(value);
      }
    }
    return [{ entry, tags: values }];
  });
  const options: Option[] = [...labels].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  const requestedTags: string[] = filter.filter((tag) => labels.has(tag));
  const entries: DefinitionEntry[] = definitions.filter(({ tags }) => requestedTags.every((tag) => tags.has(tag))).map(({ entry }) => entry);
  return (
    <div className={s.section}>
      <p className={`${ui.muted} ${s.intro}`}>{type === "node"
        ? "Nodes define reusable operations, such as running an agent or a command, asking for a review, or fetching tickets."
        : "Recipes connect nodes and use their outcomes to decide what a job runs next."}</p>
      {type === "node" && <MultiCombobox label="Filter by tags" placeholder="Select tags" options={options} value={requestedTags}
        onValueChange={setFilter} empty={options.length ? "No matching tags" : "No tags on node templates"} />}
      <ErrorText error={templates.error} />
      {templates.loading && !templates.data && <Spinner />}
      {!templates.loading && !templates.error && !entries.length &&
        <EmptyState title={requestedTags.length ? "No nodes match these tags." : `No ${type} templates.`} />}
      {entries.length > 0 && <ul className={s.list} aria-label={type === "node" ? "Node templates" : "Recipe templates"}>
        {entries.map(({ path, value, errors }) => {
          const definition = object(value);
          const name: string = string(definition.name) || path.slice(dir.length + 1, -5);
          const title: string = name.split("-").filter(Boolean).map((word) => nameWords.get(word) ?? word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
          const description: string = string(definition.description);
          const contents = <>
            <Card className={s.card}>
              <span className={s.glyph}><DefinitionIcon icons={icons} type={type} name={name} selected={string(definition.icon)} /></span>
              <strong title={title}>{title}</strong>
            </Card>
            <div className={s.description}>
              {description}
              {errors.length > 0 && <span className={s.invalid} title={errors.map(({ message }) => message).join("\n")} role="img" aria-label="Definition errors"><AlertIcon /></span>}
            </div>
          </>;
          return <li key={path}>
            {connected
              ? <Link className={s.entry} to={definitionUrl(type, path)}>{contents}</Link>
              : <div className={s.entry}>{contents}</div>}
          </li>;
        })}
      </ul>}
    </div>
  );
}

export function Templates() {
  const connected: boolean = useConnected();
  const icons = useDefinitionIcons();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const type: DefinitionType = params.get("tab") === "recipes" ? "recipe" : "node";
  return <Page title="Templates" actions={
    <Button variant="primary" icon={<PlusIcon />} disabled={!connected} onClick={() => void navigate(`/templates/${type}s/new`)}>
      {type === "node" ? "New Node" : "New Recipe"}
    </Button>
  }>
    <Tabs value={type} onValueChange={(value) => setParams(value === "recipe" ? { tab: "recipes" } : {}, { replace: true })} tabs={[
      { value: "node", label: "Node templates", content: <TemplateList type="node" icons={icons.data} /> },
      { value: "recipe", label: "Recipe templates", content: <TemplateList type="recipe" icons={icons.data} /> },
    ]} />
  </Page>;
}
