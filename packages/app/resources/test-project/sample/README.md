# Sample project

This small project is the shared folder for node tests. It has a TypeScript part and a Rust part, so the shipped check nodes have code to check.

- TypeScript: `src/greeting.ts`, its Vitest test in the `unit` project, `tsconfig.json` and `eslint.config.js`.
- Rust: `src/lib.rs` with its test, built by Cargo.

Edit these files or create new ones while trying a node. The changes stay until you reset the folder from the node editor, which restores this sample project.

To make the checks fail, break the code, for example change the text returned by `greeting` without updating its test.

Git Rebase moves your work onto a newer base, where `greeting` says "Hi" instead of "Hello". To get a rebase conflict, change the same line of `src/greeting.ts` first.
