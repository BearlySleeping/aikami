# Research

Dated assessments, one-off reviews, and measured evidence. Nothing here is
canonical — these are the artifacts a decision was *made from*, kept so the
decision can be re-examined rather than re-litigated.

**If you are looking for current truth, you are in the wrong folder.** The
authority for how the system works today is [`../architecture/`](../architecture/);
the authority for what to do next is [`../contracts/`](../contracts/) and
[`../TODO.md`](../TODO.md). This folder never overrides either.

| Subfolder | Holds |
| --- | --- |
| [`reviews/`](reviews/) | Dated strategic assessments and external reviews |
| [`audits/`](audits/) | The #381/#382 text-transport and decision-model measurement lanes |
| [`reports/`](reports/) | Generated Emberwatch reports (coverage, map validation, visual) |

## Retention

- A review stays here after it is superseded. Its status line says what replaced
  it; the reasoning is the point, not the conclusion.
- A review is **not** copied into `../reference/` when it is promoted — the
  canonical text is written fresh at its new home and the review keeps its
  dated, superseded label.
- Raw transcripts and console dumps do not belong here. Fold the finding into
  a review, then delete the dump.

## audits/ — the #381 / #382 lanes

Two measurement programmes ran against local text runtimes: **#381** (decision
models) and **#382** (native transport, admission control, context reuse). They
produced the measured constants that ship in
`packages/frontend/ai-gateway/` and `packages/shared/constants/`, and the
source comments in those packages cite these files as provenance. **Moving or
deleting a cited audit file orphans a live code comment** — update the citation
in the same change.

## reports/ — generated output

These three JSON files are written by scripts at fixed default paths. Changing a
path means changing the script:

| Report | Written by |
| --- | --- |
| `emberwatch-coverage-audit.json` | `scripts/src/lib/ops/emberwatch_coverage_audit.ts` |
| `emberwatch-map-validation.json` | `scripts/src/lib/ops/emberwatch_map_validation.ts` |
| `emberwatch-visual-report.json` | `scripts/src/lib/ops/emberwatch_visual_report.ts` |