# Plans

**Only genuinely unfinished work belongs in this folder.** A plan that ships is
deleted, not kept "for reference" — Git history is the archive.

When a plan is retired: fold any still-valid decision into
[`../architecture/`](../architecture/), [`../reference/`](../reference/), or
[`../design/`](../design/), then delete the plan. Do not leave the decision only
in a plan.

> A dated assessment or a superseded review is **not** a plan. Those live in
> [`../research/`](../research/).

## Retention rule

Each file states its own release condition. Read it before deleting anything.

| Plan | Release condition | State |
| --- | --- | --- |
| [`ai-setup/README.md`](ai-setup/README.md) | Delete once **C-483** is `completed` | **Retained** — C-483 is still `approved` |
| [`emberwatch_rebuild.md`](emberwatch_rebuild.md) | Supplied content spec for the Emberwatch rebuild | Retained — brief JSONs are read by code at fixed paths |
| [`visual_asset_foundation.md`](visual_asset_foundation.md) | C-504 AC-5 verification | Retained — AC-5 outstanding |
| [`emberwatch_polish_brief.md`](emberwatch_polish_brief.md) | Machine-readable twin of `emberwatch_polish_brief.json` | Retained |
| [`private_world_generation_drafts.md`](private_world_generation_drafts.md) | G01 milestone record | Retained |
| [`engine_runtime_integrity.md`](engine_runtime_integrity.md) | Merge of `task/sa-polish-runtime-integrity-6577` | 🔴 **Do not delete** — 9 unmerged commits |
| [`playable_ux_acceptance.md`](playable_ux_acceptance.md) | Merge of `task/sa-polish-playable-ux-98a3` | 🔴 **Do not delete** — 4 unmerged commits |
| [`combat/combat-2-repair-progress.md`](combat/combat-2-repair-progress.md) | Production `/game` re-run (F1–F11 → *Fixed*) | 🔴 **Do not delete** — outstanding verification |
| [`combat/combat-completion-progress.md`](combat/combat-completion-progress.md) | C-526 AC-10 production lanes run | 🔴 **Do not delete** — §10.4 unfinished; cited by C-526 |

## Machine-readable inputs

These are read by scripts and tests **at these exact paths**. Moving one breaks
code, not just a link:

| File | Read by |
| --- | --- |
| [`emberwatch_asset_brief.json`](emberwatch_asset_brief.json) | `emberwatch_accept.ts`, `emberwatch_coverage_audit.ts`, `emberwatch_legacy_props.ts`, `rebase_emberwatch_brief.ts`, `generate_batch_test_support.ts`, plus schema tests |
| [`emberwatch_asset_brief.schema.json`](emberwatch_asset_brief.schema.json) | The brief's `$id` |
| [`emberwatch_legacy_prop_replacements.json`](emberwatch_legacy_prop_replacements.json) | `emberwatch_legacy_props.ts` (`MANIFEST_PATH`) |
| [`emberwatch_polish_brief.json`](emberwatch_polish_brief.json) | `emberwatch_polish_brief.test.ts` |