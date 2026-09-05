# Dependency order and parallel lanes

Read [README.md](README.md) and [dispatch.md](dispatch.md) first. P00 is the **only entry point**.
A dependency means its evidence is accepted and code is on the approved `main` baseline, not merely being written in another worktree.
Rows after P03 are scoped work packages, **not pre-approved single PRs**: write the next packet just in time and split into independently safe slices when the diff budget requires it.
No dependent agent may invent an API from an unmerged branch. Shared barrel/schema edits need an integration owner even when implementations are otherwise disjoint.

## Queue

| ID | Outcome / owner | Depends on | Executor | Exit evidence |
|---|---|---|---|---|
| P00 | [Read-only baseline](packets/00_baseline.md) | — | Flash | Approved baseline SHA, failures, task map, ownership ledger |
| P01 | [Desktop-only installation gating](packets/01_desktop_gating.md) | P00 | Flash | Browser has no native install/probe action; desktop retains entry |
| P02 | [Keyless local connection verification](packets/02_local_verification.md) | P01 | Flash | User endpoint tested without requiring a key; cloud regression |
| P03 | [Truthful provider status](packets/03_truthful_status.md) | P02 | Flash | Local identity alone never yields Running/Ready |
| P04 | Repair legacy projections through existing C-463 mutators | P02 | Flash | Add/edit/delete/role changes agree across consumers before reload |
| P05 | C-481 capability/provider/identity seam and typed API freeze | P03, P04; C-481 approved | Flash | Schema/registry/identity tests; reviewed public seam |
| P06 | C-481 canonical writes, validated loading and migration safety | P05 | Flash | Real persisted-fixture migration, failure recovery and idempotence |
| P07 | C-481 shared connection setup/test/model-discovery operations | P06 | Flash | Endpoint/auth reuse; two distinct endpoints remain distinct |
| P08 | C-481 route all consumers through canonical resolution | P07 | Flash | Text/image/TTS routing and reload parity; premium migration check |
| R01 | C-482 restricted redirects and downloader integrity | P02; C-482 approved; pilot accepted | Flash + Claude check | CDN redirects succeed; hostile redirect/path/checksum cases fail |
| R02 | C-482 shared catalog and native-vs-container model planning | R01, P05 | Flash | No Docker downgrade in native plan; compatible budgets and licenses |
| R03 | C-482 durable setup jobs, cancellation and restart recovery | R02 | Flash | Underlying transfer stops; retry/restart does not corrupt valid assets |
| R04 | C-482 owned process lifecycle, port conflicts and on-demand restart | R03 | Flash + premium check | External server untouched; correct owned process/model after restart |
| R05 | C-482 provision through canonical setup operations | R04, P08 | Flash | Install -> verify -> persist -> real text request; no duplicate registration |
| T01 | Text vertical-slice checkpoint on existing production mounts | R05 | Flash evidence; premium verifier | Existing server, online mock, packaged native text; offline reopen |
| U01 | C-483 reusable setup subflows and presentation models | T01; C-483 approved | Flash | Focused components consume shared services; no giant settings VM dependency |
| U02 | C-483 guided first-run routes and resumable presentation | U01 | Flash | Recommended/existing/text-only, review consent, back/leave/resume |
| S01 | C-484 searchable settings navigation/context filtering | P08; C-484 approved; pilot accepted | Flash | Deep links, pause behavior, keyboard/mobile and platform filtering |
| S02 | C-484 capability pages, connections and advanced routing | S01, U01 | Flash | Same setup subflows as onboarding; shared key and override tests |
| S03 | C-484 local resources and data/privacy presentation | S02, R05 | Flash | Manage owned assets; disconnect never deletes external models |
| U03 | C-483 optional image/read-aloud integration | U02, S02 | Flash | Mixed-provider setup; text-ready play survives optional failure |
| F01 | Production integration, supported-platform verification, cleanup | U03, S03 | Flash evidence; OpenAI or Claude verifier | All parent ACs, no new failures, docs and packaged journeys |

P04 is a repair of the existing model, not permission to introduce a new schema before C-481 approval.
R01 is part of C-482's reviewed security policy; do not solve it by enabling arbitrary redirects.
T01 uses the existing production UI wired to the new services; U01/U02 then improve that proven journey.
Pilot accepted means P01 and P02 have review/validation evidence and measured retry/spend results, with user agreement to continue.

## Safe parallel work (maximum two implementation agents)

| When | Lane A | Lane B | Boundary |
|---|---|---|---|
| Immediately | P00 baseline evidence | OpenAI C-481 or Claude C-482 critique, read-only | No code or baseline mutation by reviewers |
| Pilot | P01 then P02 | Read-only contract critique / scenario inventory | Do not run both pilot implementations simultaneously |
| After pilot | P03 status presentation | P04 config projection repair | Disjoint source/test files; coordinate shared preload/POM changes |
| After pilot and runtime approval | P03/P04/P05 configuration lane | R01 downloader lane | Client TS vs Rust download modules; shared exports owned by Lane A |
| After P05 and R01 | P06 -> P07 -> P08 | R02 -> R03 -> R04 | Freeze shared seam first; separate model/config storage and test files |
| After P08 | R05 -> T01 -> U01 -> U02 | S01 settings shell | S01 must not modify the capability wizard or shared setup components |
| After U01 and S01 | U02 guided route | S02 then S03 settings pages | Shared components owned by U01; later changes serialized |
| Integration | F01 verification | None changing its candidate baseline | Freeze candidate; queue unrelated implementation |

These are permissions to run at most one row's compatible pair, not permission to launch every eligible task.
If a packet needs another lane's file, stop and transfer ownership or serialize. Separate worktrees do not remove semantic conflicts.
Unit tests may run independently; real client/Tauri/GPU services and release validation are serialized unless isolated ports, profiles and resources are proven.

## Model checkpoints

- Flash means `deepinfra/deepseek-ai/DeepSeek-V4-Flash`, thinking `high`; confirm the effective settings, not just the role name.
- Before P05: one OpenAI architecture/migration critique of C-481; approve the seam once.
- Before R01: one Pro-authenticated Claude Opus critique of C-482, especially redirects, paths, ownership and recovery.
- After P08: OpenAI checks migration fixtures, effective routing and persistence; not a second broad redesign.
- At T01: Claude or OpenAI checks actual packaged-runtime evidence; mocks do not prove packaging.
- At F01: one independent premium verifier checks the acceptance matrix; CodeRabbit still reviews each PR diff.
- Use Flash for ordinary review fixes; escalate after two failed attempts, a security invariant change, or a necessary schema/API deviation.

## Merge/review order

Only one newly review-ready PR per 60-minute slot, targeted at `main`; record the last submission time manually.
Use the queue's earliest ready dependency first, allowing an independent R/S slice into an otherwise idle slot.
Prepare at most two review-ready changes ahead; rebase and revalidate against accepted main before submission.
Each PR needs focused tests plus affected validation; parent completion additionally needs full contract evidence.
Never mark a parent implemented because one queue row passed, and never use an hourly slot to submit knowingly failing work.
