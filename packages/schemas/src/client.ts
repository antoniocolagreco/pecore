import { ApiErrorBody, routes } from "./api";
import type { RouteDef, RouteInput, RouteName, RouteOutput, Routes } from "./api";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function routePath(path: string, params: Record<string, string> = {}): string {
  return path.replace(/:([a-zA-Z]+)|\*([a-zA-Z]+)/g, (_, name: string | undefined, rest: string | undefined) => {
    if (name !== undefined) return encodeURIComponent(params[name] ?? "");
    return (params[rest!] ?? "").split("/").map(encodeURIComponent).join("/");
  });
}

type Takes<N extends RouteName> = Routes[N] extends { params: unknown } | { query: unknown } | { body: unknown } ? true : false;
export type ApiClient = <N extends RouteName>(name: N, ...input: Takes<N> extends true ? [RouteInput<N>] : [RouteInput<N>?]) => Promise<RouteOutput<N>>;

export function apiClient(opts: { port: number; token: string; fetch?: typeof fetch }): ApiClient {
  const doFetch = opts.fetch ?? fetch;
  return (async (name: RouteName, input: { params?: Record<string, string>; query?: Record<string, string>; body?: unknown } = {}) => {
    const route: RouteDef = routes[name];
    const query = new URLSearchParams(Object.entries(input.query ?? {}).filter(([, v]) => v !== undefined)).toString();
    const url = `http://127.0.0.1:${opts.port}${routePath(route.path, input.params)}${query ? `?${query}` : ""}`;
    const headers: Record<string, string> = { authorization: `Bearer ${opts.token}` };
    if (input.body !== undefined) headers["content-type"] = "application/json";
    const res = await doFetch(url, { method: route.method, headers, ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}) });
    const text = await res.text();
    const json: unknown = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const err = ApiErrorBody.safeParse(json);
      throw err.success ? new ApiError(res.status, err.data.error, err.data.message) : new ApiError(res.status, "engine_error", text);
    }
    return json;
  }) as ApiClient;
}
