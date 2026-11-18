import type { ProjectDb } from "../store/project-db";

export function effectRecorder(db: ProjectDb, jobId: string | null, nodeRunId: string, node: string) {
  let hash = "";
  return {
    requested(commandHash: string) {
      hash = commandHash;
      db.append([{ jobId, type: "effect.requested", payload: { nodeRunId, node, commandHash } }]);
    },
    done(ok: boolean, result: unknown) {
      db.append([{ jobId, type: ok ? "effect.completed" : "effect.failed", payload: { nodeRunId, node, commandHash: hash, result } }]);
    },
  };
}
