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
