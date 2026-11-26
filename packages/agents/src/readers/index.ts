import { claudeCodeReader, genericReader } from "./claude-code";
import type { Reader } from "./claude-code";
import { codexReader } from "./codex";
import { opencodeReader } from "./opencode";
import { piReader } from "./pi";

export function readerFor(name: string | null): Reader {
  if (name === "claude-code") return claudeCodeReader;
  if (name === "codex") return codexReader;
  if (name === "opencode") return opencodeReader;
  if (name === "pi") return piReader;
  return genericReader;
}
