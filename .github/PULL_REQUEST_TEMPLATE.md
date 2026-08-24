## What and why

<!-- The diff shows what changed. Use this space for WHY. -->

Fixes #

## How to verify

<!-- What should a reviewer do to see this working? A command, a route, a test name. -->

## Checklist

- [ ] `bun run fix` — lint + format clean
- [ ] `bun moon run :validate` passes
- [ ] `bun run test` passes
- [ ] New behavior has a test; a bug fix has a test that fails without it
- [ ] One concern per PR — no unrelated refactors bundled in

<!--
First PR? Read CONTRIBUTING.md — it's short and covers the conventions that
Biome can't enforce (engine boundary, shared-package placement, no server
routes in the client).

Wondering about the `C-xxx` comments? They reference specs in docs/contracts/.
You don't need to write one, or cite one.
-->
