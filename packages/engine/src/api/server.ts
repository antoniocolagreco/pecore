import { randomBytes, timingSafeEqual } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { apiErrorStatus, routes } from "@pecore/schemas";
import type { ApiErrorCode, RouteDef, RouteName, RouteOutput, RouteParsed } from "@pecore/schemas";
import { homePaths } from "../home/layout";
import type { Engine } from "../main";
import { NotFoundError } from "../main";
import { liveRoute } from "./ws";

export class HttpError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type Handler<N extends RouteName> = (input: RouteParsed<N>) => Promise<RouteOutput<N>>;
export type Handlers = { [N in RouteName]: Handler<N> };

export type ApiOptions = {
  origins?: string[];
  validateResponses?: boolean;
  handlers: (engine: Engine) => Handlers;
};

export type ApiServer = { port: number; token: string; close(): Promise<void> };

const send = (reply: FastifyReply, code: ApiErrorCode, message: string) => reply.code(apiErrorStatus[code]).send({ error: code, message });

function fastifyPath(path: string): string {
  return path.replace(/\*[a-zA-Z]+$/, "*");
}

function routeParams(path: string, raw: unknown): unknown {
  const rest = /\*([a-zA-Z]+)$/.exec(path)?.[1];
  if (!rest || raw === null || typeof raw !== "object") return raw;
  const { "*": value, ...others } = raw as Record<string, unknown>;
  return { ...others, [rest]: value };
}

function parsePart(schema: z.ZodType | undefined, value: unknown, what: string): unknown {
  if (!schema) return undefined;
  const r = schema.safeParse(value);
  if (!r.success) throw new HttpError("bad_request", `${what}: ${z.prettifyError(r.error)}`);
  return r.data;
}

export async function startApi(engine: Engine, opts: ApiOptions): Promise<ApiServer> {
  const token = randomBytes(32).toString("hex");
  const expected = Buffer.from(`Bearer ${token}`);
  const tokenOk = (header: string | undefined) => header !== undefined && Buffer.byteLength(header) === expected.length && timingSafeEqual(Buffer.from(header), expected);
  const origins = new Set(opts.origins ?? ["app://pecore"]);
  const handlers = opts.handlers(engine) as Record<RouteName, (input: unknown) => Promise<unknown>>;
  let port = 0;

  const app = Fastify({ logger: false });
  await app.register(websocket);

  app.addHook("onRequest", async (req, reply) => {
    if (req.headers.host !== `127.0.0.1:${port}`) return send(reply, "forbidden", "Host must be 127.0.0.1 with the API port");
    const origin = req.headers.origin;
    if (origin !== undefined && !origins.has(origin)) return send(reply, "forbidden", `Origin ${origin} is not allowed`);
    if (origin !== undefined) reply.header("access-control-allow-origin", origin).header("vary", "origin");
    if (req.method === "OPTIONS")
      return reply.header("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE").header("access-control-allow-headers", "authorization, content-type, if-match").code(204).send();
    if (req.url === "/live") return;
    if (!tokenOk(req.headers.authorization)) return send(reply, "unauthorized", "missing or wrong token");
  });

  app.setErrorHandler((e: Error & { statusCode?: number }, _req, reply) => {
    if (e instanceof HttpError) return send(reply, e.code, e.message);
    if (e instanceof NotFoundError) return send(reply, "not_found", e.message);
    if (e.statusCode !== undefined && e.statusCode >= 400 && e.statusCode < 500) return send(reply, "bad_request", e.message);
    return send(reply, "engine_error", e.message);
  });
  app.setNotFoundHandler((req, reply) => send(reply, "not_found", `no route ${req.method} ${req.url}`));

  app.options("*", async (_req, reply) => reply.code(204).send());
  for (const [name, def] of Object.entries(routes) as [RouteName, RouteDef][]) {
    app.route({
      method: def.method,
      url: fastifyPath(def.path),
      handler: async (req) => {
        const input = {
          params: parsePart(def.params, routeParams(def.path, req.params), "params"),
          query: parsePart(def.query, req.query, "query"),
          body: parsePart(def.body, req.body ?? {}, "body"),
        };
        const out = await handlers[name](input);
        if (opts.validateResponses) def.response.parse(out);
        return out;
      },
    });
  }
  liveRoute(app, engine, token);

  await app.listen({ host: "127.0.0.1", port: 0 });
  port = (app.server.address() as AddressInfo).port;
  const file = homePaths(engine.opts.home).apiFile;
  await writeFile(`${file}.tmp`, JSON.stringify({ port, token }) + "\n", { mode: 0o600 });
  await rename(`${file}.tmp`, file);
  return {
    port,
    token,
    close: async () => {
      await rm(file, { force: true });
      await app.close();
    },
  };
}
