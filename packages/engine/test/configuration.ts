import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Accounts, AgentDefinitions, Profiles, Settings, Tiers } from "@pecore/schemas";
import type { Global } from "../src/definitions/load";
import { ChatsDb } from "../src/store/chats-db";
import { Configuration } from "../src/store/configuration";

const schemas = { settings: Settings, accounts: Accounts, profiles: Profiles, tiers: Tiers, agents: AgentDefinitions };

export async function testConfiguration<T>(home: string, fn: (configuration: Configuration) => T): Promise<T> {
  await mkdir(home, { recursive: true });
  const chats: ChatsDb = new ChatsDb(join(home, "chats.db"));
  try {
    return fn(new Configuration(chats.db));
  } finally {
    chats.close();
  }
}

export async function setTestConfiguration(home: string, kind: keyof Global, value: unknown): Promise<void> {
  await testConfiguration(home, (configuration) => configuration.write({ [kind]: schemas[kind].parse(value) }));
}
