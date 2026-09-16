# Contracts

Feature specifications with data models, acceptance criteria, and implementation
notes. Each contract is the durable authority for the feature it describes.

- Start a new contract from [`TEMPLATE.md`](TEMPLATE.md) (or
  [`THIN_TEMPLATE.md`](THIN_TEMPLATE.md) for a thin contract).
- Index of contract groups and sequencing: [`INDEX.md`](INDEX.md).
- Status of every contract (generated): [`PROGRESS.md`](PROGRESS.md).
- Feature promotion state (generated): [`PROMOTION.md`](PROMOTION.md).
- Outstanding, not-yet-drafted work: [`../TODO.md`](../TODO.md).
- How the pipeline runs: [`../guides/contract-pipeline.md`](../guides/contract-pipeline.md).

**Contracts are append-only history.** Update status, acceptance evidence, and
links; never rewrite an execution report to imply success it did not have, and
never move a modern contract into `archived/` if that would discard a meaningful
status or promotion distinction.

## Backlogs (seed docs for the drafting pipeline)

| Doc | Covers |
|---|---|
| [`MVP_BACKLOG.md`](MVP_BACKLOG.md) | Original MVP seed evidence (C-400 … C-419) |
| [`BACKLOG_C452_PLUS.md`](BACKLOG_C452_PLUS.md) | Toolchain hygiene, distribution/onboarding, RPG-depth batch |
| [`BACKLOG_C485_PLUS.md`](BACKLOG_C485_PLUS.md) | Response to the 2026-09-06 external review — evidence gate, consequence authority, Emberwatch depth, presentation |

`docs/TODO.md` is the canonical structured seed backlog for new contract-sized
work. Backlog documents above are historical seed evidence; prefer folding a new
item into `TODO.md` unless it belongs to one of those programmes.
