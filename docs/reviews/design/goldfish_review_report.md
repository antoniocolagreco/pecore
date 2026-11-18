# Stage 7 Resolution

*   **Source:** `critic_report.md`, round 1.
*   **Author instruction:** fix everything that needs no preference or judgement from the author; ask the rest.

## Fixed

| Finding | Fix in `docs/design.md` |
|---|---|
| design-1-B1 | Section 8: `pecore-fs` helper as the project user for every file operation under `work/`; symlink test |
| design-1-B2 | 3.2: no `params` overrides on engine nodes; 6 and 8: orchestrator recipe changes and engine or source nodes need confirmation; waiting reason `confirmation` |
| structural-1-B1, design-1-M11 | New `Risks & Limits` section |
| design-1-M1 | 4.4: content state recomputed before `requires` and commit; commit tree must match; push of `{job.commit}` |
| design-1-M2 | 4.4 and 3.1: `cleanCheckout` |
| design-1-M3 | Section 1: kill through `sudo -u`, leftover sweep, systemd scope; section 5: `sudo -H` with `env -i` and explicit variables |
| design-1-M4 | 3.4: per-account config directory, identity check; Open Questions: macOS Keychain |
| design-1-M5 | Section 5: manifest error rules and recorded outputs; G7 verification |
| design-1-M6 | 3.2 notes and `git-push` template: probe and push on `{job.commit}`, `--force-with-lease` |
| design-1-M7 | 4.4: record and undo git state on interruption |
| design-1-M8 | 4.6: `parent_failed`, delete of parents with live children refused, archived parents; CUJ 2 |
| design-1-M9 | 4.2 debounce; 3.2 `skipWhenUnchanged` |
| design-1-M10 | 4.9: stop on `before-quit`, `compose stop` on pause keeps data |
| design-1-M12 | 4.3 and 4.8: `network` and `auth` waits; G17 resume |
| design-1-M13 (export, import) | Section 8: logs excluded, token scan, review of all imported nodes |
| structural-1-M1 | Alternatives: concrete reason and loss for each entry |
| structural-1-M2, style-1-N1 | Header: links and meaning of Dn and v0.5 Qn |
| structural-1-M3, style-1-N2 | New `Changes from the Concepts Brief` table |
| style-1-M1..M7 | Overview, Problem, G6-G17, CUJs rewritten; Terms list; "self-contained" |
| Nits | State diagram arrows, pool units while waiting, base change during human review, `// empty` in jq, cleanup failures, `$schema` paths, input rule on every path, budget units, app-user warning, CUJ 4 wording, Antigravity, OpenHands, headings renamed, Open Questions with phases, 3.2 split in fields table and notes, wording nits |

## Decided by the author

*   design-1-M13 (intake trust): automatic start only if the ticket author or the labeller is in the source's `trusted` list; other tickets wait for the user's confirmation (section 7).

## Not applied (nits)

*   One cross-reference style throughout, horizontal rule consistency, numbering of Non-Goals, tables for per-kind node fields: formatting only, left for the final pass.
