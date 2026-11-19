import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { LiveClientMessage, liveAuthFailed } from "@pecore/schemas";
import type { LiveMessage } from "@pecore/schemas";
import type { Engine } from "../main";

export const liveAuthTimeoutMs = 5000;

export function liveRoute(app: FastifyInstance, engine: Engine, token: string): void {
  const expected = Buffer.from(token);
  const tokenOk = (t: string) => Buffer.byteLength(t) === expected.length && timingSafeEqual(Buffer.from(t), expected);

  app.get("/live", { websocket: true }, (socket) => {
    let authed = false;
    const attempts = new Set<string>();
    const forward = (msg: LiveMessage) => {
      if (msg.type === "log.line" && !attempts.has(msg.attemptId)) return;
      socket.send(JSON.stringify(msg));
    };
    const timer = setTimeout(() => socket.close(liveAuthFailed, "no auth message"), liveAuthTimeoutMs);
    socket.on("message", (data: Buffer) => {
      let msg: LiveClientMessage;
      try {
        msg = LiveClientMessage.parse(JSON.parse(data.toString("utf8")));
      } catch {
        if (!authed) socket.close(liveAuthFailed, "first message must be {auth}");
        return;
      }
      if (!authed) {
        if (!("auth" in msg) || !tokenOk(msg.auth)) {
          socket.close(liveAuthFailed, "wrong token");
          return;
        }
        authed = true;
        clearTimeout(timer);
        engine.on("live", forward);
        return;
      }
      if ("subscribe" in msg) attempts.add(msg.subscribe);
      if ("unsubscribe" in msg) attempts.delete(msg.unsubscribe);
    });
    socket.on("close", () => {
      clearTimeout(timer);
      engine.off("live", forward);
    });
  });
}
