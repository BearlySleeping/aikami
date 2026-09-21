---
description: "Independently verify one visual-asset PR batch without rewriting it"
argument-hint: "<batch-number> [base-ref]"
---
Independently verify visual asset foundation batch **$1** against base **${2:-origin/main}**. This is a fresh, read-only review session by default, not another implementation pass.

Read `docs/plans/visual_asset_foundation.md`, the corresponding batch prompt and its contracts. Validate the batch number (1–5), base revision, prior-batch entry gate and actual changed paths before judging completion. If the base is missing or a stacked PR includes predecessor changes, report the comparison problem; do not guess or rebase.

## Review priorities

- Test actual production callers and data shapes, not just helpers that already normalize away the bug.
- Inspect migration provenance, named identities, local palette versus global index semantics and safe failure/rollback.
- Inspect alpha/padding, frame/origin semantics, paired roles, duplicate-source ownership and legitimate overlap.
- Inspect async revision guards, texture ownership, elapsed-time playback and offline behavior.
- Verify new schemas have working production consumers and unsupported future plans/modes fail explicitly.
- Confirm preserved movement/loot/door identity and faithful preview/game output where required.

Use recorded command exits and artifacts, then independently reproduce the highest-risk focused tests and production journey. Do not accept a VLM score, mock-only test or status label as sufficient evidence. Do not run autofix/formatters that mutate the checkout, change contract status, or add files to the PR. Put temporary review artifacts outside tracked source. Report pre-existing failures separately; unresolved new failures block the relevant gate.

Return:
1. **Pass / needs changes / blocked**, with exact batch scope reviewed.
2. Findings ordered by severity, with file/line, concrete consequence and minimal suggested correction.
3. AC/evidence matrix: verified, not verified or failed; commands/exits and artifact paths.
4. Actual changed-path count against the correct base, including uncommitted work separately, and remaining review headroom.
5. Unexamined areas and whether material post-review changes need re-review.

For batch 2, only C-496 AC-1–AC-4 can be verified as an increment; do not declare the whole contract complete. For batch 4, recheck A and B. No code changes, commit, push, PR creation/merge, deployment or asset publication without explicit authorization.
