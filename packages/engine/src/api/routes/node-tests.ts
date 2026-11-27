import type { Engine } from "../../main";
import { NodeTestError } from "../../node-tests/manager";
import { HttpError } from "../server";
import type { Handlers } from "../server";

function httpError(error: unknown): never {
  if (error instanceof NodeTestError) throw new HttpError(error.code, error.message);
  throw error;
}

export function nodeTestHandlers(engine: Engine) {
  return {
    runNodeTest: async ({ body }) => {
      try {
        return { id: await engine.nodeTests.run(body) };
      } catch (error) {
        return httpError(error);
      }
    },
    getNodeTest: async ({ params }) => {
      try {
        return engine.nodeTests.get(params.id);
      } catch (error) {
        return httpError(error);
      }
    },
    stopNodeTest: async ({ params }) => {
      try {
        await engine.nodeTests.stop(params.id);
      } catch (error) {
        httpError(error);
      }
      return { ok: true as const };
    },
    answerNodeTest: async ({ params, body }) => {
      try {
        await engine.nodeTests.answer(params.id, body);
      } catch (error) {
        httpError(error);
      }
      return { ok: true as const };
    },
    resetNodeTests: async () => {
      await engine.nodeTests.reset();
      return { ok: true as const };
    },
  } satisfies Partial<Handlers>;
}
