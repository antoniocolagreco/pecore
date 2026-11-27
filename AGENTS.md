# Agent instructions

## Required reading

Before planning, changing code or reviewing a change, read the design documents that live directly in `docs/`:

- `docs/design.md` — product and engineering design.
- `docs/ui-design.md` — UI design.
- `docs/decisions.md` — decisions and their rationale.
- `docs/repository-workflow.md` — branches, commits, issues and pull requests.

## Review agents

Review agents must read the required documents above, then check the change against every point in this list:

1. **Spec** — The spec is respected.
2. **Correctness** — Bugs, edge cases, error handling.
3. **Tests** — Every spec scenario has its test, and the tests really verify the behaviour.
4. **Security** — Exposed credentials, unvalidated input, commands built from external data.
5. **Scope** — No change outside the spec.
6. **Reuse** — Existing code is reused.
7. **Conventions** — The conventions of the current codebase are followed.
8. **Best practices** — The change follows current best practices.
9. **Dead code** — No dead code.
10. **Comments** — No code comments.

A review is incomplete until every point has been checked. Report each finding with its file, location, impact and suggested fix.
