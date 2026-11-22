# Decisions

## 2026-11-22: Library becomes Templates

- Decision: the Library is called Templates everywhere: sidebar, page, route `/templates`, `PECORE_HOME/templates/`, `packages/app/resources/templates/` and definition paths `templates/nodes`, `templates/recipes`.
- Why: Templates says what the page holds.
- Replaces: the name Library and the `library/` folder. An existing home has `library/` renamed to `templates/` at start, in one commit.

## 2026-11-22: GUI tests removed

- Decision: `packages/app/test/gui.test.ts` and `playwright-core` are removed. The app keeps `--user-data-dir` when given.
- Why: the tests drove the whole app, took minutes, checked an outdated interface, and since 2026-11-21 ran on the user's real home because the app ignored `--user-data-dir`.
- Replaces: the GUI gate of phase 5. Engine tests cover the behaviour; the interface is checked by hand.
