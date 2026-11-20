import { apiClient } from "@pecore/schemas";
import type { ApiClient } from "@pecore/schemas";

declare global {
  interface Window {
    pecore: { api(): Promise<{ port: number; token: string }>; pickFolder(): Promise<string | null> };
  }
}

let connection: Promise<{ port: number; token: string; call: ApiClient }> | null = null;

export function engineConnection() {
  connection ??= window.pecore.api().then((a) => ({ ...a, call: apiClient(a) }));
  return connection;
}

export const call: ApiClient = (async (...args: Parameters<ApiClient>) => (await engineConnection()).call(...args)) as ApiClient;
