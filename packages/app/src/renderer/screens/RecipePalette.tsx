import { useRef, useState } from "react";
import type { PointerEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import type { XYPosition } from "@xyflow/react";
import { usePageScroll } from "../components/usePageScroll";
import { useViewState } from "../components/useViewState";
import { SearchField } from "../ds/field";
import { Card, Spinner } from "../ds/feedback";
import { NodeCard, nodeKindLabels } from "../components/NodeCard";
import type { NodeAgentBadge, RecipeNodeKind } from "../components/NodeCard";
import s from "./Editors.module.css";

export type PaletteNode = { name: string; title: string; tags: string[]; icon: ReactNode; kind: RecipeNodeKind };

type Gesture = {
  id: number;
  origin: XYPosition;
  scroll: number;
  name?: string;
  mode?: "scroll" | "node";
};

export function RecipePalette({ nodes, defaultAgent, disabled, loading, onAdd, children }: {
  nodes: PaletteNode[];
  defaultAgent?: NodeAgentBadge;
  disabled: boolean;
  loading: boolean;
  onAdd(name: string, point: XYPosition): void;
  children?: ReactNode;
}) {
  const [query, setQuery] = useViewState("recipe.palette.search", "");
  const [preview, setPreview] = useState<{ name: string; point: XYPosition }>();
  const { page: rail } = usePageScroll<HTMLUListElement>("recipe.palette");
  const gesture = useRef<Gesture | undefined>(undefined);
  const terms: string[] = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const filtered: PaletteNode[] = nodes.filter(({ name, title, tags, kind }) => {
    const text: string = [name, title, nodeKindLabels[kind], ...tags].join(" ").toLowerCase();
    return terms.every((term) => text.includes(term));
  });
  const dragged: PaletteNode | undefined = preview && nodes.find(({ name }) => name === preview.name);

  const start = (event: PointerEvent<HTMLUListElement>): void => {
    if (event.button !== 0 || !event.isPrimary) return;
    const tile: HTMLElement | null = !disabled && event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-node-template]") : null;
    gesture.current = {
      id: event.pointerId, origin: { x: event.clientX, y: event.clientY }, scroll: event.currentTarget.scrollLeft, name: tile?.dataset.nodeTemplate,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const move = (event: PointerEvent<HTMLUListElement>): void => {
    const active: Gesture | undefined = gesture.current;
    if (!active || active.id !== event.pointerId || !event.buttons) return;
    const dx: number = event.clientX - active.origin.x;
    const dy: number = event.clientY - active.origin.y;
    if (!active.mode && Math.hypot(dx, dy) < 6) return;

    const { top, bottom } = event.currentTarget.getBoundingClientRect();
    const outside: boolean = event.clientY < top - 8 || event.clientY > bottom + 8;
    const canDragNode: boolean = !disabled && !!active.name;
    if (!active.mode) {
      active.mode = canDragNode && Math.abs(dy) > Math.abs(dx) ? "node" : "scroll";
    }
    if (canDragNode && outside) active.mode = "node";
    event.currentTarget.dataset.gesture = active.mode;
    if (active.mode === "node" && active.name) setPreview({ name: active.name, point: { x: event.clientX, y: event.clientY } });
    else event.currentTarget.scrollLeft = active.scroll - dx;
  };

  const finish = (event: PointerEvent<HTMLUListElement>, drop: boolean): void => {
    const active: Gesture | undefined = gesture.current;
    if (!active || active.id !== event.pointerId) return;
    gesture.current = undefined;
    delete event.currentTarget.dataset.gesture;
    setPreview(undefined);
    if (drop && !disabled && active.mode === "node" && active.name) {
      onAdd(active.name, { x: event.clientX, y: event.clientY });
    }
  };

  return <Card title="Node palette" className={s.palettePanel} padded={false} actions={
    <SearchField className={s.paletteFilter} ariaLabel="Filter nodes" placeholder="Name, kind or tag" size="sm" value={query}
      onValueChange={(next) => {
        setQuery(next);
        if (rail.current) rail.current.scrollLeft = 0;
      }} />
  }>
    <div className={s.paletteBody}>
      <ul ref={rail} className={s.paletteRail} aria-label="Node palette" aria-disabled={disabled || undefined} onPointerDown={start} onPointerMove={move}
        onPointerUp={(event) => finish(event, true)} onPointerCancel={(event) => finish(event, false)}
        onLostPointerCapture={(event) => finish(event, false)} onDragStart={(event) => event.preventDefault()}>
        {filtered.map(({ name, title, icon, kind }) => <li key={name} data-node-template={name}>
          <NodeCard icon={icon} title={title} kind={kind} agent={defaultAgent} />
        </li>)}
        {!filtered.length && <li className={s.paletteEmpty} role="status">
          {loading ? <Spinner /> : nodes.length ? "No matching nodes" : "No nodes available"}
        </li>}
      </ul>
      {children}
    </div>
    {preview && dragged && createPortal(
      <div className={s.nodePreview} style={{ left: preview.point.x, top: preview.point.y }} aria-hidden="true">
        <NodeCard icon={dragged.icon} title={dragged.title} kind={dragged.kind} agent={defaultAgent} />
      </div>, document.body,
    )}
  </Card>;
}
