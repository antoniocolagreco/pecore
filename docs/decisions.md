# Decisions

## 2026-11-22: Library becomes Templates

- Decision: the Library is called Templates everywhere: sidebar, page, route `/templates`, `PECORE_HOME/templates/`, `packages/app/resources/templates/` and definition paths `templates/nodes`, `templates/recipes`.
- Why: Templates says what the page holds.
- Replaces: the name Library and the `library/` folder. An existing home has `library/` renamed to `templates/` at start, in one commit.

## 2026-11-22: GUI tests removed

- Decision: `packages/app/test/gui.test.ts` and `playwright-core` are removed. The app keeps `--user-data-dir` when given.
- Why: the tests drove the whole app, took minutes, checked an outdated interface, and since 2026-11-21 ran on the user's real home because the app ignored `--user-data-dir`.
- Replaces: the GUI gate of phase 5. Engine tests cover the behaviour; the interface is checked by hand.

## 2026-11-23: The Assistant mentions icons only for templates

- Decision: the Assistant mentions or offers icons only while creating or editing a node or recipe template, or when the user asks for one.
- Why: it listed icons among the things it can create in unrelated conversations.
- Replaces: icons offered as a standalone thing to create.

## 2026-11-23: Templates sub-navigation in the sidebar

- Decision: like Settings, the sidebar shows Nodes and Recipes under Templates. They open the page's Node templates and Recipe templates tabs, which stay.
- Why: the same navigation as Settings; the tabs keep working when the menu is collapsed.
- Replaces: nothing; the tabs remain.

## 2026-11-23: Icon picker shows the icons

- Decision: the Icon field in the node and recipe editors opens a grid of icons, with each name as a tooltip.
- Why: a list of file names does not show what the icon looks like.
- Replaces: the dropdown list of icon file names.

## 2026-11-23: OpenCode ignores Claude Code's files; the Assistant knows who it is

- Decision: OpenCode starts with `OPENCODE_DISABLE_CLAUDE_CODE=1`. The Assistant says it is <PE/CORE>'s Assistant whatever other instructions say, and names the model chosen in Settings > Assistant when asked.
- Why: OpenCode read the user's `~/.claude/CLAUDE.md` and answered with the name and identity written there.
- Replaces: OpenCode loading Claude Code's instructions and skills.

## 2026-11-23: The app's name is one constant

- Decision: every text the user reads takes the app's name from `appName` in `packages/schemas`. Packaging keeps its own copy in `package.json` and `electron-builder.yml`. Internal names (`pecore`, `PECORE_*`, `pecore-agent`, `.pecore`) stay.
- Why: the app may be renamed (for example to Harmonica). With one constant the rename touches three files; internal names would need moving every user's data and OS users for no visible gain.
- Replaces: "<PE/CORE>" written by hand in about 30 source files.

## 2026-11-23: Any file can be attached or dropped in the chats

- Decision: both chats accept any file up to 10 MB, from the clip button, a paste or a drop anywhere on the chat panel. Images still reach the model as images. Other files go to a folder the agent can read, and the message tells it where they are.
- Why: the user wants to drop logs, documents and archives into the chat, not only images.
- Replaces: image-only attachments, with no drop.

## 2026-11-23: The Empty recipe template is removed

- Decision: the app no longer ships the Empty recipe template. New Recipe starts an empty recipe. A recipe with no nodes stays valid.
- Why: Empty duplicated New Recipe and looked like a recipe a job could use.
- Replaces: `templates/recipes/empty.json` and its icon.
- At start, the app removes a template file it no longer ships from an existing home, unless the user changed it.

## 2026-11-23: Sent images keep their preview

- Decision: a sent message shows each attached image as a thumbnail, like before sending. Other files stay as name and size.
- Why: the user wants to see in the chat which image was sent.
- Replaces: images listed only by name and size after sending.

## 2026-11-23: Recipe names say what the job does and where it ends

- Decision: the shipped recipes are `feature-to-pr` (Feature to PR), `feature-to-local-commit` (Feature to Local Commit) and `bugfix-to-pr` (Bug Fix to PR). They stay three distinct flows. Existing homes get the new files; the old ones are removed at start when unchanged.
- Why: Feature, Local Only and Bug Fix did not say where the job ends, and Local Only did not say what it does.
- Replaces: the recipe names `feature`, `local-only` and `bugfix`.

## 2026-11-23: Template card titles keep two lines

- Decision: a template card reserves two lines for its title, so the icon stays at the same height whether the title takes one line or two.
- Why: a two-line title moved the icon up on that card only.
- Replaces: a title as tall as its text.
- A one-line title is centred in the two-line space. Node and recipe names are limited to 24 characters, so every title fits on its card.

## 2026-11-23: Recipe editor uses a drag-and-drop palette

- Drag a node from the horizontal palette into the graph. Drag sideways to scroll the palette. Its title bar has a name and tag filter.
- Agent, Command and Human nodes use distinct labels and colours. A recipe step keeps its node type. Remove node deletes the step and its references from the draft.
- Arrange lays out the flow horizontally. Nodes snap to invisible cells on release. Arrows update during a drag, stay behind cards and use separate attachment points. Drop a connection on a card to let the editor pick its entry side.
- Return arrows and arrows to End share the same lane allocation. When their horizontal spans overlap, their lanes stay at least 24 canvas pixels apart.
- The recipe inspector omits `On base changed`. Git Rebase is available in the palette as a Command node.
- Connect the Wait for CI command after a GitHub PR or GitLab merge request. It checks every 30 seconds for up to 30 minutes and emits `success` or `failure`.
- Connect a Git Rebase conflict to the Resolve Rebase Conflicts agent. The PR templates rerun lint on `resolved` and end with failure on `unresolved`.
- The recipe canvas and inspector fill the remaining page height. On narrow pages the inspector sits below the canvas.

## 2026-11-23: Recipes start at Start and finish at End

- Start and End are always present and can be moved. Start has one output and uses the theme’s Success colour. End has multiple inputs, no output and uses the theme’s Fail colour.
- Start can connect from any of its four sides. End can receive connections on any side. The recipe remembers explicitly chosen sides.
- The editor spreads connections to End across separate lanes and places their labels on those lanes. It uses multiple sides for automatic attachments.
- Each outcome can continue at another step or reach End. The connection to End sets the result. A Human Review can send acceptance to Success, a request for changes to the Builder and rejection to Failure.
- Recipes with explicit End connections must route every outcome of each reachable step. An empty recipe connects Start directly to End. The engine can still stop a job on cancellation or an execution error.
- Previously saved recipes keep their results. Editing their connections records those results explicitly. Existing Not delivered results stay available in saved flows.
