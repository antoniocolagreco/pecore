import { useEffect, useSyncExternalStore } from "react";
import { LiveMessage } from "@pecore/schemas";
import { engineConnection } from "./client";

type Listener = (m: LiveMessage) => void;

const listeners = new Set<Listener>();
const subscriptions = new Map<string, number>();
const statusListeners = new Set<() => void>();
let connected = false;
let socket: WebSocket | null = null;
let retry = 0;

function setConnected(v: boolean): void {
  if (connected === v) return;
  connected = v;
  for (const l of statusListeners) l();
}

async function open(): Promise<void> {
  const { port, token } = await engineConnection();
  const ws = new WebSocket(`ws://127.0.0.1:${port}/live`);
  socket = ws;
  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ auth: token }));
    for (const id of subscriptions.keys()) ws.send(JSON.stringify({ subscribe: id }));
    retry = 0;
    setConnected(true);
  });
  ws.addEventListener("message", (e) => {
    const r = LiveMessage.safeParse(JSON.parse(String(e.data)));
    if (r.success) for (const l of listeners) l(r.data);
  });
  ws.addEventListener("close", () => {
    socket = null;
    setConnected(false);
    const delay = Math.min(10_000, 500 * 2 ** retry++);
    setTimeout(() => void open(), delay);
  });
}

let started = false;
export function startLive(): void {
  if (started) return;
  started = true;
  void open();
}

export function onLive(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useLive(l: Listener, deps: unknown[]): void {
  useEffect(() => onLive(l), deps);
}

export function useConnected(): boolean {
  return useSyncExternalStore(
    (cb) => {
      statusListeners.add(cb);
      return () => statusListeners.delete(cb);
    },
    () => connected,
  );
}

export function subscribeLog(attemptId: string): () => void {
  subscriptions.set(attemptId, (subscriptions.get(attemptId) ?? 0) + 1);
  if (subscriptions.get(attemptId) === 1) socket?.send(JSON.stringify({ subscribe: attemptId }));
  return () => {
    const n = (subscriptions.get(attemptId) ?? 1) - 1;
    if (n > 0) return void subscriptions.set(attemptId, n);
    subscriptions.delete(attemptId);
    socket?.send(JSON.stringify({ unsubscribe: attemptId }));
  };
}
