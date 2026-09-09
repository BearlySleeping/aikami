# Visual asset foundation — execution guide

**Status:** documentation packet complete; contracts are drafts, not implementation approval.
**Scope decision (2026-09-09):** foundation now; biome/region compiler later.

## Start here

1. Review and approve the four contracts below. Approval to write this packet is not approval to implement/publish it. Update both frontmatter and metadata status to `approved` only after the maintainer approves the specifications.
2. Make the packet available on the implementation base before creating task worktrees. Publishing/committing it requires explicit instruction; these prompts do not authorize either.
3. Start a fresh implementation session using `/assets-01-correctness` (or paste the corresponding prompt file). Prefer DeepSeek V4 Flash for the bounded implementation. Read the protocol below first.
4. Complete and independently verify each batch before requesting its PR review. Continue in the exact order below.

No full contract-pipeline run is required. Do not repeatedly regenerate/critique the already approved specifications. Keep acceptance evidence and independent verification even when orchestration is manual.

## Specifications and ownership

| Document | Owns | Does not own |
|---|---|---|
| [C-504](../contracts/C-504-stable-character-appearance-identity.md) | Named appearance identity, known legacy migration, runtime/validator parity | Generic visual format |
| [C-496](../contracts/C-496-shared-visual-assets-and-playback.md) | Shared visual definitions, adapters, publication, playback and host parity | Map generation or scene topology |
| [C-505](../contracts/C-505-canonical-scene-data-and-authoring-boundary.md) | Canonical scene JSON, adapters, identity, uniqueness and terrain authority | Biome scatter, procedural houses or new matching solver |
| [C-506](../contracts/C-506-emberwatch-visual-readability.md) | Thin presentation pass using existing schemas/physics | New persistent fields or gameplay rules |
| [Semantic authoring design](../architecture/semantic_map_authoring.md) | Future region/biome/prefab boundary and illustrative syntax | An implemented/accepted map format |

Use the existing C-496 ID from the backlog seed. C-376/C-378/C-417 are historical reuse references, not new contracts to rerun. The four specifications can share PRs/increments as below; do not add a contract for every localized fix.

## Execution order and PR budgets

| Order | Prompt | Work | Entry gate | Exit gate | Target paths |
|---|---|---|---|---|---|
| 1 | `/assets-01-correctness` | C-504 plus bounded tag/role/alpha/redundant-layer fixes | Packet approved; baseline recorded | All C-504 ACs and listed fixes verified | 30–55 |
| 2 | `/assets-02-format` | C-496 increment A: AC-1–AC-4 | PR 1 merged | Shared format/adapters, real game consumer and consistent publication | 40–65 |
| 3 | `/assets-03-scenes` | C-505 | PR 2 merged with increment A evidence | All C-505 ACs, including native conversion and real map preview | 40–65 |
| 4 | `/assets-04-playback` | C-496 increment B: AC-5–AC-7 plus recheck A | PR 3 merged | All C-496 ACs; redundant host interpretations removed | 45–70 |
| 5 | `/assets-05-readability` | C-506 | PR 4 merged | Three real Emberwatch scenes pass presentation/movement review | 30–55 |

These are scope budgets, not claims about how many files implementation will require. Do not manufacture changes to hit 50. At 75 paths reassess; at 85 stop and propose a cohesive split, leaving review-fix headroom. No published PR may have 100 or more changed paths. Count additions, deletions, tests, fixtures, generated metadata and documentation against the actual PR base. Squashing commits does not reduce this count.

C-496 is one cross-host interpretation invariant delivered incrementally. C-505 needs its merged format from increment A, not the completion status of increment B. After PR 2, leave C-496 `in_progress` and record AC-1–AC-4 evidence; do not claim the whole contract is implemented/verified. If using automation that only understands whole-contract dependencies, use the manual gate above rather than falsely completing C-496 to unblock it.

## Common execution protocol (binding on every prompt)

### Before changes

- Read `AGENTS.md`, `.context/CONTEXT.md`, `.context/index.md`, the batch specification and applicable skills: aikami-conventions, testing, plus frontend/Svelte/backend/UI/Pixi guidance for touched code.
- Use an isolated Git worktree with the packet and the preceding merged batch. Preserve all unrelated edits. Do not use `--dirty`, destructive resets or whole-tree cleanup to obtain a baseline.
- List allowed subsystems and intended changes. Re-check the audit premise against current code; if already fixed, prove it and avoid duplicating work.
- Record base revision, baseline commands, failures and representative screenshots. Keep the comparison inputs pinned/local. Do not make CI depend on whatever the live CDN serves that day.
- If a schema decision conflicts with a contract, stop and request an amendment. A cheaper model must not silently choose an incompatible save/public format.

### Implementation

- One agent owns the batch. Work in small testable steps, not one giant generation. Do not edit another agent's checkout.
- Use deterministic schemas/importers, not new hardcoded per-view exceptions. Extend existing engine/preview/shared packages before proposing new packages.
- No whole-repo formatting, speculative frameworks, unrelated fixes or generated-file floods. Keep source assets/provenance and small fixtures reviewable; large asset publication is separate and authorized.
- No commits, pushes, PR creation/merge, deployments, R2 publication or model downloads without explicit authorization. Reading a prompt is not that authorization.
- Cap unproductive repair: one implementation attempt plus one focused repair pass; then stop for diagnosis/escalation if the same issue remains. Do not spend five cycles rewriting the same subsystem.

### Validation and handoff

- Detect affected projects before final validation. Run focused tests during development, then `validate({ test: true })` and the production journeys specified by the batch. Use project test commands from the current testing skill; do not invent a green result from an unrun task.
- Use real compiled Svelte for reactive/lifecycle checks. Unit rune polyfills cannot prove view reactivity.
- For visuals, produce the required Bun visual suite and live production captures, run AI visual assessment as required by the testing guidance, and have a human inspect gameplay-scale results. A high image score does not establish identities, alpha, timing, collision or resource ownership.
- Tests must exercise actual loader/resolver call sites and production-shaped inputs. Assert named asset/placement IDs and draw submissions in addition to screenshots.
- Append truthful evidence to each affected contract's Execution Report: AC status, base/head or worktree revision, commands/exits, artifacts, changed paths, deviations and unresolved failures. Do not mark partial work verified/completed.
- Run `/assets-verify <batch-number> [base-ref]` in a fresh session before asking for the PR. The verifier is read-only by default and returns actionable findings, not a second implementation.

## Review cadence and cost control

Treat the maintainer's CodeRabbit limits (under 100 paths and roughly one review opportunity/hour) as scheduling constraints, not a reason to merge unrelated work.

1. Finish local verification before consuming a review slot. Request one review on a stable snapshot.
2. Use drafts for preparation only if repository CodeRabbit settings actually suppress draft reviews; confirm rather than assume.
3. While waiting, prepare the next batch's fixtures/design or work on independent changes. Dependent work requires an explicit stack with the previous branch as base; do not send a PR to `main` containing its predecessor's entire diff.
4. Fix related review findings together. Material post-review changes still need review coverage; do not merge unseen changes merely to avoid the cooldown.
5. A green CodeRabbit review is not a replacement for offline restoration, actual scene verification or migration tests.

Recommended model routing: Flash for bounded implementation; selectively escalate migration/public-format decisions and difficult lifecycle debugging to a stronger model or human. Use a fresh independent verifier session. Do not fan every batch out to several expensive models. Measure accepted work, repair cycles, billed tokens and reviewer defects; no model is presumed superior without evidence on these tasks.

## Direct fixes included in PR 1 (no extra contracts)

- **Hub tag identity:** replace the divergent reconstruction in `apps/frontend/hub/src/lib/views/catalog/catalog_asset_view_model.svelte.ts` with the shared builder. Prove full nested tags and states resolve; do not duplicate path segments.
- **Equipment roles:** normalize omitted role to `front` before `(slot, role)` matching. Test production recipes with omitted role, explicit front, and distinct rear/front passes; do not collapse the pair.
- **Atlas alpha:** update `scripts/src/lib/ops/generate_emberwatch_atlas.ts` and tests so props/decor have transparent unpainted regions, terrain stays opaque, extrusion preserves RGBA and pixel-art output is lossless. Preserve frame names/rects/spacing/margins/GIDs. Never globally remove green/brown pixels.
- **Redundant map data:** clean only proven Emberwatch ground/decor duplicates. Verify the existing semantic-terrain versus baked path before removing anything; preserve collision, transitions, object IDs and intentional overhead/decals.

These fixes do not authorize PR 1 to implement C-496/C-505 early. If the actual fix requires that boundary, defer it explicitly rather than duplicating the later implementation.

## Verification matrix across batches

| Risk | Required demonstration |
|---|---|
| Catalog reorder reskins NPCs | Pinned legacy fixture → actual normalization/worker/main-thread identities; insert/reorder catalog entries |
| Duplicate outfits | Production role omission + explicit roles + rear/front pair merge |
| Opaque substrate | Alpha/padding assertions and prop over grass/dirt/indoor backgrounds |
| Different hosts interpret assets differently | Same revision/frame/origin/pass data in preview and real game |
| Partial release | Inject failure at every publication boundary; old pointer remains complete |
| Double-rendered ground | Count logical contributions, preserve valid terrain transition passes |
| Save loses doors/loot | Reorder/repack/import conversion + reload, with stable placement IDs |
| Random changes on load | Identical supported input/lock/adapter version → identical canonical scene; future plan rejected |
| Animation varies with refresh rate | Same elapsed time under differing frame schedules → same pose/timeline |
| Async/resource bugs | Delayed load, rapid changes, disposal, remount and shared-source lifetime tests |

## Approval and bookkeeping

Contracts stay drafts until reviewed. A suggested single approval message is: “Approve the current C-504, C-496, C-505 and C-506 specifications and execution order; start PR 1 implementation, but do not commit or publish.” That message is an example, not authorization already granted.

Do not edit `docs/contracts/INDEX.md` or generated `PROGRESS.md` by hand. Use normal knowledge-sync/pre-commit ownership when publication is authorized; include resulting metadata in the PR file count. Do not change contract status to satisfy a dashboard rather than actual evidence.

## Deferred follow-up

After these five PRs, decide whether component-level Hub curation/AI retrieval needs its own bounded batch. Run the existing external art experiment before integrating image-generation workflows. The future biome compiler requires its own specification and approval; neither C-505 nor a schematic JSON example permits implementing it now.
