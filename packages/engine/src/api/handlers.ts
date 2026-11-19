import type { Engine } from "../main";
import { jobHandlers } from "./routes/jobs";
import { projectHandlers } from "./routes/projects";
import { queueHandlers } from "./routes/queue";
import { statusHandlers } from "./routes/status";
import type { Handlers } from "./server";

export function handlers(version: string) {
  return (engine: Engine): Handlers => ({
    ...projectHandlers(engine),
    ...jobHandlers(engine),
    ...queueHandlers(engine),
    ...statusHandlers(engine, version),
  });
}
