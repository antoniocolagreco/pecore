# PeCore: open source software factory for any product type

* **Author:** Antonio Colagreco
* **Date:** 2026-11-17
* **Input:** `docs/pecore-v0.5.md` (1599 lines) checked against the anchored hypothesis below.

## Reviewer Status

| Reviewer | Status |
| --- | --- |
| `egm-design` | completed |
| `egm-codebase-details` | completed |
| `egm-zoom-out` | completed |
| `egm-comprehension` | completed |
| `egm-implementation-readiness` | completed |
| `egm-structural` | completed |

Severity breakdown after deduplication: 8 Blocker, 16 Major, 9 Nit.

## Overview

PeCore takes an order in chat, routes it through a user-built recipe (a graph of agent, check, approval and exit nodes) run by a deterministic engine, and delivers the result for any product type, from a web app bugfix to a multiplatform game.

It runs several harnesses (Claude Code, Codex, Antigravity CLI, opencode, pi, Copilot CLI) and providers (OpenAI, Anthropic, Google, DeepSeek) at once. Budget and concurrency are configuration: it must work with 20 EUR or unlimited money, with parallel jobs bounded by quotas, rate limits and machine resources.

An approver agent classifies hunks by risk. Automatic merge is deferred: for now every job ends with an open PR and the author merges. Today the author is the only user; the project will be published as open source.

Decisions taken after the first review are in "Key Decisions & Staging for Next Steps". Where a finding below conflicts with a decision, the decision wins.

## Analysis

All six lenses reached the same verdict: v0.5 is a coherent design for "one TypeScript repo, ticket to PR, one user, 1 to 3 jobs". It does not yet support the hypothesis, and phase 1 is too large for "finished as soon as possible".

Four problems were raised by every lens:

1. Auto-merge checks whether the code looks risky. Nothing checks that the product works.
2. TypeScript, pnpm and Linux containers are written into engine contracts, so "any product type" has no place to plug in.
3. The subscription token proxy has no terms-of-service position, which blocks a public release.
4. Phase 1 builds a platform before the first useful PR, and the chat entry point waits until phase 2.

The lenses also agree on how to resolve the main tension between speed and generality: define the engine-to-pack boundary now, but ship one pack (TypeScript web) and one runner (OCI on Linux). Then prove the boundary with a second pack that is very different from the first.

Two hypothesis claims do not hold as written:

- "Bounded only by quotas and machine resources" is not true for parallel jobs on one repo. There the real limit is the serialized merge path (B8) and the dependencies between jobs (M13).
- "Budget is pure configuration" is not true either. v0.5 hard-codes a frontier approver and a reviewer from a different provider than the builder (B7).

## Findings

### Blockers

#### B1. Auto-merge checks code risk, not product behaviour
* **Lenses:** all six.
* **v0.5:** §5 (l.201, 249-251, 256), §8 (l.333-336), §25 `auto` node (l.1082), §28 approver context (l.1280), §34 (l.1432), §36 (l.1459).
* **Problem:**
  - The approver receives spec, check results, review verdicts and the diff, then classifies hunks. `auto_approve_if` checks diff size, green checks, a clean review and no `risky` hunk. None of these runs the product.
  - A game that boots to a black screen, with all hunks `safe` and unit tests green, is merged.
  - §8 says "Un'evidenza mancante non diventa mai PASS", but the evidence bundle is phase 2 while `merge: auto` is phase 1, and no threshold reads the evidence. §8 also accepts "review motivata" as evidence, which is a model's opinion, not observed behaviour.
  - Checking hunk by hunk misses risk that comes from several hunks together or from what the diff left out (a missing migration, a deleted call).
  - The hunk model cannot judge binary or generated assets (textures, scenes, Unity YAML).
  - Reviewers are evaluated (§8 l.336), but the approver, the only gate in front of auto-merge, is never evaluated.
  - The `human_approve` view lists hunks, so a human escalation is a code review. That is what the author wants to avoid.
* **Recommendation:**
  - Separate "is the change dangerous" (approver) from "does the product meet the acceptance criteria" (a new deterministic `acceptance` node).
  - The product pack supplies the probes: HTTP smoke tests, Playwright, a headless game boot with frame capture and a non-black check, CLI golden output.
  - `auto_approve_if` must require every acceptance criterion to map to executed evidence on the exact `head_sha`. Review opinions do not count. The validator rejects `merge: auto` without an `acceptance` node upstream.
  - Add deterministic risk floors the approver cannot downgrade: dependency manifests, CI and build config, migrations, auth and secrets paths, deleted tests, asset pipelines.
  - Give the approver its own evaluation set and require a measured false-`safe` rate before auto-merge is allowed.
  - Show evidence first in `human_approve` (screenshots, probe output, test report), then hunks.
  - Until evidence exists, phase 1 ships with `merge: off`.

#### B2. No boundary between the generic engine and per-type packs
* **Lenses:** design, structural, codebase-details, zoom-out, comprehension, implementation-readiness.
* **v0.5:** §1 (l.34, 53), §5 (l.192, 204-206), §7 (l.291-315), §15 (l.483-492), §22 (l.728, 739), §25 checks (l.1039-1049), §26 `ensureImage` (l.1226), §30 (l.1316-1319), §37 (l.1497-1498).
* **Problem:** these TypeScript and Node assumptions are tagged [Decisione] in engine sections:
  - protected ESLint config and `tsconfig.base.json`, plus the `.skip`/`.only` ban;
  - `pnpm install --offline`, and image keys based on a lockfile hash;
  - `factory check` requires `tsconfig.base.json` and checks under 3-5 minutes;
  - check types are a closed enum in `node_runs.type`;
  - `jobs.pr_number` is a column, and `pr` is the only exit.

  Adding a game pack would mean schema migrations and changes to engine prose. Third parties cannot add check or exit kinds.
* **Recommendation:**
  - **Engine:** graph executor, scheduler, evidence model, human queue, approval nodes, plugin APIs and runner interface. It also has a generic `check` node (name, command, diagnostic parser, time budget), a pluggable `exit` with a typed result, and a dependency fingerprint that is not tied to a lockfile.
  - **Pack** (plain data): recipes, roles, check definitions, acceptance probes, protected paths and risk floors, image definition and cache key, required runner capabilities, readiness checklist, KB templates, exit types.
  - Move all TypeScript content from §7, §11 (comment convention), §15 and §30 into a reference pack named `ts-webapp`.
  - Distribute packs by extending `pecore recipe import` (§21 l.675) to `pecore pack add <git-url|path>`, pinned to a commit. Do not build a registry.

#### B3. The runner cannot build or verify games or multiplatform targets
* **Lenses:** implementation-readiness, design, structural, codebase-details, zoom-out.
* **v0.5:** §4 (l.156), §15 (l.466-492), §26 `Runner`/`RunnerSpec` (l.1225-1229), §37 (l.1477).
* **Problem:**
  - The runner is OCI only: rootless Podman, or a Linux VM on macOS. `RunnerSpec` has no resource or device fields.
  - Nothing covers GPU, display or audio, assets of many gigabytes, engine licence activation, or builds that take hours.
  - iOS and macOS targets need Xcode on a macOS host. Windows targets need Windows. Consoles need SDKs under NDA.
  - Linux and macOS are the only supported hosts, although many game developers work on Windows.
* **Recommendation:**
  - Add capabilities to the `Runner` interface: `os`, `arch`, `gpu`, `display`, `memGb`, `diskGb`, maximum wall time.
  - Packs declare the capabilities they require; the scheduler matches them to runners.
  - Plan a host or remote runner (for example a Mac over SSH), or state explicitly that Apple, Windows and console targets are out of scope.
  - Pick the Windows position for the public release: unsupported, WSL2, or planned.

#### B4. Subscription OAuth tokens behind a token-substituting TLS proxy, in unattended parallel automation
* **Lenses:** all six. Blocker for publication; codebase-details rates it Major while the tool is personal only.
* **v0.5:** §10 auth row (l.374), §16 (l.505, 509-520), §25 `accounts.jsonc` (l.964-978), §36 (l.1456, 1461, 1465), App. D (l.1576-1577).
* **Problem:**
  - Placeholder swap and refresh:
    - The proxy swaps a placeholder for the real `claude setup-token` token. This needs a PeCore CA installed in the runner image (l.513).
    - The daemon "rinnova i token che scadono" (l.519). PeCore then acts as an OAuth client of a consumer login.
  - Mounted session files: mode 1b mounts ChatGPT and agy session files into runners.
  - Parallel use: the sample config runs an `anthropic-max` subscription with `maxParallel: 2` in an always-on daemon.
  - The terms are cited but not applied:
    - v0.5 cites "Divieto di OAuth Claude in harness di terze parti" (l.1577) but never says whether this setup complies.
    - §36 treats only the technical risk (a 401 error).
    - No lens could verify current provider terms; this is open, not a conclusion.
  - For a public tool, the default path would put every user's account at risk.
  - Technical risk, unverified: harnesses that pin certificates or ignore the system CA store break under TLS interception.
* **Recommendation:**
  - Before phase 0A ends, write a per-provider, per-harness compliance matrix:
    - columns: subscription vs API key, unattended or not, parallel use, token handling;
    - each row carries a source and a date and is marked [Verificato] or excluded.
  - Make API keys the default for unattended runs and for the public release.
  - Make subscription use an explicit opt-in with a warning. It runs the vendor's harness with the vendor's own login flow, with no header rewriting and no refresh by the daemon, unless the terms allow it.
  - Keep the proxy for egress control and metering. Header substitution applies to API keys only.
  - Add an "account suspension" risk to §36.
  - Record the auth mode in `attempt.started`.
  - Knock-on effect: this weakens the 20 EUR story, because subscriptions are the cheapest path (see B7).

#### B5. No defined first usable version; phase 1 builds a platform before the first useful PR
* **Lenses:** zoom-out (Blocker); design, structural, codebase-details, comprehension, implementation-readiness (Major). Kept as Blocker because the author asked for the finished product as soon as possible.
* **v0.5:** §1 (l.46), §34 (l.1411-1432), §35 0A and 1 (l.1442-1444), §36 (l.1455).
* **Problem:**
  - Phase 0A plus phase 1 require:
    - a threat model and a TLS-intercepting proxy;
    - a PeCore MCP server and an event store with projections;
    - telemetry, and a graph engine with parallel edges, joins and `perSubtask` branch merges;
    - session resume, encrypted secrets with a keychain, reconciliation and takeover;
    - automatic image rebuild, two harnesses, and KB proposals.
  - The §36 mitigation "Flusso completo minimo prima" orders this work but does not shrink it. The "Poi" list puts almost everything back into phase 1.
  - The chat orchestrator, the main entry point in the hypothesis, is phase 2. No phase has a time estimate.
  - The exit criteria test plumbing, not user value.
  - The test project is a throwaway repo with toy issues (l.46), so it cannot show whether the factory saves time.
* **Recommendation:**
  - Define a walking skeleton with a time box and a user-value exit test, for example "N real tickets on a real repo merged, time per ticket measured against the 0B baseline".
  - Candidate cut list from the lenses, for the author to decide:
    - **v1 includes:**
      - a linear graph with back edges and fan-out/join;
      - an `agent` node, a generic `check`, an `acceptance` node, the approver, `auto_approve_if` and `human_approve` from the CLI;
      - the `pr` exit;
      - GitHub Issues and the GitHub forge;
      - one pack;
      - Claude Code plus one other harness for review;
      - an OCI runner behind a CONNECT allowlist proxy, with API keys;
      - concurrency limits, a daily budget cap, and duplicate-safe external effects (`pending_effects`).
    - **v1 defers:**
      - `perSubtask`;
      - optional nodes chosen by the spec writer;
      - the TLS-intercepting proxy;
      - the MCP server for external services;
      - the telemetry database (use raw JSONL logs);
      - full event sourcing (state tables plus an audit table);
      - takeover;
      - KB proposals;
      - tier backup and promotion;
      - the UI and the graphical editor.
  - For chat in v1, expose PeCore as an MCP server (`list_recipes`, `create_job`, `job_status`, `answer_question`, `approve`). The author can then chat from a harness he already uses.
  - Label deferred items "interface reserved".
  - Consider dogfooding on a real repo, possibly PeCore itself. This is possible because config lives in `PECORE_HOME`.

#### B6. The scheduler does not model waiting, rate limits or machine resources
* **Lenses:** implementation-readiness, codebase-details, design, structural, comprehension.
* **v0.5:** §6 (l.272-281), §12 (l.433, 436), §15 (l.484), §22 `quota_leases` (l.817-824), §23 span kinds (l.843), §25 `daemon.jsonc`/`accounts.jsonc`/factory limits (l.969-970, 998-1002, 1053), §27 (l.1241-1262), §1 (l.51).
* **Problem:**
  - Jobs wait in several places, but §27 has no state for any of them. A waiting job sits in `running` with no node running, and `STALLED` ("nessun evento per N minuti", N undefined) can cancel it. The waits are:
    - for quota ("Tier esaurito: il job aspetta");
    - for an image rebuild;
    - for CI;
    - for a concurrency slot;
    - in the merge queue.
  - `quota_leases` is a count with no quantity, window or reset time.
  - There is no event for a 429 or a `retry-after`, and no backoff shared across jobs on the same account.
  - Subscription windows (5 hours, weekly) are not tracked.
  - Most harnesses do not expose remaining quota, so `interactiveReservePct` cannot be enforced.
  - Phase 1 has one profile per tier, so the first quota hit stalls every job.
  - CPU, RAM, disk and GPU are not modelled, although the hypothesis says "bounded by machine resources".
  - `maxJobs`, `maxAgents`, `perProvider`, `maxParallel` and `maxConcurrentJobs` overlap, with no stated precedence.
  - Nothing says whether the orchestrator and check nodes count toward any limit.
* **Recommendation:**
  - Add a wait state (`waiting_resource`, or a node-run `blocked` state) with a typed reason: `quota`, `rate_limit`, `budget`, `concurrency`, `image_rebuild`, `ci`, `merge_queue`.
  - Add events `node.waiting.v1` and `node.resumed.v1`.
  - Waiting releases runners and services.
  - `STALLED` applies only to running attempts.
  - Use one limiter model with named pools: `jobs`, `agents`, `provider:<p>`, `account:<a>`, `runners`, `cpu`, `mem`, `gpu`. A lease takes from several pools atomically.
  - Keep per-account cooldown state and a shared backoff policy, separate from quota exhaustion.
  - Rewrite the non-goal at l.51.

#### B7. The budget model does not work for subscriptions or for a 20 EUR user
* **Lenses:** implementation-readiness (Blocker); design, zoom-out, comprehension, structural, codebase-details (Major). Kept as Blocker because the hypothesis requires 20 EUR to work.
* **v0.5:** §6 (l.273), §8 (l.331, 334), §10 (l.355, 381), §12 (l.433), §22 `cost_usd`/`cost_usd_equivalent`/`usage_daily` (l.768-769, 807-815), §25 policy (l.1167), recipe (l.1068, 1078, 1080), §34 (l.1424-1428), §36 (l.1468).
* **Problem:**
  - The default `feature` recipe cannot run cheaply:
    - It needs a frontier spec writer and a frontier approver ("con un modello frontier. [Decisione]").
    - It needs a code reviewer from a different provider than the builder. That means two provider accounts.
    - A single-provider 20 EUR user cannot run it, and "Tier esaurito: il job aspetta" means waiting forever.
  - The budget has no defined unit or enforcement point:
    - It does not say whether `perJobUsd` and `perDayUsd` count real cost or subscription-equivalent cost.
    - Currency is fixed to USD.
    - There is no `BUDGET_EXCEEDED` reason, and no rule for a budget that runs out mid-attempt.
    - L0 adapters and pi report usage only at the end, so stopping a run mid-attempt is impossible at the harness layer.
  - There is no cost estimate before a job starts.
  - Budget enforcement is not in the phase 1 "Dentro" list.
* **Recommendation:**
  - Downgrade "frontier approver" and "reviewer from a different provider" from [Decisione] to defaults of the predefined recipes.
  - Ship budget presets, for example `single-provider-minimal`, `balanced` and `unlimited`. Each sets tiers, `maxRounds`, optional reviewers and caps.
  - Tie autonomy to budget: an approver profile that has not been evaluated forces `human_approve`.
  - Separate the spend budget (API money, configurable currency) from the quota budget (subscription windows).
  - Meter usage at the proxy, which sees every model request. Reserve an estimate at lease time and settle it at the end.
  - Add the failure reason `BUDGET_EXCEEDED` and a human-queue kind with actions: raise the budget, wait for reset, fail.
  - Add a pre-flight estimate (`pecore budget simulate <recipe>`) to §30. `factory check` rejects recipes that the configured accounts and budget cannot satisfy.

#### B8. Parallel jobs conflict with head_sha invalidation and the serialized merge
* **Lenses:** implementation-readiness and codebase-details (Blocker); design, zoom-out, comprehension (Major).
* **v0.5:** §5 (l.206, 215, 263, 265), §7 (l.303-304), §12 `FORGE_CONFLICT` (l.433), §24 (l.914), §26 `Forge.merge` (l.1221), §25 factory `maxConcurrentJobs: 1` (l.1053).
* **Problem:**
  - Every rebase onto a moved main changes `head_sha`, and "le approvazioni precedenti decadono". With N parallel jobs, each merge invalidates the approver and human approval of every other job. That means repeated frontier cost, repeated prompts to the human, and possible livelock.
  - The merge protocol is undefined:
    - rebase or merge commit;
    - conflict routing (`FORGE_CONFLICT` has no edge);
    - what re-runs after alignment;
    - whether CI runs inside the merge lock.
  - Re-alignment happens inside the `pr` exit, which has only the outcomes `merged` and `open`. It is invisible in `node_runs`.
  - Merge throughput per repo is capped at 1 / (rebase + checks + CI + re-review).
  - The sample `maxConcurrentJobs: 1` hides all of this.
* **Recommendation:**
  - Bind approvals to the job's own patch (`git patch-id` of merge-base..head), not to the tip SHA. A clean rebase with an unchanged patch-id keeps approvals and re-runs only deterministic checks and acceptance probes.
  - Model the merge as a node with outcomes `merged`, `conflict`, `checks_failed`, `ci_failed`, `external_approval_required`, so recipes can route each one.
  - Write the merge protocol step by step.
  - Add a phase 1 exit test: two jobs that touch the same file.

### Major

#### M1. §1 and the scope statements contradict the hypothesis
* **Lenses:** structural (Blocker); comprehension, zoom-out, codebase-details, design (Nit or Major).
* **v0.5:** l.5 "software factory personale", §1 (l.34, 50-54), §3 "Factory = Repo + ..." (l.95), §5 "Una PR per job" (l.262), §37 (l.1475).
* **Problem:**
  - The non-goals exclude what the hypothesis now requires: 1 to 3 jobs, no work unrelated to code, stop at merge.
  - Every other section inherits this framing.
* **Recommendation:**
  - Rewrite §1 first: problem, users (author now, public later), measurable goals.
  - Split non-goals into "never" and "not in v1".
  - Decide whether "deliver the result" for a game includes release artifacts. If it does, an `artifact` exit is needed.

#### M2. Tests written before code have no route back when the tests are wrong
* **Lenses:** design and codebase-details (Blocker); zoom-out, comprehension, implementation-readiness, structural (Major). Rated Major because `maxRounds` bounds the loop. The job wastes rounds and then escalates to a human; it does not hang.
* **v0.5:** §5 (l.215, 245-248), §7 (l.291, 317-321), §25 edges (l.1090, 1096-1105), §28 (l.1276, 1284-1301).
* **Problem:**
  - Every check failure routes to `code`. The builder cannot touch tests, and `diff_guard` enforces this.
  - The only edge into `tests` is `review: changes_tests`, and review runs only after `test: passed`. A test with a wrong import, a guessed signature, a lint or format error, or a wrong assertion can therefore never reach `tests`. Up to 6 to 10 back edges into `code`, each with `maxRounds: 3`, can burn many rounds before escalation.
  - Other gaps:
    - The builder cannot add fixtures.
    - A builder that runs prettier on `.` fails `diff_guard`.
    - Test-file conflicts in subtask merges also fail `diff_guard`.
    - The spec format has no interface section shared by tests and builder.
    - l.246 forbids "i test" while l.291 forbids only the tests node's tests, so it is unclear who updates existing tests.
    - Row l.1276 does not list repo access for the tests node, although the runner receives a repo copy (l.140).
* **Recommendation:**
  - Run format, lint and typecheck on the tests node's output right after `tests` (a red-phase gate), routing failures back to `tests`.
  - Attribute check failures by file ownership (files changed by the tests node's commit).
  - Add a builder outcome `tests_disputed`, with evidence, routed to `tests`.
  - Add an "Interfaces" section to the spec format.
  - Give the tests node read-only repo access explicitly.
  - Make "tests first" a property of the recipe, not an engine assumption. It does not suit rendering or gameplay work.

#### M3. Graph semantics are not complete enough to implement a deterministic engine
* **Lenses:** all six.
* **v0.5:** §5 (l.210-217, 247, 255), §22 (l.710, 736, 742-743), §24 (l.903-904), §25 (l.1087-1120, 1140), §27, §29 (l.1310), §38 Q5 (l.1523).
* **Problem:**
  - **Joins:**
    - `approve` has two incoming edges, from `review` and from the optional `security`. It is undefined whether it runs once or twice, and whether a skipped node satisfies the join.
    - "vince la freccia all'indietro" does not choose between `changes_tests → tests` and `changes_code → code`.
  - **maxRounds:**
    - It is unclear whether the cap counts per edge, per node or per job. The sample has 10 back edges into `code`.
    - `human → code` has no cap (Q5).
    - Round-limit escalation has no human actions.
  - **Outcomes and terminal states:**
    - Reviewer outcomes are `approve`/`changes` (l.1140) vs `changes_code`/`changes_tests` (l.1104-1106).
    - `done` is declared nowhere.
    - The approver's outcome is `done` in the recipe (l.1109), but `'safe'` in the `node_runs` example (l.743).
    - A failed `diff_guard` "passa all'utente" (l.247), but `guard:failed` has no edge and closes the job (l.1120).
    - Reject means the job "viene cancellato" (l.255), yet an outcome without an edge ends the job as `completed` (§27).
    - It is unclear when a node emits `node.completed` with a `failed` outcome and when it emits `node.failed`.
  - **perSubtask:**
    - Parallel runs share the id `<job>/<node>#<round>` (l.736). The primary key collides.
    - No table or event carries a subtask id.
    - The merge of subtask branches has no node, event or span.
    - Nothing says which subtask's builder receives a check log.
  - **State machines:**
    - There is no node_run state machine, although `node_runs.state` lists 7 states.
    - Takeover is allowed only from `running`, not from `waiting_human`.
    - `human.takeover_returned` has no "resume node" field.
  - **Size limit:** a `diff_guard` size failure ends the job with no route back to the spec writer for re-splitting.
* **Recommendation:**
  - Write a normative graph-semantics section:
    - AND-join over the predecessors activated in the round, with skipped counting as done;
    - a deterministic priority between diverging back edges;
    - a per-target-node round counter plus a per-job cap;
    - one table mapping each outcome without an edge to a terminal state;
    - the node_run and job state machines;
    - a subtask id in node-run ids, tables and events;
    - an explicit `subtask_merge` node.
  - Property-test the rules with fast-check, which is already in the §20 stack.

#### M4. The human-interaction contract is incomplete
* **Lenses:** comprehension (Blocker), codebase-details, implementation-readiness.
* **v0.5:** §5 (l.202, 212, 247, 252-255), §18 (l.564, 567), §22 `human_queue` (l.776-788), §25 (l.1115), §27, §31 (l.1337), §32 (l.1361).
* **Problem:** "No code review" depends on a precise human contract, and today it is incomplete:
  - `round_limit` has no actions: grant more rounds, raise the tier, take over, fail.
  - `expired` has no rule and no event.
  - Nothing says whether a job waiting for a human keeps its concurrency slot. Three unanswered questions with `maxJobs: 3` stop the factory.
  - "Request changes" routes only to the builder, not to tests or the spec writer.
  - `human_queue` has no `node_run_id`, so answers cannot be routed in parallel graphs.
  - The same action is named `changes` and `request_changes` in different places.
  - "Cancellare" means cancel, delete and reject in different places.
  - "Escalation" is not a defined kind.
* **Recommendation:**
  - Write one table per `human_queue.kind`: question, human_approve, round_limit, guard_failed, budget, auth. For each, list what the user sees, the allowed actions with their CLI, API and UI names, where each action routes, the timeout and default, and whether slots and leases are released while waiting.
  - Use one action enum.
  - Use distinct words for cancel, delete and reject.

#### M5. Observability cannot answer "why is this job not moving"
* **Lenses:** codebase-details, implementation-readiness, comprehension, design.
* **v0.5:** §12 (l.433-436), §13 (l.441, 453), §19 (l.586), §23 (l.843, 865-870), §24, §31-32.
* **Problem:**
  - No blocking reason is visible in the API, CLI or events.
  - The failure reasons lack budget, rate limit, runner or OOM errors, image build failures, invalid structured output, CI failures, round limit, daemon restart and network denial. All of these collapse into `HARNESS_ERROR` or `STALLED`.
  - The two-phase effect rule (§12) has no `*.failed` events for push, PR, merge or writeback, and `close_pr`/`comment` have no events.
  - No metric names are defined.
  - `STALLED` relies on harness events, which live in telemetry, against "Il motore non legge mai la telemetria". It also misfires on L0/L1 adapters and on pi, which emit nothing until the end.
  - Check nodes have no heartbeat.
  - The "accesso a `~/.ssh`" alarm has no detection mechanism.
  - In phase 1 the CLI is the only diagnostic surface.
* **Recommendation:**
  - Add a blocking-reason projection, `pecore job why <id>` and `GET /api/jobs/:id/blockers`.
  - Complete the reasons and the requested/completed/failed event triples.
  - Define a liveness channel the engine may read: proxy request timestamps plus process status, with timeouts per adapter level.
  - Define a minimum metric set: per-account 429s and latency at the proxy, lease wait, queue depth, runner CPU/RAM/OOM, rounds per job, auto-merge rate, and the post-merge revert rate (the only real quality signal for "no code review").
  - Make "diagnose a stuck job from the CLI in under a minute" a phase 1 exit criterion.

#### M6. Data model gaps for chat jobs and orchestrator cost
* **Lenses:** codebase-details, structural.
* **v0.5:** §5 (l.181), §17 (l.557), §21 (l.622), §22 `jobs` (l.719-720), `attempts` (l.751), `quota_leases` (l.821), §24 (l.896-897, 953), §33 (l.1390).
* **Problem:**
  - Chat requests "non sono una source", but `jobs.source_id` and `jobs.external_id` are `NOT NULL`, and `sources/chat/` exists in §33.
  - The orchestrator "gira nel runner come ogni agente", but `attempts.job_id` and `quota_leases.attempt_id` are `NOT NULL`. Intake cost has nowhere to go and is outside the budget.
  - Chat storage is mentioned (l.622), but no table is defined.
  - Event payloads may not hold untrusted content (l.953), yet `chat.message_posted` carries text and attachments.
* **Recommendation:**
  - Add a built-in `chat` pseudo-source, or `conversation_id` on `jobs`.
  - Generalize the owner of an attempt (`job_node | conversation | maintenance`) and count every attempt in `usage_daily` and budgets.
  - Store chat content as erasable artifacts referenced from events.

#### M7. Builder session resume conflicts with ephemeral runners and a clean home
* **Lenses:** implementation-readiness, design, structural.
* **v0.5:** §2 principle 7 (l.64), §4 (l.138, 144), §5 (l.264), §22 `session_id` (l.760).
* **Problem:**
  - Harness session state lives in the home directory, which is destroyed with the runner.
  - Principle 7 limits resume to the builder, but l.264 applies it to every agent node.
* **Recommendation:**
  - Specify a session volume per (job, node, subtask) under `data/`, with cleanup and invalidation on a harness or model change.
  - Measure whether resume beats a fresh session with a summary, since prompt caches expire during long check runs.

#### M8. Plugin and pack trust, versioning and portability
* **Lenses:** design, structural, codebase-details, zoom-out, comprehension, implementation-readiness.
* **v0.5:** §4 (l.128), §10 (l.347-359), §21 (l.675), §25 (l.961, 1070, 1142-1160), §26, §33 (l.1387-1400), §28 (l.1296).
* **Problem:**
  - Plugins run inside the control plane, the trusted part that holds `secrets.enc` and forge credentials. Manifests declare host commands and map secrets into env. `recipe import <url>` brings in check commands. There is no trust, signing or isolation model.
  - `HarnessAdapter` and `NormalizedEvent` have no API version.
  - Recipes, factories and the daemon config have no `formatVersion`.
  - Recipes reference profile ids that exist only on the author's machine (l.1070), so imported recipes do not resolve.
  - `$schema` points to `pecore.local`.
* **Recommendation:**
  - By default, third-party extensions are declarative only (manifests plus packs); their commands run in a runner, not on the host. Code plugins run out of process without secrets, need explicit trust and are pinned by hash.
  - Add `engineRange` and `formatVersion`.
  - Recipes reference tiers or capabilities; profiles are resolved locally.
  - Publish the schemas or reference them by relative path.

#### M9. Open source prerequisites and first-run path are missing
* **Lenses:** comprehension (Blocker for first run); design, structural, zoom-out, codebase-details, implementation-readiness.
* **v0.5:** §4 (l.150, 156), §15 (l.487), §16 (l.497, 504), §20 (l.611), §21 (l.664), §25, §30 (l.1316-1323), §31 (l.1327-1343), §37 (l.1477).
* **Problem:**
  - **License:** PeCore has none. §16 covers only other projects' licenses.
  - **Install and setup:**
    - There is no install method, prerequisite list, `pecore init`, `account add` or `factory create`. Every config file is written by hand.
    - GitHub credentials have no config entry.
    - `<work-item-ref>` is undefined.
    - It is unclear whether harness CLIs live on the host or in the image.
  - **Branch protection:** §30 requires it, yet `merge: auto` stops at `pr:open` if reviews are required, and nothing explains why.
  - **Secrets:** on headless Linux, `secret-tool` needs a running Secret Service.
  - **Images:** prebuilt images with proprietary harnesses may breach those harnesses' licenses (unverified).
  - **Language:** the documents and role prompts are Italian only.
  - **Untrusted input:** on a public repo, a stranger's issue labelled `factory` is a path from untrusted text to main.
* **Recommendation:**
  - Choose a license; Apache-2.0 fits the stated reuse of Herdr.
  - Add a "First run" section: install, then `pecore init` (prerequisite checks, auth mode, budget preset), then `pecore doctor`, then `pecore factory create --pack`, then the first job.
  - Add a headless secret fallback.
  - Build images locally only.
  - Allow auto-merge only for work items from allow-listed authors.
  - Set a language policy for docs, prompts and UI.

#### M10. Event store evolution and config migration are unresolved
* **Lenses:** implementation-readiness, structural.
* **v0.5:** §13 (l.448), §14 (l.462), §18 (l.564), §21 git sync (l.668-675), §22 (l.683, 831), §24 (l.929), §38 Q12 (l.1525).
* **Problem:**
  - Events are kept forever, and upcasting is described in one word.
  - Projections are rebuilt by full replay, with no snapshots.
  - Nothing says whether a running job uses a frozen config snapshot or the live files.
  - `PECORE_HOME` is a git repo synced across machines, so migrations must be committed.
* **Recommendation:**
  - Snapshot the resolved recipe, roles and policy at `job.created` and run from that snapshot.
  - Add `schemaVersion` to every file and an idempotent `pecore migrate`.
  - The daemon refuses to start on unmigrated config.
  - Write an upcaster retirement policy.
  - Move Q12 to the prerequisites for freezing the spec.

#### M11. One daemon process carries the proxy, synchronous SQLite and telemetry
* **Lenses:** design, codebase-details.
* **v0.5:** §4 (l.124-134, 150), §12 (l.435), §13 (l.447), §20 (l.606).
* **Problem:**
  - Synchronous `better-sqlite3` writes ("Migliaia per attempt") share the event loop with the TLS proxy, the API and WebSocket, the scheduler and stall detection.
  - Under parallel load this adds latency and false `STALLED` results.
  - A daemon restart cuts every model stream.
* **Recommendation:**
  - Run the proxy as a separate supervised process.
  - Batch telemetry writes off the main loop.
  - Define restart behaviour for each attempt: resume, or fail with `DAEMON_RESTART`.

#### M12. Disk and per-attempt repo copies do not scale to large repos
* **Lenses:** design.
* **v0.5:** §4 (l.140), §15 (l.483-492), §21 (l.665), §22 (l.831).
* **Problem:**
  - Each attempt gets a full repo copy plus sidecar services.
  - Images are rebuilt on lockfile changes, with no garbage collection.
  - Game repos and images of tens of gigabytes will exhaust the disk.
* **Recommendation:**
  - Use copy-on-write clones.
  - Add garbage collection and disk quotas for images, artifacts and logs.
  - Packs declare disk needs, and the scheduler admits work against them (B6).

#### M13. A chat order for a whole product does not fit "one job = one PR"
* **Lenses:** design, zoom-out, comprehension.
* **v0.5:** §3 (l.95), §5 (l.175-176, 215, 241, 262), §30 (l.1316-1321).
* **Problem:**
  - A game is a backlog of dependent tickets merged over days. Jobs cannot depend on each other, and nothing stores a plan.
  - "Ticket: lo scrive l'utente, già con le specifiche" (l.241) contradicts an order given in chat.
  - A new product cannot pass the readiness checklist, which requires checks green on main and an image built from a lockfile. No recipe creates a repo or scaffolds it.
* **Recommendation:**
  - Add a planning recipe whose exit is a set of tickets with `dependsOn`. The engine, not the LLM, schedules them in dependency order.
  - Add a `bootstrap` recipe per pack (repo, scaffold, checks, first image) that is exempt from the readiness check until it finishes.
  - Both can come after v1; state in §1 that v1 handles work the size of a ticket.

#### M14. The engine depends on specific role names
* **Lenses:** structural.
* **v0.5:** §5 (l.214-217), §28 (l.1268).
* **Problem:**
  - Validation and execution assume three things: an approver comes before `auto_approve_if`, only the spec writer activates optional nodes, and spec-writer output drives `perSubtask`.
  - Packs that bring their own roles break these assumptions.
* **Recommendation:** express these dependencies as typed artifacts (`RiskAssessment`, `SubtaskPlan`, `OptionalNodeSelection`) with declared producers and consumers, and validate the graph on those types.

#### M15. Document structure is not ready to become a spec and a plan
* **Lenses:** structural, design, comprehension.
* **v0.5:** l.7-18, l.596, §10 (l.361-374), §20 (l.603-612), §34-§38, App. A-C.
* **Problem:**
  - **Layout:**
    - Part I carries the normative decisions, while Part II is [Proposta] by default.
    - Phase notes are spread over about ten sections.
    - There are no requirement IDs.
    - There is no architecture-level alternatives section, which the feature-spec standard requires. App. B covers formats only.
  - **Tags vs §37:**
    - Sections tagged [Proposta] are listed as decided in §37: §16 auth, §21 sharing, §11 handbook, `perSubtask`, `secret_scan`.
    - §20 cites "Decisione" as its own reason.
    - §10 is tagged [Verificato] but contains "da verificare" cells.
  - **Duplicated content:** the reference recipe is described twice and the versions differ (M3).
  - **Glossary (§C):** it defines 7 terms and misses MCP, OCI, PWA, ULID, WAL, CloudEvents, "giro" and others. "Nightly build" does not match §7.
  - **Overloaded terms:**
    - "Factory" means both the product and a per-repo config.
    - Source and "sorgenti" are different things.
    - Handbook, knowledge base and kb are three names for one store.
    - Policy lives in three places.
    - Takeover has three names.
    - Binding has no file and no field.
* **Recommendation:**
  - Split into three documents:
    - **Spec** (normative, no phases): context, engine contracts, pack contract with `ts-webapp` as the reference, and a game sketch used only to test the contract.
    - **Work plan:** requirement ID → phase → exit criterion, with estimates.
    - **ADR decision log**, replacing §37.
  - Tag status at statement level, with a default status per part.
  - Keep one definition of each enum, generated from Zod.
  - Use one term per concept and complete the glossary.

#### M16. Six harness adapters are not needed for four providers, and harness facts sit in the spec
* **Lenses:** zoom-out, structural, design.
* **v0.5:** §1 (l.38), §3 (l.78), §10 (l.361-384), §12 (l.436), §25 (l.967), §33 (l.1393-1400).
* **Problem:**
  - Separate harnesses matter mainly for subscriptions: Claude only in Claude Code, ChatGPT only in Codex. With API keys, opencode or pi reach several providers via `provider/model`; whether they cover all four is unverified.
  - DeepSeek appears nowhere in v0.5.
  - The quirk table in §10 will go stale every month.
  - Context files from the project repo (AGENTS.md, CLAUDE.md, GEMINI.md) reach the agent according to each harness's own lookup rules.
* **Recommendation:**
  - v1: Claude Code, Codex, and opencode or pi for Google and DeepSeek.
  - Defer agy and Copilot CLI.
  - Before writing six adapters, check whether ACP (Zed) or AgentAPI (Coder) already normalize these CLIs (unverified).
  - Keep harness facts in manifests plus conformance fixtures.
  - Add a `context_isolation` capability, using `--no-context-files` or `--no-custom-instructions` where they exist.
  - Add a per-factory list of allowed providers, to keep code away from chosen providers or jurisdictions.

### Nit

#### N1. Name spelling
* **Lenses:** all six.
* **v0.5:** l.25, l.34, §37 l.1475 and others.
* **Problem:** "peCore" appears 43 times, "PeCore" only twice (l.1, l.5), and the §37 decision row records "peCore". "Pipeline Engine core" appears only in §37.
* **Recommendation:**
  - Use "PeCore" in prose, and keep lowercase `pecore` for the command, packages and `PECORE_HOME`. State this rule in the front matter.
  - Keep or drop the backronym explicitly.

#### N2. `secret_scan` uses a model, so it is not a deterministic check
* **Lenses:** codebase-details (Major), design.
* **v0.5:** §2 principle 4 (l.61), §3 (l.98), §7 (l.292).
* **Recommendation:** wrap a rule-based scanner (gitleaks class) as a check, and make any model pass an agent node.

#### N3. The default recipe uses a node that phase 1 excludes
* **Lenses:** implementation-readiness, codebase-details, structural.
* **v0.5:** §7 l.306 vs §25 l.1041, 1072.
* **Recommendation:** ship a phase 1 variant of the recipe without `secrets`.

#### N4. The orchestrator can fan out cost from untrusted input
* **Lenses:** design (Major). Downgraded because v1 can cap it with config.
* **v0.5:** §5 (l.175-181), §16 (l.505).
* **Recommendation:**
  - Route deterministically first (label to recipe), with the LLM as fallback.
  - Cap jobs per message and subtasks per job.
  - Require confirmation above a cost estimate.

#### N5. Unpinned check tools
* **Lenses:** implementation-readiness.
* **v0.5:** §7 (l.301, 312), §25 (l.1042-1046).
* **Problem:** an agent can change `package.json` and so the version of the tools that run the checks.
* **Recommendation:** pin check tools in the image or the pack.

#### N6. A model fallback can break `providerDiffersFrom`
* **Lenses:** implementation-readiness, design.
* **v0.5:** §6 (l.275), §25 (l.1078).
* **Recommendation:**
  - Re-resolve constraints after a fallback.
  - `providerDiffersFrom` should name a set of providers.

#### N7. Telemetry vocabulary drift
* **Lenses:** codebase-details.
* **v0.5:** §23 (l.843, 858, 884, 888), §24 (l.906), §26 (l.1195-1202).
* **Problem:**
  - `log_index.type` and `NormalizedEvent` use different names.
  - Span kinds say `tool`, while the hierarchy says `tool.call`.
  - `attempt.started` carries a `session_id` the harness reports only later.
  - `TRACEPARENT` has no documented consumer.

#### N8. Opaque Italian names and leftover terms
* **Lenses:** comprehension, structural.
* **v0.5:** §3 (l.97, 103), §5 (l.169), §19, §32 (l.1350).
* **Recommendation:**
  - Name the module "notifications" in code and config, and keep the sheep names as a sound theme only.
  - Replace "blocchi" and "step" with "nodo".
  - Replace "PIN di Jira" with "chiave del ticket".
  - Pair every sound with a text equivalent.

#### N9. Phase 1 intake trigger is undefined
* **Lenses:** structural.
* **v0.5:** §5 (l.179), §17 (l.552), §31 (l.1334).
* **Problem:** without the orchestrator, nothing says who calls `SourceAdapter.list()`.

## Goals vs. Non-Goals

* **In-Scope Goals:**
  - The whole product described in v0.5 plus the decisions below. There is no reduced v1: phases are only the build order.
  - An engine that knows no programming language. Rust, Go, TypeScript and others are supported through nodes, not engine code.
  - Every node type (agent, check, approval, exit) is a definition written as data. The user creates nodes on demand with the help of AI and uses them immediately.
  - Recipes hold every rule: checks, reviews, what re-runs after a rebase, providers, tiers. Nothing is hard-coded in the engine. The empty recipe is valid.
  - Original harnesses (`claude -p`, `codex exec`, `agy -p`, `opencode run`, `pi -p`, `copilot -p`) with their own login and subscription.
  - Several providers used at the same time.
  - Several jobs in parallel, bounded by configured limits.
  - Host systems: Linux and macOS.
  - Products for Linux and macOS.
  - Open source release.
* **Out-of-Scope Non-Goals (for now):**
  - Automatic merge. Every job ends with an open PR.
  - Windows, as host and as product target.
  - iOS, Android and console targets.

## Alternatives Weighed

The lenses raised these options. None has been accepted or rejected by the author yet. Facts about outside tools are unverified.

* **Durable workflow engines (Temporal, Restate, DBOS):**
  - Would replace the custom event store and reconciliation.
  - Lenses judged them likely too heavy for a single-user SQLite daemon, but the spec needs a written decision.
  - LangGraph.js already models cyclic graphs with checkpoints.
  - The custom engine is small, so building it is acceptable.
* **Full event sourcing vs state tables plus an append-only audit table (v1):**
  - The audit table is cheaper.
  - Keep `pending_effects` either way: it is what prevents duplicate PRs.
* **TLS-intercepting token proxy vs a plain CONNECT allowlist proxy (Squid, tinyproxy) with API keys:**
  - The CONNECT proxy avoids the CA, the certificate-pinning risk and the terms question.
* **Custom telemetry DB vs raw JSONL logs plus usage per attempt (v1):**
  - App. B's reasons for not using the OpenTelemetry SDK still hold.
  - The DB has no metric catalog yet.
* **Six harness adapters vs one multi-provider harness plus ACP or AgentAPI normalization:**
  - Fewer adapters to maintain.
  - Subscriptions still require vendor harnesses.
* **LLM gateway (LiteLLM proxy mode) for budget and rate limits vs metering in the PeCore proxy.**
* **React UI and graphical editor vs PeCore as an MCP server, used from an existing harness for chat, with validated JSONC plus a Mermaid render for recipes.**
* **Existing issue-to-PR tools (Copilot coding agent, Codex cloud, Claude Code GitHub Action, OpenHands, Vibe Kanban):**
  - Each covers one provider, or acts as a cockpit where the user steers.
  - PeCore's differences are:
    - routing across providers;
    - deterministic gates;
    - auto-merge gated on acceptance evidence;
    - offline runners.
  - App. A should state this and compare them.
* **Smaller reuse:**
  - devcontainer CLI for images (already hinted at l.492);
  - gitleaks or trufflehog for secrets;
  - ntfy or Apprise for external notification channels;
  - `gh` or Octokit for the forge.
* **Test project:**
  - The throwaway repo, a [Decisione] at l.46, vs a real repo or PeCore itself.
  - A real repo measures real value, but PeCore itself risks a factory that modifies itself.

## Key Decisions & Staging for Next Steps

### Decided by the author (2026-11-17)

| # | Decision | Effect on findings |
| --- | --- | --- |
| D1 | No reduced v1. The goal is the whole software; phases are only the build order. | B5 cut list rejected. The plan covers the full product. |
| D2 | Automatic merge is deferred. Every job ends with an open PR; the author merges. | B1 no longer blocks. Acceptance evidence is needed only when auto-merge returns. |
| D3 | The engine knows no programming language. Every node type is a definition written as data, created on demand with AI and used immediately. | Resolves B2 in favour of data-defined nodes. Replaces the closed list of check types. |
| D4 | PeCore runs the original harnesses with their own login and subscription. | B4 drops from Blocker. Anthropic's support page states that `claude -p` with a plan login uses the plan limits. Still to check: the v0.5 proxy that swaps the token (§16, 1a). |
| D5 | Hosts and product targets: Linux and macOS. No Windows. | B3 narrowed. Building macOS products needs a native macOS runner, because the Linux container on macOS cannot run Xcode. |
| D6 | After a rebase onto main, the recipe decides what runs again (for example all deterministic checks and the code review). Not hard-coded. | B8: re-run rules become recipe configuration. |
| D7 | The minimal recipe is empty: it starts and does nothing. No provider, tier or reviewer is mandatory. | B7: "frontier approver" and "reviewer from a different provider" become defaults of the shipped recipes. |
| D8 | License: MIT. Anyone may use, modify, sell and close the code; the only obligation is keeping the copyright notice. | No code from Herdr or zazencodes is needed, so no license constraint from them. §16 license note becomes ideas-only for both. |
| D9 | Agents run on the host, not in containers. Each project picks from a dropdown the OS user its agents run as: the author's own user (marked risky: agents can read the author's credentials) or a dedicated user. A dedicated user is created automatically after one admin permission prompt, or through a guided procedure that shows the commands. | Replaces the OCI runner, token proxy and runner images (§4, §15, §16). Creation also installs a sudo rule that lets the daemon run processes only as that user, and the harness logins for that user. Containers remain only for job services (Postgres, Kafka). Lost: network level per node. macOS products build natively. |
| D10 | A project is one repo on one forge plus one forge account. Example: `progetto-1` → `github.com/pappa/pippo` with `account-1`; `progetto-2` → `github.com/gino/pallino` with `account-2`; `progetto-3` → `gitlab.com/ciccio/pimpo` with `account-3`. Settings hold several named forge accounts, each with forge type (GitHub, GitLab), host (also self-hosted), auth type, secret reference and commit author. Agents never receive these credentials: the daemon pushes and opens PRs or MRs. | Extends `accounts.jsonc` (§25) with `kind: "forge"`; adds `account` to `repo` in the project config. The `Forge` interface (§26) gets a GitLab adapter, and the `pr` exit becomes forge-neutral (PR on GitHub, MR on GitLab). Validation rejects a project whose account belongs to a different forge or host. |
| D11 | Each project has one main directory holding its own clone of the remote repo and several workdirs, one per running job or subtask. Proposed layout: `$PECORE_HOME/projects/<id>/` with `project.jsonc`, `knowledge/`, `repo.git` (bare clone) and `work/<job-id>[-<subtask>]/` (git worktrees on `factory/*` branches). Location of the main directory configurable; default inside `PECORE_HOME`, separate from the user's own checkout. | Replaces `factories/<id>/` and `data/mirrors/` (§21) and the per-attempt repo copy (§4, §15). A workdir is created at job start and removed when the job ends; kept on failure or takeover. |
| D13 | Delivery target is agnostic: GitHub, GitLab, Bitbucket, AWS CodeCommit, a private git server, or the local repo only. Every operation on code or the outside world is a node; push and PR/MR are nodes. Nodes are created by hand or with AI, which can also correct or modify them. | The engine has no forge concept. Forge-specific behaviour lives in node definitions. |
| D14 | Definitions are plain JSON validated by JSON Schema (generated from Zod), not JSONC. | Comments move to `description` fields. Replaces v0.5 §14 JSONC rule and the `jsonc-parser` dependency. |
| D15 | Workdirs and job branches are engine operations, invisible to recipes: created when a job or subtask needs them, removed when it ends. | Not nodes. |
| D16 | Commit is a node (the save action). A recipe can put a human review before it. | Before the commit node, work exists only as uncommitted files in the workdir. Check results must be bound to the content state (git tree hash), not only to a commit SHA. |
| D17 | Realignment onto the parent branch or main is a node, because conflicts need an agent. | The recipe declares which node the job re-enters when its base moves. |
| D18 | Projects are atomic: one directory holds the project's definitions, its own `events.db`, artifacts and logs. Global state is only accounts, secrets, daemon config and orchestrator chats. Quota and concurrency state is in memory, rebuilt after restart. | SQLite option B: one database per project, no cross-file transactions. `pecore project export` shares a project without secrets, clone or workdirs. |
| D19 | Templates live in a global library. Instantiating a template copies it into the project, where it is customised. No link between template and instance: changing a template never changes instances. | None on existing instances. |
| D20 | If a project's remote repo does not exist, PeCore creates it automatically with the project's account. | Repo creation is a forge-specific node template. |
| D21 | Recipes follow the same template and instance model as nodes (D19). | |
| D22 | The container runtime for job services is a setting. | No runtime is hard-coded. |
| D23 | PeCore is an Electron desktop app: download, open, it runs. Everything lives inside the app; closing it stops the engine and every harness process. | Replaces the always-on daemon with systemd or LaunchAgent (v0.5 §4). The engine runs in a Node process owned by the app. The CLI works only while the app is open. Jobs interrupted by closing the app need a defined behaviour on next start. |
| D24 | Controls: global pause and play; per job stop, pause, play, delete. On app start, jobs interrupted by closing are paused until the user presses play (assumption from these controls). The UI is otherwise not designed yet. | Pause semantics for a running harness to be decided. |
| D25 | Closing the app or pressing stop kills everything at once. Pause (app open) waits for running nodes to finish, then holds. A job can be deleted only when stopped, whether completed or not. Deleting a job removes all its resources, workdirs included; nothing of the project is lost. A project contains its jobs (tasks). | Replaces D24's open point on pause. |
| D26 | Deleting a job removes everything: workdirs, artifacts, logs, local branch, remote branch, open PR/MR, and its history in the project database. To keep a job instead, the user archives it: hidden from the active list, history, branches and PR/MR kept, workdirs freed (assumption). | Remote cleanup depends on the forge, so delivery node templates declare a cleanup command (for example close PR and delete remote branch). |
| D27 | PeCore keeps no secrets file. Harnesses, forge CLIs (`gh`, `glab`, AWS CLI) and git credential helpers keep their own logins; `accounts.json` stores only references. Credentials no tool stores go to the OS keychain via Electron `safeStorage`. | Removes `secrets.enc` and the custom encryption (v0.5 §16, §21). |
| D12 | A job can start from the commit of an earlier job that is not merged yet (stacked jobs). Large orders become tickets with dependencies; each ticket starts from its parent's branch. | When a parent branch changes (review changes, rebase, merge), its children are rebased onto it and re-run the steps their recipe requires (D6). The child PR targets the parent branch and moves to `main` after the parent merges. |

### Left to the spec writer (no author decision needed)

- Graph semantics: joins, round counters, terminal outcomes, node-run state machine (M3).
- Waiting states for quota, rate limits, concurrency and resources (B6).
- Route from failing checks back to the tests node (M2).
- Human queue contract (M4), observability (M5), data model gaps (M6).
- Document layout: spec, work plan, decision log (M15).

Suggested order for v0.6:

1. Rewrite §1 and the front matter.
2. Write the engine contracts: graph semantics, scheduler and budget, the check/acceptance/approval split, runner capabilities, auth modes, generic exits and versioning, plugin API and trust.
3. Write the pack contract and the `ts-webapp` reference pack.
4. Move §34-§35 into a separate plan with estimates.
5. Extend §36 with: suspension under provider terms, plugin supply chain, harness churn, product correctness, budget starvation, a single maintainer, runner/target mismatch, redistribution licensing.
6. Turn §37 into an ADR log.
7. Triage §38 into "resolve before freezing the spec" and "can stay open".
