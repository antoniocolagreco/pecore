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
import { SearchField } from "../ds/field";
import { SidebarItem, SidebarSection } from "../shell/sidebar";
import { Badge, Card, EmptyState, Spinner } from "../ds/feedback";
import { AlertIcon, PlusIcon } from "../ds/icons";
import { definitionUrl, object, string } from "./NodeEditor";
import { RecipeNodeKindBadge, recipeNodeKind } from "./RecipeNodeKind";
import type { RecipeNodeKind } from "./RecipeNodeKind";
import { templateTitle } from "../components/templateTitle";
import editorStyles from "./Editors.module.css";
import s from "./Templates.module.css";

function TemplateList({ type, icons }: { type: DefinitionType; icons: ReadonlyMap<string, string> | undefined }) {
  const connected: boolean = useConnected();
  const [filter, setFilter] = useState("");
  const dir: string = `templates/${type}s`;
  const templates = useData(() => call("listDefinitions", { query: { dir } }), [dir],
    (event) => event.type === "definition.changed" && event.path.startsWith(dir + "/"));
  const query: string[] = filter.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const entries: DefinitionEntry[] = (templates.data ?? []).filter(({ path, value }) => {
    if (!path.endsWith(".json")) return false;
    if (type !== "node" || !query.length) return true;
    const definition = object(value);
    const name: string = string(definition.name) || path.slice(dir.length + 1, -5);
    const tags: string[] = Array.isArray(definition.tags) ? definition.tags.map(string) : [];
    const terms: string = [name, templateTitle(name), string(definition.kind), string(definition.mode), ...tags].join(" ").toLowerCase();
    return query.every((term) => terms.includes(term));
  });
  return (
    <div className={s.section}>
      <p className={`${ui.muted} ${s.intro}`}>{type === "node"
        ? "Nodes define reusable operations, such as running an agent or a command, asking for a review, or fetching tickets."
        : "Recipes connect nodes and use their outcomes to decide what a job runs next."}</p>
      {type === "node" && <SearchField className={s.search} ariaLabel="Search nodes" placeholder="Search by name, kind or tag"
        value={filter} onValueChange={setFilter} />}
      <ErrorText error={templates.error} />
      {templates.loading && !templates.data && <Spinner />}
      {!templates.loading && !templates.error && !entries.length &&
        <EmptyState title={query.length ? "No nodes match your search." : `No ${type} templates.`} />}
      {entries.length > 0 && <ul className={s.list} aria-label={type === "node" ? "Node templates" : "Recipe templates"}>
        {entries.map(({ path, value, errors }) => {
          const definition = object(value);
          const name: string = string(definition.name) || path.slice(dir.length + 1, -5);
          const title: string = templateTitle(name);
          const description: string = string(definition.description);
          const kind: RecipeNodeKind | undefined = type === "node" ? recipeNodeKind(definition.kind) : undefined;
          const source: boolean = type === "node" && definition.kind === "source";
          const kindClass: string | undefined = kind ? editorStyles[kind] : source ? s.source : undefined;
          const contents = <>
            <Card className={[s.card, kindClass && s.nodeCard, kindClass].filter(Boolean).join(" ")}>
              <span className={s.glyph}><DefinitionIcon icons={icons} type={type} name={name} selected={string(definition.icon)} /></span>
              <strong title={title}><span>{title}</span></strong>
              {kind && <div className={s.kind}><RecipeNodeKindBadge kind={kind} /></div>}
              {source && <div className={s.kind}><Badge tone="success" dot>Source</Badge></div>}
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
    <SidebarSection title="Templates" label="Template types">
      <SidebarItem to="/templates" active={type === "node"}>Nodes</SidebarItem>
      <SidebarItem to="/templates?tab=recipes" active={type === "recipe"}>Recipes</SidebarItem>
    </SidebarSection>
    <Tabs value={type} onValueChange={(value) => setParams(value === "recipe" ? { tab: "recipes" } : {}, { replace: true })} tabs={[
      { value: "node", label: "Node templates", content: <TemplateList type="node" icons={icons.data} /> },
      { value: "recipe", label: "Recipe templates", content: <TemplateList type="recipe" icons={icons.data} /> },
    ]} />
  </Page>;
}
