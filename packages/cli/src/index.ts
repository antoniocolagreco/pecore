import { run } from "./run";

process.exitCode = await run(process.argv.slice(2), { log: (t) => console.log(t), error: (t) => console.error(t) });
