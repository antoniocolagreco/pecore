import type { ProjectManagerIdentity } from "@pecore/schemas";
import type { CSSProperties } from "react";
import { Link } from "react-router";
import { call } from "../api/client";
import { useData } from "../api/hooks";
import { Select } from "../ds/select";
import s from "./ProjectManager.module.css";

function light(color: string): boolean {
  const [r, g, b] = [1, 3, 5].map((index) => {
    const channel: number = parseInt(color.slice(index, index + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45;
}

export function ProjectManagerAvatar({ pm }: { pm: ProjectManagerIdentity }) {
  return (
    <span className={`${s.avatar} ${light(pm.color) ? s.light : ""}`} style={{ "--pm": pm.color } as CSSProperties} aria-hidden>
      {pm.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function ProjectDot({ pm }: { pm: ProjectManagerIdentity | null }) {
  return pm ? <span className={s.dot} style={{ background: pm.color }} title={`Project Manager ${pm.name}`} aria-hidden /> : null;
}

export function useProjectManagers(except?: string) {
  const catalog = useData(() => call("getAgents"), [], (event) => event.type === "project.updated" || (event.type === "definition.changed" && event.path === "agents.json"));
  const projects = useData(() => call("listProjects"), [], (event) => event.type === "project.updated");
  const used: Set<string | undefined> = new Set((projects.data ?? []).flatMap(({ id, project }) => id !== except && project?.pm ? [project.pm.agentId] : []));
  const managers: ProjectManagerIdentity[] = (catalog.data?.value.agents ?? []).flatMap((agent) => agent.kind === "pm" && !used.has(agent.id)
    ? [{ name: agent.name, color: agent.color, agentId: agent.id }] : []);
  return { managers, ready: !!catalog.data && !!projects.data, error: catalog.error ?? projects.error };
}

export function ProjectManagerField({ value, managers, disabled, onChange }: {
  value: string | null;
  managers: ProjectManagerIdentity[];
  disabled?: boolean;
  onChange(value: ProjectManagerIdentity): void;
}) {
  return <Select label="Project Manager" value={value} disabled={disabled || !managers.length} placeholder="Choose a Project Manager"
    description={<Link to="/agents">Manage Project Managers in Agents</Link>}
    options={managers.map((manager) => ({ value: manager.agentId!, label: manager.name }))}
    onValueChange={(id) => {
      const manager: ProjectManagerIdentity | undefined = managers.find(({ agentId }) => agentId === id);
      if (manager) onChange(manager);
    }} />;
}
