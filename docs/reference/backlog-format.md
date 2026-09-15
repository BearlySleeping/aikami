# Contract-Ready Backlog Format

> How to write a contract-ready backlog seed in [`../TODO.md`](../TODO.md).

`docs/TODO.md` is the canonical structured seed backlog. It is parsed by
[`scripts/src/lib/ops/parse_backlog.ts`](../../scripts/src/lib/ops/parse_backlog.ts)
and read by the contract pipeline (`bun run contract --source todo C-xxx`).

## Required shape

Each seed is a level-3 heading with an explicit ID, grouped under a level-2
section (the section name becomes the item's phase):

```markdown
## Client and dialogue polish

### C-533 — Show NPC mood on the LPC sprite

- **Status:** not_started
- **Priority:** P1
- **Target:** dialogue overlay view model + expression service
- **Outcome:** One sentence describing the observable change.
- **Scope:** What is in and out of scope.
- **Dependencies:** `none`, or comma-separated contract IDs.
- **Acceptance gate:** The Given/When/Then seed for the contract's ACs.
- **References:** Verified evidence and file paths.
```

The heading ID pattern is `C-\d+` or `MIG-\d+`. **Allocate the next free ID
sequentially after checking every used and reserved ID — never reuse a
historical ID.** The format also accepts `- **Status:**` values
`not_started`, `in_progress`, `blocked`, or `completed`; only `not_started`
seeds belong here (a contract file is the authority once one exists).

- **Priority** uses P0 (blocks a playable/releasable build), P1 (core product),
  or P2 (later).
- **Target** names the primary architectural surface, not a fixed file list.
- **Acceptance gate** is the seed for the contract's Given/When/Then criteria.
- One seed becomes one contract; do not bundle a whole category into one seed.

## Unscoped ideas

Ideas that are not yet contract-sized stay in the `## Unscoped ideas` section of
`docs/TODO.md`. That section is **not** parsed, so its bullets may use any shape;
promote one into a seed (with the next free ID) when it is ready.
