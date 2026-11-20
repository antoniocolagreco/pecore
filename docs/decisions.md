# PeCore decisions

Antonio's product decisions, newest rules included. When this file and `design.md` or `ui-design.md` disagree, this file wins. Add every new decision here in the same change that implements it.

## Principles

- Minimum friction: PeCore works by itself from the first start. No required setup, defaults come from the system, questions only when there is no other way.
- Every screen starts from what the user wants to do. It never shows engine internals: profiles, tiers, node names, JSON.
- The user never types an ID. IDs are generated.
- No configuration by editing text or JSON.
- Raw validation errors (such as `profiles.0.id: Invalid string`) never reach the screen.

## Navigation and layout

- One sidebar, no group titles. Order: Orchestrator, Inbox, Factory, Jobs, Projects, Library, Usage, Settings.
- A page's own sub-navigation (Settings sections, conversations) goes in the main sidebar under Settings. No second sidebar column.
- Page content is centred, with a maximum width.
- Orchestrator in the sidebar reopens the last conversation opened in this run of the app. Clicking it while already in the Orchestrator opens the new conversation page.

## Controls

- Selects and comboboxes look the same: same arrow, no clear button.
- A focused field shows one focus ring.
- While options load, the field shows a spinner and a "Reading…" text. It never looks disabled.

## Settings

- Sections adapt to the window width. Every section has a one-line description under its title.
- No Models section: models are chosen where they are used (see Models).
- Accounts, AI tools: every installed harness appears by itself. Each row shows name, state and a Check button that looks clickable. Log in appears only when needed.
- OpenCode is ready when it lists at least one model. With no models, the row tells the user to set up a model provider in OpenCode.
- Accounts, Git hosting: texts never name a hosting service. Add account offers a public service or the user's own server.
- Private Git server (any host): existing repositories only, over HTTPS or SSH with the user's own Git credentials. The job's branch is pushed as the delivery. The job counts as merged when its commit reaches the target branch. No repository creation, no tickets.
- Planned hosting services: Bitbucket, Codeberg, Gitea, Forgejo, SourceHut, AWS CodeCommit.
- Orchestrator section: Provider, Model and Effort selects.

## Models

- The model is chosen where it is used: on each agent node (provider, model, effort) and for the orchestrator.
- Effort is set per node.
- Open: shipped nodes default to "Automatic", with an optional explicit choice (A, recommended), or always need an explicit model (B).

## Orchestrator chat

- The reply appears while the orchestrator writes it.
- After sending, the cursor stays in the message box. Opening a conversation puts the cursor there.
- Animated dots show the orchestrator is working until its reply starts.
- Compact button in the conversation header, and `/compact` typed as a message, compact the conversation. The chat shows a divider, not a reply.
- What the orchestrator does appears under its reply, never under the user's message. Actions that change something get a card: create jobs, answer a job's question, add a node or recipe to a project, comment on a ticket. Reads appear as one grey line, for example "Read: projects, job status".
- The chat uses the model selected in Settings, also when it continues an earlier conversation.

## Notifications

- A system notification appears only when the PeCore window is not focused.
- Chat replies never go to the notification list. The unread count next to Orchestrator and next to each conversation shows them.

## Library and nodes

- The node system needs a redesign from scratch.
- Proposal, not decided: the user does not browse nodes like `cargo-clippy`; checks (clippy, typecheck, tests) come from the repository.
- Proposal, not decided: the Library becomes a catalogue of recipes (what PeCore can do); nodes appear only inside the recipe editor.
- Library files shipped with a new PeCore version are added to an existing home at start. Files the user changed are never overwritten. A shipped file the user deleted comes back.

## Development

- `pnpm dev` runs the app with live reload of interface and engine.
- No GUI tests until the redesign is finished. Every change still passes typecheck, lint and engine tests.
