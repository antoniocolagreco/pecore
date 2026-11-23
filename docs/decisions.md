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
