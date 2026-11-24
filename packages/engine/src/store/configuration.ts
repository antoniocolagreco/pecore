import { Accounts, AgentDefinitions, Profiles, Settings, Theme, TierName, Tiers } from "@pecore/schemas";
import type { Account, AgentDefinition, Profile } from "@pecore/schemas";
import type Database from "better-sqlite3";
import type { Global } from "../definitions/load";

type SettingsRow = {
  user_name: string | null;
  job_limit: number | null;
  agent_limit: number;
  services_runtime: Settings["servicesRuntime"];
  min_free_disk_gb: number;
  merge_check_sec: number;
  projects_folder: string;
  protected_mode: number;
  assistant_profile: string | null;
  assistant_compaction_auto: number;
  assistant_compaction_max: number;
  pm_profile: string | null;
  pm_compaction_auto: number;
  pm_compaction_max: number;
};

type AccountRow = {
  id: string;
  kind: Account["kind"];
  provider: string | null;
  connector: string | null;
  login: string | null;
  email: string | null;
  max_parallel: number | null;
  forge: string | null;
  host: string | null;
  tool: string | null;
  user: string | null;
  author_name: string | null;
  author_email: string | null;
  service: string | null;
};

type AgentRow = {
  id: string;
  name: string;
  kind: AgentDefinition["kind"];
  account: string | null;
  model: string | null;
  effort: string | null;
  compaction_auto: number;
  compaction_max: number;
  color: string | null;
  has_color: number;
};

export class Configuration {
  constructor(private readonly db: Database.Database) {}

  read(): Global {
    return { settings: this.settings(), accounts: this.accounts(), profiles: this.profiles(), tiers: this.tiers(), agents: this.agents() };
  }

  settings(): Settings {
    const row: SettingsRow | undefined = this.db.prepare<[], SettingsRow>("SELECT * FROM settings WHERE id = 1").get();
    if (!row) return Settings.parse({});
    const traits: string[] = this.db.prepare<[], string>("SELECT trait FROM assistant_traits ORDER BY position").pluck().all();
    const colors: { harness: string; color: string }[] = this.db.prepare<[], { harness: string; color: string }>("SELECT harness, color FROM harness_colors ORDER BY harness").all();
    const ui: { name: string; value: string }[] = this.db.prepare<[], { name: string; value: string }>("SELECT name, value FROM ui_preferences ORDER BY name").all();
    return Settings.parse({
      user: { name: row.user_name },
      limits: { jobs: row.job_limit, agents: row.agent_limit },
      servicesRuntime: row.services_runtime,
      minFreeDiskGb: row.min_free_disk_gb,
      mergeCheckSec: row.merge_check_sec,
      projectsFolder: row.projects_folder,
      protectedMode: !!row.protected_mode,
      assistant: { profile: row.assistant_profile, compaction: { auto: row.assistant_compaction_auto, max: row.assistant_compaction_max }, traits },
      pm: { profile: row.pm_profile, compaction: { auto: row.pm_compaction_auto, max: row.pm_compaction_max } },
      harnessColors: Object.fromEntries(colors.map(({ harness, color }) => [harness, color])),
      ui: Object.fromEntries(ui.map(({ name, value }) => [name, JSON.parse(value)])),
    });
  }

  accounts(): Accounts {
    const rows: AccountRow[] = this.db.prepare<[], AccountRow>("SELECT * FROM accounts ORDER BY position").all();
    return Accounts.parse({ accounts: rows.map((row) => {
      const { id, kind } = row;
      if (kind === "model") return { id, kind, provider: row.provider, connector: row.connector, login: row.login, email: row.email, maxParallel: row.max_parallel };
      if (kind === "service") return { id, kind, service: row.service, tool: row.tool, user: row.user };
      return { id, kind, forge: row.forge, host: row.host, tool: row.tool, user: row.user, author: { name: row.author_name, email: row.author_email } };
    }) });
  }

  profiles(): Profiles {
    return Profiles.parse({ profiles: this.db.prepare<[], Profile>("SELECT id, account, model, effort FROM profiles ORDER BY position").all() });
  }

  autoSetupProfiles(): Profiles {
    return Profiles.parse({ profiles: this.db.prepare<[], Profile>("SELECT id, account, model, effort FROM auto_setup_profiles ORDER BY position").all() });
  }

  tiers(): Tiers {
    const list: Database.Statement<[string], string> = this.db.prepare<[string], string>("SELECT profile FROM tier_profiles WHERE tier = ? ORDER BY position").pluck();
    return Tiers.parse({ tiers: Object.fromEntries(TierName.options.map((tier) => [tier, list.all(tier)])) });
  }

  agents(): AgentDefinitions {
    const rows: AgentRow[] = this.db.prepare<[], AgentRow>("SELECT * FROM agents ORDER BY position").all();
    const traits: Database.Statement<[string], string> = this.db.prepare<[string], string>("SELECT trait FROM agent_traits WHERE agent = ? ORDER BY position").pluck();
    return AgentDefinitions.parse({ agents: rows.map((row) => {
      const common: Pick<AgentDefinition, "id" | "name" | "model" | "compaction"> = {
        id: row.id, name: row.name,
        model: row.account && row.model ? { account: row.account, model: row.model, effort: row.effort } : null,
        compaction: { auto: row.compaction_auto, max: row.compaction_max },
      };
      if (row.kind === "agent") return { ...common, kind: row.kind, ...(row.has_color ? { color: row.color } : {}) };
      if (row.kind === "pm") return { ...common, kind: row.kind, color: row.color, traits: traits.all(row.id) };
      return { ...common, kind: row.kind, traits: traits.all(row.id) };
    }) });
  }

  themes(): { id: string; theme: Theme }[] {
    const rows: { id: string; name: string }[] = this.db.prepare<[], { id: string; name: string }>("SELECT id, name FROM themes ORDER BY id").all();
    const tokens: Database.Statement<[string], { token: string; color: string }> =
      this.db.prepare("SELECT token, color FROM theme_tokens WHERE theme_id = ? ORDER BY token");
    return rows.map(({ id, name }) => ({ id, theme: Theme.parse({ name, tokens: Object.fromEntries(tokens.all(id).map(({ token, color }) => [token, color])) }) }));
  }

  setTheme(id: string, value: Theme): void {
    this.db.transaction(() => {
      const theme: Theme = Theme.parse(value);
      this.db.prepare("INSERT INTO themes (id, name) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET name = excluded.name").run(id, theme.name);
      this.db.prepare("DELETE FROM theme_tokens WHERE theme_id = ?").run(id);
      const insert: Database.Statement<[string, string, string]> = this.db.prepare("INSERT INTO theme_tokens (theme_id, token, color) VALUES (?, ?, ?)");
      for (const [token, color] of Object.entries(theme.tokens)) if (color !== undefined) insert.run(id, token, color);
    })();
  }

  write(changes: Partial<Global>, setupProfiles?: Profiles): void {
    this.db.transaction(() => {
      if (changes.settings) this.writeSettings(Settings.parse(changes.settings));
      if (changes.accounts) this.writeAccounts(Accounts.parse(changes.accounts));
      if (changes.agents) this.writeAgents(AgentDefinitions.parse(changes.agents));
      if (changes.tiers) this.writeTiers(Tiers.parse(changes.tiers));
      if (changes.profiles) this.writeProfiles("profiles", Profiles.parse(changes.profiles));
      if (setupProfiles) this.writeProfiles("auto_setup_profiles", Profiles.parse(setupProfiles));
    })();
  }

  private writeSettings(value: Settings): void {
    this.db.exec("DELETE FROM settings; DELETE FROM assistant_traits; DELETE FROM harness_colors; DELETE FROM ui_preferences");
    const { user, limits, servicesRuntime, minFreeDiskGb, mergeCheckSec, projectsFolder, protectedMode, assistant, pm, harnessColors, ui } = value;
    this.db.prepare("INSERT INTO settings VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      user.name, limits.jobs, limits.agents, servicesRuntime, minFreeDiskGb, mergeCheckSec, projectsFolder, Number(protectedMode),
      assistant.profile, assistant.compaction.auto, assistant.compaction.max, pm.profile, pm.compaction.auto, pm.compaction.max,
    );
    const trait: Database.Statement<[number, string]> = this.db.prepare("INSERT INTO assistant_traits (position, trait) VALUES (?, ?)");
    for (const [i, value] of assistant.traits.entries()) trait.run(i, value);
    const color: Database.Statement<[string, string]> = this.db.prepare("INSERT INTO harness_colors (harness, color) VALUES (?, ?)");
    for (const [harness, value] of Object.entries(harnessColors)) color.run(harness, value);
    const preference: Database.Statement<[string, string]> = this.db.prepare("INSERT INTO ui_preferences (name, value) VALUES (?, ?)");
    for (const [name, value] of Object.entries(ui)) if (value !== undefined) preference.run(name, JSON.stringify(value));
  }

  private writeAccounts(value: Accounts): void {
    this.db.exec("DELETE FROM accounts");
    const insert: Database.Statement = this.db.prepare(`INSERT INTO accounts
      (id, position, kind, provider, connector, login, email, max_parallel, forge, host, tool, user, author_name, author_email, service)
      VALUES (@id, @position, @kind, @provider, @connector, @login, @email, @maxParallel, @forge, @host, @tool, @user, @authorName, @authorEmail, @service)`);
    for (const [position, account] of value.accounts.entries()) {
      insert.run({
        provider: null, connector: null, login: null, email: null, maxParallel: null,
        forge: null, host: null, tool: null, user: null, authorName: null, authorEmail: null, service: null,
        position, ...account,
        ...(account.kind === "forge" ? { authorName: account.author.name, authorEmail: account.author.email } : {}),
      });
    }
  }

  private writeTiers(value: Tiers): void {
    this.db.exec("DELETE FROM tier_profiles");
    const insert: Database.Statement<[string, number, string]> = this.db.prepare("INSERT INTO tier_profiles (tier, position, profile) VALUES (?, ?, ?)");
    for (const [tier, profiles] of Object.entries(value.tiers)) {
      for (const [i, id] of profiles.entries()) insert.run(tier, i, id);
    }
  }

  private writeProfiles(table: "profiles" | "auto_setup_profiles", value: Profiles): void {
    this.db.exec(`DELETE FROM ${table}`);
    const insert: Database.Statement<[string, number, string, string, string | null]> =
      this.db.prepare(`INSERT INTO ${table} (id, position, account, model, effort) VALUES (?, ?, ?, ?, ?)`);
    for (const [i, profile] of value.profiles.entries()) insert.run(profile.id, i, profile.account, profile.model, profile.effort);
  }

  private writeAgents(value: AgentDefinitions): void {
    this.db.exec("DELETE FROM agents");
    const insert: Database.Statement = this.db.prepare(`INSERT INTO agents
      (id, position, kind, name, account, model, effort, compaction_auto, compaction_max, color, has_color)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const trait: Database.Statement<[string, number, string]> = this.db.prepare("INSERT INTO agent_traits (agent, position, trait) VALUES (?, ?, ?)");
    for (const [i, agent] of value.agents.entries()) {
      insert.run(agent.id, i, agent.kind, agent.name, agent.model?.account ?? null, agent.model?.model ?? null, agent.model?.effort ?? null,
        agent.compaction.auto, agent.compaction.max, "color" in agent ? agent.color ?? null : null, Number("color" in agent && agent.color !== undefined));
      if (agent.kind !== "agent") for (const [position, value] of agent.traits.entries()) trait.run(agent.id, position, value);
    }
  }
}
