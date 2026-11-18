import type { AgentNode, Profiles, RecipeNode, Tiers } from "@pecore/schemas";

export type ProfileChoice =
  | { kind: "profile"; profile: string; account: string; model: string; effort: string | null; provider: string }
  | { kind: "wait"; reason: "quota" | "rate_limit"; until: number }
  | { kind: "none"; why: string };

export function candidateProfiles(node: AgentNode, override: RecipeNode["agent"], tiers: Tiers): string[] {
  const agent = { ...node.agent, ...override };
  if (agent.profiles) return agent.profiles;
  if (agent.tier) return tiers.tiers[agent.tier];
  return [];
}

export function pickProfile(p: {
  candidates: string[];
  profiles: Profiles;
  providerOf: (account: string) => string | undefined;
  excludedProviders: Set<string>;
  cooling: (account: string) => { until: number; kind: "quota" | "rate_limit" } | null;
}): ProfileChoice {
  let earliest: { until: number; kind: "quota" | "rate_limit" } | null = null;
  let eligible = 0;
  for (const id of p.candidates) {
    const prof = p.profiles.profiles.find((x) => x.id === id);
    if (!prof) continue;
    const provider = p.providerOf(prof.account);
    if (!provider || p.excludedProviders.has(provider)) continue;
    eligible++;
    const c = p.cooling(prof.account);
    if (c) {
      if (!earliest || c.until < earliest.until) earliest = c;
      continue;
    }
    return { kind: "profile", profile: prof.id, account: prof.account, model: prof.model, effort: prof.effort, provider };
  }
  if (earliest) return { kind: "wait", reason: earliest.kind, until: earliest.until };
  return { kind: "none", why: eligible === 0 ? "no profile of this tier satisfies the node's constraints" : "no profile available" };
}
