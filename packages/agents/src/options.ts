import { probeSession } from "./login";
import type { Login, ResolvedConnector, Spawn } from "./types";

export async function listOptions(p: { connector: ResolvedConnector; login: Login; spawn: Spawn }): Promise<{ models: string[]; efforts: string[] } | null> {
  const { state, options } = await probeSession(p);
  if (state.state !== "logged_in") return null;
  const values = (category: string) => options.filter((o) => o.category === category).flatMap((o) => (o.options ?? []).map((v) => v.value));
  return { models: values("model"), efforts: values("thought_level") };
}
