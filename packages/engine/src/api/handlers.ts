import type { Engine } from "../main";
import { definitionHandlers } from "./routes/definitions";
import { jobHandlers } from "./routes/jobs";
import { globalFileHandlers } from "./routes/settings";
import { projectHandlers } from "./routes/projects";
import { queueHandlers } from "./routes/queue";
import { statusHandlers } from "./routes/status";
import { systemHandlers } from "./routes/system";
import type { Handlers } from "./server";

export function handlers(version: string) {
  return (engine: Engine): Handlers => ({
    ...projectHandlers(engine),
    ...jobHandlers(engine),
    ...queueHandlers(engine),
    ...statusHandlers(engine, version),
    ...systemHandlers(engine),
    ...definitionHandlers(engine),
    ...globalFileHandlers(engine),
  });
}
