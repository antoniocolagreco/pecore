import { Accounts, AgentDefinitions, Profiles, Settings, TierName, Tiers } from "@pecore/schemas";
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
  aws_profile: string | null;
  author_name: string | null;
  author_email: string | null;
  service: string | null;
  site: string | null;
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
  color: string;
  card_id: string | null;
};

export class Configuration {
  constructor(private readonly db: Database.Database) {}

  read(): Global {
    return { settings: this.settings(), accounts: this.accounts(), profiles: this.profiles(), tiers: this.tiers(), agents: this.agents() };
  }

  settings(): Settings {
    const row: SettingsRow | undefined = this.db.prepare<[], SettingsRow>("SELECT * FROM settings WHERE id = 1").get();
    if (!row) return Settings.parse({});
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
      harnessColors: Object.fromEntries(colors.map(({ harness, color }) => [harness, color])),
      ui: Object.fromEntries(ui.map(({ name, value }) => [name, JSON.parse(value)])),
    });
  }

  accounts(): Accounts {
    const rows: AccountRow[] = this.db.prepare<[], AccountRow>("SELECT * FROM accounts ORDER BY position").all();
    return Accounts.parse({ accounts: rows.map((row) => {
      const { id, kind } = row;
      if (kind === "model") return { id, kind, provider: row.provider, connector: row.connector, login: row.login, email: row.email, maxParallel: row.max_parallel };
      if (kind === "service") return { id, kind, service: row.service, tool: row.tool, user: row.user, ...(row.site === null ? {} : { site: row.site }) };
      return { id, kind, forge: row.forge, host: row.host, tool: row.tool, user: row.user, ...(row.aws_profile === null ? {} : { awsProfile: row.aws_profile }), author: { name: row.author_name, email: row.author_email } };
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
    return AgentDefinitions.parse({ agents: rows.map((row) => {
      if (row.kind === "pm") return { id: row.id, name: row.name, kind: row.kind, color: row.color, cardId: row.card_id ?? undefined };
      return {
        id: row.id, name: row.name, kind: row.kind,
        model: row.account && row.model ? { account: row.account, model: row.model, effort: row.effort } : null,
        compaction: { auto: row.compaction_auto, max: row.compaction_max },
        color: row.color,
      };
    }) });
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
    this.db.exec("DELETE FROM settings; DELETE FROM harness_colors; DELETE FROM ui_preferences");
    const { user, limits, servicesRuntime, minFreeDiskGb, mergeCheckSec, projectsFolder, protectedMode, harnessColors, ui } = value;
    this.db.prepare("INSERT INTO settings VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      user.name, limits.jobs, limits.agents, servicesRuntime, minFreeDiskGb, mergeCheckSec, projectsFolder, Number(protectedMode),
    );
    const color: Database.Statement<[string, string]> = this.db.prepare("INSERT INTO harness_colors (harness, color) VALUES (?, ?)");
    for (const [harness, value] of Object.entries(harnessColors)) color.run(harness, value);
    const preference: Database.Statement<[string, string]> = this.db.prepare("INSERT INTO ui_preferences (name, value) VALUES (?, ?)");
    for (const [name, value] of Object.entries(ui)) if (value !== undefined) preference.run(name, JSON.stringify(value));
  }

  private writeAccounts(value: Accounts): void {
    this.db.exec("DELETE FROM accounts");
    const insert: Database.Statement = this.db.prepare(`INSERT INTO accounts
      (id, position, kind, provider, connector, login, email, max_parallel, forge, host, tool, user, author_name, author_email, service, aws_profile, site)
      VALUES (@id, @position, @kind, @provider, @connector, @login, @email, @maxParallel, @forge, @host, @tool, @user, @authorName, @authorEmail, @service, @awsProfile, @site)`);
    for (const [position, account] of value.accounts.entries()) {
      insert.run({
        provider: null, connector: null, login: null, email: null, maxParallel: null,
        forge: null, host: null, tool: null, user: null, authorName: null, authorEmail: null, service: null, site: null,
        position, ...account,
        ...(account.kind === "forge" ? { authorName: account.author.name, authorEmail: account.author.email } : {}),
        awsProfile: account.kind === "forge" ? account.awsProfile ?? null : null,
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
      (id, position, kind, name, account, model, effort, compaction_auto, compaction_max, color, card_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const [i, agent] of value.agents.entries()) {
      if (agent.kind === "pm") insert.run(agent.id, i, agent.kind, agent.name, null, null, null, null, null, agent.color, agent.cardId);
      else insert.run(agent.id, i, agent.kind, agent.name, agent.model?.account ?? null, agent.model?.model ?? null, agent.model?.effort ?? null,
        agent.compaction.auto, agent.compaction.max, agent.color, null);
    }
  }
}
