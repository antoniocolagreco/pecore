import { host } from "./host";
import type { HostPort } from "./host";

const parentPort = (process as unknown as { parentPort?: HostPort }).parentPort;
if (!parentPort) throw new Error("the engine must run as an Electron utility process");
const home = process.env.PECORE_HOME;
const resources = process.env.PECORE_RESOURCES;
if (!home || !resources) throw new Error("PECORE_HOME and PECORE_RESOURCES must be set");

void host(parentPort, { home, resources, version: process.env.PECORE_APP_VERSION ?? "0.0.0", devOrigin: process.env.PECORE_DEV_ORIGIN, downloads: process.env.PECORE_DOWNLOADS, development: process.env.PECORE_STAGE === "dev" });
