import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { Settings } from "@pecore/schemas";
import { parseAllDocuments } from "yaml";
import { gitApp } from "../workdir/git-as";
import { withComposeDirectory } from "./runtime";

export type ComposePort = { service: string; port: number; variable: string };
export type ComposeFile = {
  bytes: Buffer;
  sha256: string;
  services: string[];
  completedServices: string[];
  ports: ComposePort[];
};

const validationProject = "pecore-validation";
const serviceKeys: readonly string[] = ["image", "environment", "ports", "healthcheck", "command", "entrypoint", "tmpfs", "depends_on", "volumes"];

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${path} must be an object`);
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value;
}

function allowKeys(value: Record<string, unknown>, allowed: readonly string[], at: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`Compose key ${at}${key} is not allowed`);
  }
}

function rejectFileReferences(source: string): void {
  const docs = parseAllDocuments(source, { merge: true, uniqueKeys: true });
  if (!Array.isArray(docs) || docs.length !== 1) throw new Error("Compose file must hold exactly one YAML document");
  const doc = docs[0]!;
  const problems = [...doc.errors, ...doc.warnings];
  if (problems.length > 0) throw new Error(`Compose file is not plain YAML: ${problems[0]!.message}`);
  const model = doc.toJS({ maxAliasCount: 100 }) as unknown;
  if (typeof model !== "object" || model === null || Array.isArray(model)) throw new Error("Compose file must be a YAML mapping");
  const top = model as Record<string, unknown>;
  if (Object.hasOwn(top, "include")) throw new Error("Compose key include is not allowed because it can load files");
  const services = top.services;
  if (typeof services !== "object" || services === null) return;
  for (const [name, service] of Object.entries(services)) {
    if (typeof service !== "object" || service === null) continue;
    for (const key of ["env_file", "label_file"]) {
      if (Object.hasOwn(service, key)) throw new Error(`Compose key services.${name}.${key} is not allowed because it can load files`);
    }
    const extended = (service as Record<string, unknown>).extends;
    if (typeof extended === "object" && extended !== null && Object.hasOwn(extended, "file")) {
      throw new Error(`Compose key services.${name}.extends.file is not allowed because it can load files`);
    }
  }
}

function inspectCompose(value: unknown): Omit<ComposeFile, "bytes" | "sha256"> {
  const model = object(value, "Compose configuration");
  allowKeys(model, ["name", "services", "volumes", "networks"], "");
  if (model.name !== validationProject) throw new Error("Compose configuration has an unexpected project name");
  if (model.networks !== undefined) {
    const networks = object(model.networks, "networks");
    allowKeys(networks, ["default"], "networks.");
    const network = object(networks.default, "networks.default");
    allowKeys(network, ["name", "ipam"], "networks.default.");
    if (network.name !== `${validationProject}_default`) throw new Error("Only the generated Compose default network is allowed");
    if (network.ipam !== undefined) allowKeys(object(network.ipam, "networks.default.ipam"), [], "networks.default.ipam.");
  }
  const volumes = model.volumes === undefined ? {} : object(model.volumes, "volumes");
  for (const [name, volume] of Object.entries(volumes)) {
    const path = `volumes.${name}`;
    const options = object(volume, path);
    allowKeys(options, ["name"], `${path}.`);
    if (options.name !== undefined && options.name !== `${validationProject}_${name}`) {
      throw new Error(`Compose key ${path}.name must use the generated project-local name`);
    }
    delete options.name;
  }

  const services = object(model.services, "services");
  if (Object.keys(services).length === 0) throw new Error("Compose configuration must define at least one service");
  const ports: ComposePort[] = [];
  const variables = new Set<string>();
  const completed = new Set<string>();
  for (const [name, service] of Object.entries(services)) {
    const path = `services.${name}`;
    const config = object(service, path);
    if (model.networks !== undefined && config.networks !== undefined) {
      const networks = object(config.networks, `${path}.networks`);
      allowKeys(networks, ["default"], `${path}.networks.`);
      if (networks.default !== null) throw new Error(`Compose key ${path}.networks must use the generated default network without options`);
      delete config.networks;
    }
    allowKeys(config, serviceKeys, `${path}.`);
    if (config.depends_on !== undefined) {
      for (const [dependency, options] of Object.entries(object(config.depends_on, `${path}.depends_on`))) {
        if (object(options, `${path}.depends_on.${dependency}`).condition === "service_completed_successfully") completed.add(dependency);
      }
    }
    if (config.ports !== undefined) {
      for (const [index, value] of array(config.ports, `${path}.ports`).entries()) {
        const at = `${path}.ports[${index}]`;
        const port = object(value, at);
        allowKeys(port, ["host_ip", "published", "target", "protocol", "mode"], `${at}.`);
        const target = port.target;
        if (port.host_ip !== "127.0.0.1" || (port.published !== undefined && port.published !== "") ||
          (port.protocol !== undefined && port.protocol !== "tcp") || (port.mode !== undefined && port.mode !== "ingress") ||
          typeof target !== "number" || !Number.isInteger(target) || target < 1 || target > 65535) {
          throw new Error(`${at} must publish a TCP port as 127.0.0.1::<port>`);
        }
        const variable = `PECORE_SERVICE_${name.toUpperCase().replaceAll("-", "_")}_${target}`;
        if (variables.has(variable)) throw new Error(`${at} duplicates ${variable}`);
        variables.add(variable);
        ports.push({ service: name, port: target, variable });
      }
    }
    if (config.volumes !== undefined) {
      for (const [index, value] of array(config.volumes, `${path}.volumes`).entries()) {
        const at = `${path}.volumes[${index}]`;
        const mount = object(value, at);
        if (mount.type !== "volume" || typeof mount.source !== "string" || !Object.hasOwn(volumes, mount.source)) {
          throw new Error(`${at} must mount a declared named volume`);
        }
        allowKeys(mount, ["type", "source", "target", "read_only", "volume"], `${at}.`);
      }
    }
  }
  return { services: Object.keys(services), completedServices: [...completed], ports };
}

export async function readComposeFile(
  repoGit: string,
  base: string,
  path: string,
  runtime: Settings["servicesRuntime"],
): Promise<ComposeFile> {
  if (process.platform === "darwin") throw new Error("not supported on macOS yet");
  if (!/^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(base)) throw new Error("Compose base must be a commit hash");
  if (path === "" || isAbsolute(path) || path.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("Compose path must be relative to the repository root");
  }
  const source = await gitApp(repoGit, ["show", `${base}:${path}`]);
  rejectFileReferences(source);
  return withComposeDirectory(runtime, async (directory, compose) => {
    const copy = join(directory, "compose.yaml");
    await writeFile(copy, source, { mode: 0o600 });
    const output = await compose(["--all-resources", "--profile", "*", "-p", validationProject, "-f", copy, "config", "--format", "json", "--no-normalize"]);
    let resolved: unknown;
    try {
      resolved = JSON.parse(output);
    } catch {
      throw new Error("Compose config did not return valid JSON");
    }
    const metadata = inspectCompose(resolved);
    const { services, volumes } = object(resolved, "Compose configuration");
    const bytes: Buffer = Buffer.from(JSON.stringify({ services, volumes }, null, 2) + "\n");
    return { bytes, sha256: createHash("sha256").update(bytes).digest("hex"), ...metadata };
  });
}
