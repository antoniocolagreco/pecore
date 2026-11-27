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

- Drag a node from the horizontal palette into the graph. Drag sideways to scroll the palette. Its title bar searches by name, kind and tag.
- Agent, Run command and Human nodes use distinct labels and colours. A recipe step keeps its node type. Remove node deletes the step and its references from the draft.
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

## 2026-11-23: Node templates show their kind; Human has two modes

- Node template cards use a coloured left stripe and a kind badge. Search matches the name, kind and tags.
- Node icons use the same rounded square and glyph proportions in templates, editors and job views.
- Human uses one kind with `decision` and `review` modes. Older definitions load with their original outcomes. The UI shows `command` as Run command. Tags describe the node's purpose and omit kind names.
- The New Node form has clickable help next to field labels. The text explains what each setting controls in the selected kind or mode.
- Human Review offers Report for the latest textual artifact and Code for the latest diff with matching risk annotations. The job selects the artifact automatically. Old `show` lists still open with their original content.

## 2026-11-23: One node card everywhere

- Decision: the recipe palette, the card dragged into the graph, the recipe graph and the job graph use the Templates node card. The step name, and in a job the state and round, sit under the card. Start and End are circles of the same size. Graph rows are 176 px apart so cards do not touch.
- Why: different shapes for the same node confused the user.
- Replaces: the wide palette tiles with tags, the 168×68 graph nodes, the 200 px job graph nodes and the text-only drag preview.
- Kind, mode and review view keep their current rules: kind and mode are chosen only when creating a node.

## 2026-11-23: Start and End use the node card

- Decision: Start and End are the node card with a play or stop icon, a green or red stripe and no kind badge, in the recipe and job graphs.
- Why: the user did not like the circles; every box in the graph should look the same.
- Replaces: Start and End as circles.

## 2026-11-23: Start and End keep their look in the card's shape

- Decision: Start and End keep their green or red fill, border and centred label. Only their shape follows the node card: 120×120 with its rounded corners.
- Why: the user asked for the card's shape only, not its content.
- Replaces: Start and End with a play or stop icon and a stripe.
- Their fill fades from the top-left corner to the bottom-right. Other node cards keep a plain fill.

## 2026-11-23: Max node runs is explained in the recipe inspector

- Decision: the Max node runs field fills the inspector's width. An info icon next to its label explains that it caps the steps of one job, repeats included, and that the job then pauses and asks whether to continue.
- Why: the user could not tell what the field does, and the inspector has no room for a description under it.
- Replaces: a narrow field with no explanation.

## 2026-11-23: Start and End have a stripe instead of a fade

- Decision: Start and End have a plain green or red fill and a left stripe in the same colour, like the other node cards.
- Why: the user did not like the fade.
- Replaces: the fill fading from the top-left corner.

## 2026-11-23: The recipe inspector scrolls inside its card

- Decision: the recipe editor page keeps the window's height. The inspector scrolls inside its card and its title stays visible.
- Why: a node with many arrows made the whole page scroll, moving the canvas out of view.
- Replaces: a page that grew with the inspector's content.

## 2026-11-23: Recipe inspector fields fill its width

- Decision: Max rounds fills the inspector's width, like the other inspector fields.
- Why: it was the only short field in the node panels.
- Replaces: Max rounds at the 168 px width of number fields.

## 2026-11-23: The recipe inspector is at most 420 px wide

- Decision: the recipe inspector takes 29% of the editor's width, at most 420 px. The canvas gets the rest.
- Why: on wide windows the inspector grew past 600 px and took space from the graph.
- Replaces: an inspector at 29% with no maximum.

## 2026-11-23: No recipe settings button in the node inspector

- Decision: the node inspector shows only Remove node. Clicking the empty canvas, Start or End shows the recipe settings.
- Why: the gear button repeated what a click on the canvas already does.
- Replaces: the gear button labelled Recipe settings.

## 2026-11-23: Node inspector fields explain themselves

- Decision: Requires, Optional, Skip when unchanged and Max rounds have an info icon with a short explanation. An empty Max rounds shows "No limit", and its explanation says that deleting the number removes the limit.
- Why: the user could not tell what these fields do, and did not see how to remove a Max rounds value because the arrows stop at 1.
- Replaces: unexplained fields and an empty Max rounds with no placeholder.

## 2026-11-23: Max rounds starts at 0; clearer Optional and rebase labels

- Decision: Max rounds shows 0 when an arrow has no limit, and 0 saves no limit. The arrows go down to 0. "Skip when unchanged" is labelled "Keep result after a clean rebase". Optional's explanation says the step runs only if the Spec Writer lists it in the job's specification.
- Why: the user could remove a limit only with the keyboard, could not read what "Skip when unchanged" does, and thought a step in the recipe always runs.
- Replaces: an empty Max rounds with "No limit" as placeholder, the "Skip when unchanged" label and the "when the job's specification asks for it" wording.
- Known gap: the engine does not tell the Spec Writer which Optional steps the recipe has, so it cannot list them yet.

## 2026-11-23: Knowledge is a flat set of project Markdown files with a file manager

- Decision: knowledge exists only in a project; there is no global knowledge. `knowledge/` is one flat directory of `.md` files, and links between them use bare file names. The Knowledge tab becomes a file manager: file list on the left (new, upload, rename, delete), text editor on the right. Files can be written in the GUI, uploaded, written or improved by the Project Manager or the Assistant on request, or created by a project bootstrap or wizard. A node lists the knowledge files it receives by name, chosen from the project's files.
- Why: the current tab is a single list with a raw text box and a file-name field; the user wants to organise, write and assign documents like in a file manager.
- Replaces: `knowledge/**.md` with subfolders, `knowledge` globs on agent nodes, and `write_knowledge` reserved to the Project Manager.
- Not implemented yet.

## 2026-11-23: Knowledge links are followed and checked on save

- Decision: a node also receives every knowledge file its files link to. The engine checks each knowledge file on save: a link to a missing file, or with a path, refuses the save; `markdownlint` formatting findings are warnings. The editor is CodeMirror with Markdown highlighting and live underlines. A rename updates the links that point to the file.
- Why: an agent cannot follow a link to a file it did not receive, and broken links or bad formatting should be caught when the file is written, by the user or by an agent.
- Replaces: nothing; knowledge files had no checks.
- Formatting findings warn instead of blocking, so a long file is never stuck on a style rule. Not implemented yet.

## 2026-11-23: Knowledge file manager implemented; template nodes name knowledge files

- Decision: the knowledge decisions above are implemented. Node templates are shared across projects, so a node's Knowledge field offers the file names found in all projects; each project gives its own file with that name, and a project without it gives nothing. An upload may contain files that link to each other. Older `knowledge` globs still match flat file names; files in subfolders are no longer listed or given to agents. The Assistant can write knowledge files too.
- Why: knowledge belongs to a project, but nodes are templates; naming files keeps one node usable in every project.
- Replaces: the single-list Knowledge tab with a raw text box and a file-name field; the `knowledge` globs on nested paths.

## 2026-11-23: The knowledge editor looks like a notepad sheet

- Decision: the knowledge editor is a ruled paper sheet with a red margin line, the normal app font, wrapped lines and no line numbers; the paper is dimmed in the dark theme. The Knowledge tab fills the window, Save sits next to Rename and Delete, and Markdown files dropped on the tab are uploaded.
- Why: knowledge is prose, not code; the user wants it to feel like writing on paper, with more room and drag and drop.
- Replaces: the code editor with line numbers, a tab as tall as its content and upload by button only.
- Later the same day: no red margin line, and the paper and rules take the theme's colours (control background and separator), because a fixed paper colour looked out of place in the app.
- Then: the rules use the text colour at 16%, because the separator colour was invisible in the dark theme, and the cursor is 3 px wide so it is easy to find.
- Finally: the sheet has no rules, because they distract from the text. The 3 px cursor stays.

## 2026-11-23: Uploads drop broken links instead of failing

- Decision: an upload removes links to files that are neither in the project nor in the same upload, and links with a path. The link text stays (`[notes](old.md)` becomes `notes`); a broken reference definition line is deleted. The app lists the removed links. Saving a file from the editor still refuses broken links.
- Why: imported documents often link to files that do not come along; refusing the whole upload made importing them painful.
- Replaces: refusing an upload with any broken link.
- The removed links appear in a dialog with only OK, grouped by file, so the user cannot miss them. With no file open, the instructions sit centred on a blank sheet.

## 2026-11-23: Chat errors show the provider's message

- Decision: a failed chat turn shows the provider's own message, for example "You've hit your usage limit. ... try again at 6:23 PM.", not the raw error object.
- Why: the raw object (`{"code":-32603,"message":"Internal error","data":{...}}`) was hard to read.
- Replaces: showing the raw error text.

## 2026-11-23: Files the Project Manager creates go in the project's knowledge

- Decision: asked to create a file, the Project Manager saves it in the project's knowledge. A file for the repository needs a job, which it starts when the order asks for it and otherwise offers. It never leaves a file for the user in its working folder.
- Why: asked for "a new file with a poem", it saved the file in its private working folder, which the user cannot see in the app.
- Replaces: the Project Manager choosing where to put files.

## 2026-11-23: Projects list in the sidebar

- Decision: on the Projects list and on a project's page, the sidebar shows a Projects section with every project, like the Templates and Settings sections.
- Why: switching project took a trip back to the Projects list.
- Replaces: nothing.

## 2026-11-23: Agents are configured in one place

- The Agents page holds one Assistant, multiple Project Managers and multiple Workers. Every name or Worker title is unique, ignoring case. Each agent has a provider, model, effort, two context compaction thresholds and an optional Markdown context file. The Assistant and Project Managers also have personality traits.
- New projects require an available Project Manager. A Project Manager can serve one project at a time. Existing projects keep their manager and configuration.
- Workers live in Agents. Recipe nodes continue to choose models through profiles and tiers.

## 2026-11-23: Assistant and Project Manager defaults return to Settings

- Settings holds Assistant and Project Manager Default. Each project has a Project Manager tab. New projects inherit the default and get their own identity automatically.
- Assistant and Project Manager Default save automatically after a valid change.
- For Project Managers, personality is configured in each project's Project Manager tab.
- The project's Project Manager form edits initial context in a five-row text area.
- Agents contains reusable configurations, previously called Workers. A future change will let users assign these agents to recipe nodes.

## 2026-11-23: Node editor shows the same fields when editing

- Decision: editing a node shows the same fields as creating it, with their info icons. A command is one line written as in a terminal, with quotes around an argument with spaces. Source nodes show the command or script of each action. Runs as uses readable labels: "Project user, in the job's files" and "PeCore, with its logins".
- Why: editing hid the command of command nodes and the actions of source nodes, showed an empty Script file instead, and gave no explanation of fields such as Runs as.
- Replaces: one argument per line, explanations only while creating, Runs as showing `project-user` and `engine`.
- Then: Runs as became the checkbox "Use source control credentials", off by default, because "project user" and "PeCore" meant nothing to an average user. On sets `runsAs: engine`.

## 2026-11-23: Page layout rules

- Decision: five rules for every page, in ui-design.md "Page layout rules". Saving: explicit Save at the top right of the title for anything that makes a commit; app preferences save by themselves. The main action sits at the top right, primary with an icon. Pages use the whole column; forms and wizards are narrow; only the recipe editor and Knowledge fill the height. Each setting is changed in one place. Only design-system controls.
- Why: pages had drifted apart: Save in the title, in a card or automatic; main buttons in different styles; native checkboxes next to design-system ones; the Assistant and Project Managers configured in three places.
- Replaces: per-page choices.
- Then: the project tabs' actions (Save, Discard, Export, Delete project, New file, Upload) moved into the page header next to "New job", which is secondary outside the Jobs tab. The Project Manager's colour keeps the system colour picker, the one exception to rule 5.

## 2026-11-23: No git for the app's data

- Decision: `PECORE_HOME` is no longer a git repository. Saving a definition, a setting or a knowledge file writes the file and makes no commit. Projects outside `PECORE_HOME` no longer get a git repository for their definitions. An existing `~/.pecore/.git` is left untouched and unused. Git stays for the projects' code.
- Why: nothing in the app read that history; it only filled it with one commit per changed field.
- Replaces: one commit per save in `PECORE_HOME`.

## 2026-11-23: All the app's data in one folder

- Decision: everything the app writes lives in `PECORE_HOME` (`~/.pecore`): chat folders in `chats/`, harness logins in `harness/<user>/<account>/`. At start the app moves an old `~/.pecore-harness` there without new logins and deletes an old `~/.pecore-chats`, also for `pecore-agent`. `PECORE_HOME` stays private (0700); in protected mode `pecore-agent` gets access only to `chats/` and `harness/pecore-agent/` (ACL), plus the job work folders as before. A harness's own default login (`~/.claude`, `~/.codex`) is the user's, not the app's, and stays where it is.
- Why: the user wants one folder with no leftovers elsewhere, with the permissions managed inside it.
- Replaces: `~/.pecore-chats` and `~/.pecore-harness` in each OS user's home.
- Found by the protected-mode test: `pecore-agent` has no git name or email, so every job commit failed in protected mode. Job commands now get the app user's git name and email (`GIT_AUTHOR_*`, `GIT_COMMITTER_*`), or "PeCore <pecore@localhost>" when the app user has none.
- Found by the protected-mode test: `pecore-agent` could read any file of `PECORE_HOME` whose path it knew (settings, accounts, project databases), because the app wrote files readable by everyone and `pecore-agent` may pass through `PECORE_HOME` to reach its folders. The engine now creates every file private (umask 077) and at start removes other users' access from existing files and from folder listings, except the folders opened to `pecore-agent`: `adapters/`, `chats/`, `harness/<user>/`, and each project's `work/` and `repo.git/`.
- Tests: `osuser/permissions.test.ts` checks folder modes, ACLs and token modes on every run; `test/e2e/protected-mode.test.ts` creates the real `pecore-agent` in CI and checks that it runs jobs and chats but cannot read settings, accounts, profiles, the app user's logins, templates, chat history or project data.

## Agents list

- Agents uses vertical cards inspired by trading cards. Each card shows the name, harness badge, provider, model, effort and both context thresholds. The grid adds columns as space allows. Clicking a card opens the editor. Delete asks for confirmation.
- The Assistant can list, create and edit agents, read model and effort options, and edit initial Markdown context. Deleting through the Assistant requires confirmation in chat.

## 2026-11-24: Tables in chat

- Decision: chat replies and job reports render GitHub Markdown (`remark-gfm`), so tables show as tables, with the design system table.
- Why: agents often write tables; without it a table showed as one run-on line of pipes.
- Replaces: plain Markdown without tables, strikethrough or task lists.

## 2026-11-24: Chat text at 14 px

- Decision: chat messages and the chat input use `--text-size-sm` (14 px).
- Why: the author found 16 px too large in the side panel.
- Replaces: `--text-size-md` (16 px) for chat messages and input.

## 2026-11-24: Showcase page as the design system reference

- Decision: the component gallery becomes the Showcase page, a menu item in the app (and still `pnpm showcase` in a browser). It shows the rules, every colour, text and size token with its use, the icons, cards and panels and every component, with a theme preview restored on leaving the page. People and coding agents read it before UI work; a new or changed component or token is added there in the same commit.
- Why: one visible reference stops screens from drifting into their own colours, sizes and controls.
- Replaces: the browser-only gallery with components only.

## 2026-11-24: One component per kind

- Decision: the app has one component per kind, all in `ds/`: `Button`, `Card` (also for padded panels), `Dialog`, `EmptyState`, `Alert` for notices, `Table` or `TextTable` for tables, `Details` for label and value lists, `PasswordField` for secrets. The old wrappers in `components/ui` (`Button`, `Panel`, `Empty`, `Field`, `Modal`) and their CSS (`.panel`, `.table`, `.banner`, `.kv` and unused classes) are removed; `components/ui` keeps only the page shell (`Page`, `ErrorText`) and formatting helpers.
- Why: two components for the same thing drift apart in look and behaviour.
- Replaces: the `components/ui` wrappers, hand-made tables, banners and key and value lists.

## 2026-11-24: Link buttons, pick lists and chips in the design system

- Decision: a link inside text or a table is `Button variant="link"` (accent colour, underline on hover); a list to pick one item from is `List` with `ListItem` (sidebar sub-items and Knowledge files); an on/off tag is `Chip` inside `Chips` (agent personality). Job titles in the Jobs table become accent links; the stacked-jobs toggle is an `IconButton`; long Knowledge file names are cut with an ellipsis.
- Why: these were hand-made buttons, each with its own look.
- Replaces: the Jobs title and toggle buttons, the JobView link class, the Knowledge file buttons, the sidebar item styles and the trait buttons in Settings.

## 2026-11-24: Wider chat

- Decision: by default the Assistant chat takes 35% of the window, between 340 and 520 px.
- Why: tables written by agents did not fit in the chat.
- Replaces: 30% of the window, between 300 and 380 px.

## 2026-11-24: 24 agent colours and the colour picker

- Decision: one internal list of 24 colours, each with a colour name, a hex and an agent name (Crimson Chris, Orange Amber, Gold Aura, Lime Liam, Green Greta, Teal Talia, Azure Azra, Cobalt Cole, Coral Coral, Peach Penny, Lemon Lena, Mint Mina, Aqua Aki, Ice Elsa, Lavender Lavinia, Blush Rosie, Burgundy Bree, Copper Cora, Olive Olive, Forest Forrest, Slate Sloane, Indigo Indra, Purple Violet, Magenta Magda). New Project Managers take the first free name and colour in this order. Colours are chosen with the design system's `ColorPicker`: the 24 colours, named on hover, plus a custom colour from the system picker. Every agent will have a colour; the field for agents other than Project Managers comes with the agent cards.
- Why: one palette keeps agent colours uniform across cards, avatars and the sidebar.
- Replaces: the 20 Project Manager names and colours (Eva, Viola, Mara…) and the bare system colour picker for the Project Manager. Existing projects keep their saved name and colour.

## 2026-11-24: A colour per AI tool, and AI tools coming soon

- Decision: each AI tool has a colour from the 24 agent colours (Claude Code orange, Codex indigo, OpenCode slate, Antigravity CLI azure, GitHub Copilot CLI purple, Cursor CLI teal, DeepSeek cobalt, Qwen lavender, Kimi aqua, Grok crimson, Muse magenta). In Settings, Accounts, AI tools, each row shows it on its initials and a Colour button changes it with the colour picker; the choice is saved in `settings.json`. The eight tools not supported yet appear as greyed "Coming soon" rows with only the Colour button. Agent cards will use these colours.
- Why: one colour per AI tool, chosen by the user, keeps cards and lists consistent; the coming soon rows show what is planned.
- Replaces: colours hard-coded in the agent card CSS for Claude Code, Codex and OpenCode.

## 2026-11-24: AI tool default colours revised

- Decision: Claude Code terracotta `#D97757` (its brand colour, outside the 24), Codex slate, Antigravity CLI (Google) green, Muse azure, Qwen gold (amber), Grok purple, DeepSeek cobalt (dark blue). To keep colours distinct, OpenCode moves to ice and GitHub Copilot CLI to indigo; Cursor CLI teal and Kimi aqua stay.
- Why: the author's choice, closer to each tool's brand.
- Replaces: Claude Code orange, Codex indigo, OpenCode slate, Antigravity azure, Copilot purple, Qwen lavender, Grok crimson, Muse magenta.

## 2026-11-24: Unavailable AI tools hidden by default

- Decision: in Settings, AI tools, the tools with no login found and the "Coming soon" tools are hidden when the page opens; a "Show unavailable" button in the card header shows them, and "Hide unavailable" hides them again.
- Why: the list stays short with only the tools that work.
- Replaces: every AI tool row always shown.

## Agent card colours

- Agent cards follow the harness colour from Settings. The agent editor uses `ColorPicker` to set an override in `agents.json`. “Use harness colour” clears the override.

## 2026-11-24: Development stage told to agents

- Decision: the app knows whether it is in development (run from source) or production (installed package), with nothing to set by hand. In development every agent (Assistant, Project Managers, job agents) is told that it runs inside an app under active development and that many requests test the app's features. In production nothing is added. The shared-project security review is left out.
- Why: agents otherwise take odd test requests at face value or refuse them.
- Replaces: the same instructions in both stages.

## 2026-11-24: Node data by structure, outputs per outcome, reads in the recipe

- Decision: an artifact type exists only for a distinct data structure. Six types remain: `text`, `diff`, `document`, `spec`, `findings`, `reference`. Each outcome of a node produces at most one output, of a chosen type (for example the spec writer gives a `spec` with `accepted` and a `text` with `rejected`). The recipe decides where data comes from: each step lists the steps it reads (`reads`) and receives their latest outputs, labelled with the step. Only commands declare input types, because a script reads fixed fields; agents and people read whatever the recipe gives them, and always receive the ticket and the job's diff. A human node chooses its interface (`decision`, `code-review`, `report-review`) from a list the app can extend, and each outcome can ask the person for a note. The node editor shows outputs per outcome, command inputs and the interface; the recipe inspector shows Reads from. Breaking: no conversion of old definitions; the app rewrites the shipped node and recipe templates of a home in the old format.
- Why: fewer elements and less complexity; data no longer overwrites by type across nodes, and the recipe shows who depends on whom.
- Replaces: the ten types (`ticket`, `spec`, `findings`, `risk`, `check-log`, `diff`, `user-note`, `commit`, `delivery`, `pull-request`), node `inputs`, `optionalInputs` and `outputs` lists, the agent `outputSchema`, the human `mode`, `reviewView`, `show` and `answer`, and the latest-artifact-per-type rule.

## 2026-11-24: Node data in the project database, zero files between nodes

- Decision: store artifacts in `pecore.db` by job, run, name and type, with the hash and content state. Agents get labelled inputs inline, and commands receive typed inputs as JSON on stdin. Job deletion removes its artifact rows.
- Why: a job's history and artifacts travel in one SQLite snapshot, and later nodes can read inputs without workdir copies.
- Replaces: artifact files under `artifacts/`, input copies under `.pecore/inputs/` and `PECORE_INPUTS_*_PATH`. Shipped templates regenerate with format 3. Old artifact files are not migrated.

## 2026-11-24: Everything in the database, files only when there is no other way

- Decision: all app data lives in the database as records with their own fields, not as files and not as file contents stored in the database. This covers settings, accounts, profiles, tiers, agents, node and recipe templates, project definitions, knowledge and agent logs. Data passes to agents and scripts through messages and stdin, never through files: agent result, output format, agent questions, knowledge and ticket comments included. A file is allowed only when no other way exists: the project's code, attachments an agent must open, and the engine's port and token that the CLI and the MCP bridge read.
- Why: an app keeps its data in a database. Many files written again for every run are waste with no reason.
- Replaces: the rule "files describe what exists; SQLite records what happened", the definition and settings files in `PECORE_HOME`, `knowledge/*.md`, `logs/*.jsonl.zst`, `.pecore/output.json`, `.pecore/output.schema.json`, `.pecore/question.json`, `.pecore/context/` and `PECORE_COMMENT_PATH`.
- Correction: knowledge documents stay files in the project, because the user writes or uploads them; only their copy for agents is gone.

## 2026-11-24: The Assistant starts on the standard profile

- Decision: when no profile is set, the Assistant uses the first profile of the `standard` tier: the tool's default model with middle effort. "Auto-configured model" saves nothing and is resolved at each use. A one-time migration clears the profile that auto-setup had saved.
- Why: the most expensive model at maximum effort was a costly default for chatting and configuring the app.
- Replaces: the `frontier` profile as the Assistant's default.

## 2026-11-25: Each agent has a session per job

- Decision: Agent context defaults to Shared and can be set to Isolated in an agent template or overridden in a recipe step. A recipe step can assign its own agent card. Shared runs continue the card's conversation within the job. Isolated runs use a fresh conversation and leave the Shared one untouched. Changing account, model or effort starts a new session on the next node. Shipped agent reviewers use Isolated.
- Why: related steps can build on the same agent's work while reviewers assess it independently.
- Replaces: Resume session on a node and the recipe step's named session group.

## 2026-11-25: Discover Git hosting accounts at startup

- Decision: Add missing GitHub, GitLab and CodeCommit accounts from the app user's forge CLI sessions. Manual accounts ask for the service and its server or AWS profile. Author details start with global Git settings. GitHub and GitLab fill the username after login. Account settings can be edited afterwards.
- Why: The CLIs already know the authenticated identities and Git already knows the commit author.
- Replaces: Entering every forge account, username and commit author by hand.

## 2026-11-25: Agent sessions can follow a job or node

- Decision: Agent session offers Job (default), Node and New in agent templates and recipe steps. Job continues the card's session across the job. Node continues the card's session for the same step. New starts fresh on each run. Code Reviewer and Approver use New. Changing account, model or effort starts a fresh session on the next run.
- Why: A step that repeats can keep its own conversation separate from the rest of the job.
- Replaces: Agent context with Shared and Isolated. Shared becomes Job and Isolated becomes New.

## 2026-11-25: Show the required check for source control commands

- Decision: Use source control credentials reveals Check command in the node editor. A saved script check appears as Check script name. Validation explains what to enter.
- Why: The check prevents repeating an action that already happened remotely. Users need a way to supply it before saving.
- Replaces: Requiring a check that the node editor did not expose.

## 2026-11-25: Run checks in the job's workdir

- Decision: Remove Clean checkout. Run build, lint and test commands in the job's workdir.
- Why: Repository CI catches checks that pass only because of local files Git ignores.
- Replaces: The Clean checkout option, the temporary worktree it created and the extra dependency install in the Vitest checks.

## 2026-11-25: Tracker nodes replace ticket intake

- Decision: Add one-script Tracker nodes for GitHub, GitLab and Jira, with templates to search, read and comment. Choose the account on the template. Shipped templates use the project Git account or the active Jira CLI login. Existing chat read and comment actions use the same runner. Questions stay in the app.
- Why: The Source node was an integration disguised as a node. Its four scripts were hard to understand.
- Replaces: The Source node, automatic ticket polling and tracker replies as answers.

## 2026-11-25: Repository nodes own Git hosting actions

- Decision: A Repository node runs one inline shell script with a Git hosting account chosen on the node template. Shipped templates use the project account and keep their internal repeat and merge checks. A job needs the account before it starts. Command nodes receive no Git hosting or tracker credentials from the app.
- Why: An experienced developer could not understand the credentials checkbox.
- Replaces: Use source control credentials, its Check command field and credentialed Command nodes for repository actions.

## 2026-11-25: Project nodes become Project Manager tools

- Decision: Project Managers can call Repository and Tracker nodes in chat. Reads run directly. Changes need confirmation for the exact action. Protected mode also requires the current script to match the authorization recorded by the app. Shipped nodes and user saves authorize the saved script. Agent saves do not. Job execution follows its existing rules.
- Why: The Project Manager needs to find tickets and plan one job per ticket while keeping Git hosting and tracker logins inside the app.
- Replaces: Dedicated ticket actions as the only chat access to project trackers and direct posting of comments on request.

## 2026-11-25: Tracker nodes can call Atlassian MCP

- Decision: Tracker nodes choose CLI or MCP server. The latter saves the server, tool and arguments. The app launches a local stdio bridge on demand. The bridge owns browser OAuth and its tokens. Adding the Atlassian service account starts sign-in. An expired login pauses a job node until sign-in succeeds. Chat actions offer sign-in in Accounts. The existing chat confirmation and protected-mode authorization cover MCP calls.
- Why: One Atlassian login can reach several Jira sites and each call can choose its site by cloudId.
- Replaces: CLI as the only Tracker mode.

## 2026-11-25: Name node outcomes by their result

- Decision: Use `success` and `failure` for ordinary outcomes. Keep clear names for distinct paths such as `changes_requested` and literal answers such as `yes` and `no`. Rename shipped and saved outcome references without changing how existing recipes route. End derives the job result for the standard outcomes. For other outcomes, show a prefilled job result the user can change.
- Why: Names such as `done` do not tell the user what happened. The editor asked users to classify an ordinary failure a second time.
- Replaces: Vague outcome aliases and the required job result choice for every connection to End.

## 2026-11-25: Explain base-change routes and route Tracker failures

- Decision: Name the affected steps in recipe validation and show the base-change entry in Recipe settings. Failure edges leave the bottom of their source cards. Jira MCP tool refusals take the Failure branch, and saved recipes that use the shipped templates gain a failed End connection if needed. The three agents that produce one usable result keep Success as their only outcome.
- Why: Adding Read Ticket exposed a route from Git Rebase to GitHub PR without a spec. Failure edges were hard to follow, and Jira MCP needed the same failure branch as Jira CLI.
- Replaces: Internal paths in recipe validation, failure exits based on drag handles, and attempt errors for refusals from shipped Jira MCP tools.

## 2026-11-25: Check button last in Accounts group headers

- Decision: In Settings, Accounts, each group header shows its buttons at the right end, with Check last.
- Why: The same layout in every group header.
- Replaces: Check right after the title.

## 2026-11-25: Route recipe arrows around cards

- Decision: Drag from any side of a card and drop anywhere on the destination, including End. Reconnecting keeps the outcome. Dropping the destination on empty canvas removes the arrow. Arrows reroute during dragging on separate orthogonal tracks around cards. Their endpoints follow the facing sides when possible. Recipes store only the connections and card positions.
- Why: Dragging to End could fail, and saved sides forced awkward bends and overlapping arrows.
- Replaces: Saved connection sides, bottom exits for failures, and fixed lanes for returns and End.

## 2026-11-25: Give recipe arrows visible clearance

- Decision: Leave a minimum visible gap of 10 px at 100% zoom between parallel shafts and around cards. Center free ports and spread busy ports. Place labels in clear space on or beside their own arrow. Draw a wider stroke and a visible arrowhead.
- Why: Distinct coordinates still looked like overlapping lines. Labels hid nearby outcomes, and arrowheads were hard to see.
- Replaces: Tracks squeezed into narrow channels and labels centered on the longest segment without checking for collisions.

## 2026-11-25: Spread recipe arrows after their leads

- Decision: At 100% zoom keep 20 px of visible gap between parallel shafts away from cards and 10 px near their leads. Use 26 px straight leads when space allows and double the arrowhead width. Route the latest position once per drag frame and reuse clear paths.
- Why: Parallel runs still looked too close, short ends hid the direction, and routing the entire graph for each pointer event made dragging slow.
- Replaces: The same minimum gap along the whole arrow and a full reroute on each pointer event.

## 2026-11-26: Give jobs their request at Start

- Decision: The Project Manager reads the ticket and supporting links, combines their relevant details with the chat order, and creates one job with the original files it selects. The engine saves the request as Start's document. Start runs nothing. Spec Writer reads the document and can open the files by path. Later steps can also read Start.
- Why: The same recipe should work whether the request comes from a ticket, a web page, chat or attached files.
- Replaces: Treating a ticket as the only job context and requiring a recipe step to fetch missing context.

## 2026-11-26: Give Agent nodes tracker access

- Decision: Agent nodes can read or update tickets through an account and the app's tracker tools. The Project Manager uses the same tools and asks for approval before writes. Saved Tracker nodes become Agent nodes with their existing routes and output types. Bug Fix to PR ends with an Agent that updates the ticket.
- Why: Choosing a status, writing comments and updating fields require judgment.
- Replaces: The Tracker node kind and its shipped scripts and MCP tool definitions.

## 2026-11-26: Remove the Tracker node kind from saved jobs and imports

- Decision: Upgrade saved Tracker nodes and job definitions to Agent nodes. Preserve custom actions as reference text. Reject old Tracker definitions when validating new edits and imports.
- Why: Tracker access belongs to Agent nodes, including when an existing job resumes.
- Replaces: Keeping the Tracker runner for existing jobs and accepting Tracker definitions in project archives.

## 2026-11-26: Give each artifact one meaning

- Decision: Nodes exchange Spec, Diff, Code Review, Code Analysis, SHA, Pull Request, Feedback and Log. Specs describe BDD scenarios. Human Review sends its general note and inline comments together. The job stores the title, request and attachments. Recipes use explicit branches. Node runs record the files hash. Write PR drafts the title and body for GitHub or GitLab. Git and CodeCommit keep the same recipes with Push connected directly to Git Delivery. Upgrade saved definitions and discard job history in the old format.
- Why: Each node needs inputs with a known purpose. Delivery still works on servers that only offer Git.
- Replaces: Generic artifact contracts, the stored ticket output from Start, optional steps selected by the spec, and content state.

## 2026-11-26: Restore pages on Back and Forward

- Decision: Keep filters, search text, tabs, expanded sections and scroll for each visit during the app session. A new visit starts with defaults. An editor's Back link restores its list.
- Why: Opening a node, job or recipe should not make the user find their place again.
- Replaces: Reopening a previous page with its defaults.

## 2026-11-26: Use mouse buttons for Back and Forward

- Decision: Mouse Back and Forward buttons use the same history as the keyboard.
- Why: A mouse press should return to the same place as a keyboard shortcut.
- Replaces: App shortcuts that only handled keyboard input.

## 2026-11-26: Write Knowledge accepts a file name in a project chat

- Decision: In a project's chat, `write_knowledge` accepts the file name alone, for example `notes.md`, and saves it in that project's `knowledge/`. The full path `projects/<id>/knowledge/<name>.md` still works, and the Assistant uses it outside a project chat.
- Why: The Project Manager lost its first attempt on a bare file name, retried, and told the user about the failure.
- Replaces: The full path as the only accepted form.

## 2026-11-26: Support pi through the pi-acp adapter

- Decision: pi is a built-in harness through the `pi-acp` adapter (0.0.35), which starts the user's installed `pi` in ACP mode. `packages/app/resources/connectors/pi.json` pins the adapter and sets `PI_ACP_PI_COMMAND`. Models and thinking levels come from the ACP session's `model` and `thought_level` config options, so pi uses the same model-only login check as OpenCode: it is logged in when its session lists at least one model.
- Why: pi has no ACP mode of its own. `pi-acp` is an ACP adapter for pi, so the connector needs no engine change and the user's existing `pi` login and providers stay in place.
- Login: the `pi-acp` adapter exposes `--terminal-login`, which starts pi's own interactive login, so the user chooses the provider; no provider is hardcoded. Because it needs a terminal, the connector runs the adapter with `--terminal-login` inside `script` on Linux and macOS. A user already logged in to a pi provider only needs Check.
- Errors: `pi-acp` maps a missing login to `-32000` "Authentication required", which is `auth`. It retries provider failures itself and reports only "Retrying (attempt n/m)…" or "Retry finished, resuming."; the connector classifies those messages as `rate_limit`, so the node waits instead of failing. pi-acp reports no token usage or cost, so attempts show no token counts; the selected model is still recorded from the session config option.
- Replaces: pi in the list of harnesses planned after phase 6.

## 2026-11-26: One Trackers group in Accounts

- Decision: Settings > Accounts has one Trackers group with one row per tracker account, showing its name, site and login state. A Jira login from the Atlassian CLI appears on its own and shares the Jira row, so Jira shows once. The app stores the Jira site after login and check. Add account asks which tracker and starts browser sign-in. The app chooses the CLI or the MCP bridge; the user never sees the choice.
- Why: Atlassian and Jira were separate panels for the same tracker, with different layouts and technical text.
- Replaces: The Atlassian, Linear and Jira panels.

## 2026-11-26: Show every supported AI tool in Accounts

- Decision: In Settings > Accounts > AI tools, every supported harness has a row. Without an account, the row shows Not installed, Logged out or No models, never Logged in, and Log in when the harness is installed. Logging in from the row creates the account and re-runs auto-setup. Show unavailable reveals these rows, including the supported harnesses with no account, and Hide unavailable hides them again.
- Why: A harness with no account, such as pi with no model, was invisible and could not be logged in from the app.
- Replaces: Listing only the harnesses that already have an account or are being discovered.

## 2026-11-26: Remove four AI tools that will not be supported

- Decision: Cursor CLI, Qwen, Kimi and Muse are removed from the AI tools list and from the colour defaults. The coming soon rows are Antigravity CLI, GitHub Copilot CLI, DeepSeek and Grok.
- Why: The author will not support them, and the list should show only what is planned.
- Replaces: The eight coming soon rows of 2026-11-24.

## 2026-11-26: Use one delivery node and one repository creation node

- Decision: Open PR and Create Repo select their internal implementation from the project's Git hosting account. GitHub and GitLab return the draft with a URL. Private Git and CodeCommit connect Push directly to Open PR and deliver the branch without an artifact. The migration updates saved recipes and project setup references. Existing job snapshots retain their scripts.
- Why: the same recipe should work with all four providers.
- Replaces: provider-specific delivery and repository creation nodes in recipes and Templates (issue #20).

## 2026-11-26: Codex defaults to light grey

- Decision: Codex's default colour is `#EEF1F2`, a light grey outside the 24 agent colours, like Claude Code's terracotta. The user's saved colour still wins.
- Why: The author's choice, closer to OpenAI's look.
- Replaces: Codex slate `#64748B`.

## 2026-11-26: Reset an AI tool colour from its picker

- Decision: the AI tool colour dialog has a Reset button beside Done. It removes the saved colour, so the tool's default applies; it is disabled when no colour is saved.
- Why: changing a colour had no way back to the default.
- Replaces: nothing.

## 2026-11-26: OpenCode defaults to blue

- Decision: OpenCode's default colour is `#5D9BEA`, a blue outside the 24 agent colours, like Claude Code's terracotta and Codex's light grey. The user's saved colour still wins.
- Why: The author's choice, closer to OpenCode's look.
- Replaces: OpenCode ice `#BAE6FD`.

## 2026-11-26: Pi is capitalised and defaults to amber

- Decision: the AI tool is called "Pi" in the GUI, with the id `pi` unchanged. Its default colour is `#F59E0B`, an amber outside the 24 agent colours. The user's saved colour still wins.
- Why: the author's choice of name and colour for the tool.
- Replaces: the lowercase name "pi" and its lavender `#C4B5FD`.

## 2026-11-26: Antigravity CLI defaults to green

- Decision: Antigravity CLI's default colour is `#3DA955`, a green outside the 24 agent colours. The user's saved colour still wins.
- Why: the author's choice for the tool's colour.
- Replaces: green `#16A34A`.

## 2026-11-26: DeepSeek defaults to blue

- Decision: DeepSeek's default colour is `#5785FA`, a blue outside the 24 agent colours. The user's saved colour still wins.
- Why: the author's choice for the tool's colour.
- Replaces: blue `#1D4ED8`.

## 2026-11-26: Grok defaults to near-black

- Decision: Grok's default colour is `#0F1419`. The user's saved colour still wins.
- Why: the author's choice for the tool's colour.
- Replaces: purple `#7E22CE`.

## 2026-11-26: GitHub Copilot CLI defaults to purple

- Decision: GitHub Copilot CLI's default colour is `#8957E5`, a purple outside the 24 agent colours. The user's saved colour still wins.
- Why: the author's choice for the tool's colour.
- Replaces: indigo `#6366F1`.

## 2026-11-26: AI tool colours are fixed

- Decision: every AI tool has one fixed colour, defined in the app. The Colour button, its picker and Reset are removed from AI tools, and the saved per-tool colours are dropped. The state badge is the last element of an account row, at the right edge.
- Why: the colours are part of each tool's identity; letting the user change them added state with no use.
- Replaces: the colour picker, Reset and the `harnessColors` setting from 2026-11-24 and 2026-11-26.

## 2026-11-27: Native MCP client for Atlassian and Linear

- Decision: Atlassian Rovo and Linear are reached through Pecore's own MCP client (`@modelcontextprotocol/sdk`, Streamable HTTP) instead of the external `mcp-remote` bridge. The client owns the OAuth flow and stores its tokens under `PECORE_HOME/mcp/<server>/` with mode `0700`/`0600`; it never reads `~/.mcp-auth`. Only an explicit Log in opens a browser. Status checks and tracker calls use or refresh stored tokens without interactive authorization.
- Why: the bridge needed a separate install, could open a browser during a status check, and left Pecore unable to report MCP state without parsing its output. A native client matches how Claude Code, Codex and OpenCode handle remote MCP.
- Replaces: the `mcp-remote` bridge described on 2026-11-25. The bridge and its install requirement are removed. Existing `~/.mcp-auth` tokens are not read; users sign in once more after the switch.

## 2026-11-27: Discover trackers automatically and prefer MCP

- Decision: Trackers has no Add account or tracker picker. GitHub, GitLab, Jira and Linear rows come from engine discovery: GitHub and GitLab reuse the Git hosting account IDs, Jira combines the Atlassian CLI login and the native Atlassian MCP session, and Linear uses the native Linear MCP session. Show unavailable reveals providers without a usable login and remembers the choice. MCP is shown with a badge before the state badge.
- Decision: discovery runs at startup, when Settings opens, after a provider login and on Check. Native MCP probes are non-interactive: missing, expired or revoked credentials are reported as logged out or unknown and never open a browser. A verified probe or an explicit Log in creates or refreshes the matching `ServiceAccount`; cancelling or failing leaves no new account.
- Decision: automatic Jira calls prefer verified Atlassian MCP access to the requested site. When MCP cannot reach that site, the active `acli` login is used if it reaches the same site and can express the operation. Jira remains one row with its active transport, and Connect MCP starts native OAuth from the CLI row. Explicit account selections are unchanged.
- Why: users should not have to add a tracker before logging in, and the row should name the transport that tracker calls actually use. The native client makes a browser-free status probe possible.
- Replaces: Add account, the tracker picker, the saved-before-login row and the `mcp-remote`-era rule that background MCP checks were unsafe.

## 2026-11-27: Node tests use one shared sample folder

- Decision: the node editor's Test panel runs one Agent, Command or Human node with the current draft in `PECORE_HOME/test/`, a Git repository the app creates from a shipped sample project and resets on request. Inputs are checked against their artifact types. Repository nodes are not testable. The folder keeps changes between runs and never touches a project's repository, workdir or database. Git operations on the test folder run as the project user, so its metadata is never executed by the app user.
- Why: trying a prompt or a check should not require saving the node and running a full job.
- Replaces: nothing.

## 2026-11-27: Unblock child jobs from a recipe step

- Decision: An optional flag on a recipe step lets the engine use that step's successful `node_run.completed` event and its SHA artifact to unblock child jobs. Shipped recipes set the flag. The editor shows it in advanced settings for steps that produce a SHA on success.
- Why: A child can start from the parent's commit while the parent waits for review and merge. New users can run the shipped recipes without configuring the flag.
- Replaces: Waiting for the parent job to reach `succeeded` before starting a child. See issue #66.
