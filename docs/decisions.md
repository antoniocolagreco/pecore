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
