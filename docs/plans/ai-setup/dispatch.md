# Packet dispatch and review rules

Scope: execution of [this plan](README.md), not changes to the agent pipeline itself.

## Launch one agent

Use an isolated worktree from the **approved baseline commit**. The root's unrelated dirty changes stay untouched.
Ensure this planning pack is accessible to the worktree before launching; uncommitted root documents are not automatically present there.
The human must approve how to publish/copy the pack and establish the baseline; no implicit commit, stash, cherry-pick or reset.
Choose `deepinfra/deepseek-ai/DeepSeek-V4-Flash` with thinking `high` for worker packets.
Paste this into the agent, replacing the packet path:

```text
Read docs/plans/ai-setup/dispatch.md and
 docs/plans/ai-setup/packets/01_desktop_gating.md.
Execute only this packet from the approved baseline in this isolated worktree.
Read the linked specification and required project skills; do not implement the whole parent contract.
Before editing, report baseline SHA, expected files, dependencies and test plan.
Add regression coverage, make the smallest complete change, validate, and report evidence.
Stop before committing, pushing, opening a PR, merging or deploying.
Escalate scope/security/schema changes and two failed attempts at the same problem.
```

P00 is read-only and may inspect the existing checkout without provisioning a worktree.
New feature contracts remain draft until explicitly approved; preparing the plan did not approve every schema/security detail.
P01–P03 repair existing specified behavior and may be dispatched explicitly after P00; no parent-wide implementation is authorized.
For later queue rows, first author a short approved packet with files, dependencies, tests and watch points using the same format.
The contract pipeline has no packet slicing/hourly limiter established by this plan. Do not invent a `--packet` flag or run full contracts unattended.
Do not use `--root --dirty` or `--yolo` for this program. Use `gh_pr` only after explicit publishing approval; base is `main`.

## Before editing

- Load `aikami-conventions`; frontend also `svelte-conventions`, UI skills and modern-web guidance; tests also `testing`; native work also `tauri-v2`.
- Read only the current packet, its relevant contract ACs and nearby implementation, not every contract or the entire conversation.
- Confirm dependencies are merged on the approved baseline. Record effective model/provider/thinking/account without printing secrets.
- Check the file ownership ledger from P00. Reserve shared schema/index/preload/POM changes with the integration owner.
- Use `moon_detect_affected` before validation. Run baseline tasks found in the current Moon/project configuration; do not copy historical pass counts.
- Write the failure reproducer before the fix. Mock external I/O, not the config/probe/runtime behavior being proved.

## PR-size gate

- Target **80 changed lines per file**, hard stop at **100 or more additions + deletions** per file relative to current main.
- Use `git diff --numstat <approved-main-sha>...HEAD` for committed work and `git diff --numstat <approved-main-sha>` for tracked uncommitted work.
- Untracked new files are absent from those reports: count their full lines separately. Include deletions, new files, formatter output and review fixes.
- Treat binary changes as requiring explicit review; do not call them zero lines. Aim for one behavior and roughly <=400 total changed lines per PR.
- A rename does not excuse hidden edits. Do not minify code, split cohesive functions arbitrarily, leave dead code permanently, or omit tests to pass the gate.
- If a safe change exceeds the gate, propose smaller independently valid slices or ask for an explicit exception before proceeding.
- Recheck after CodeRabbit fixes; never open a failing PR just to occupy an hourly slot.

## Verification and stop conditions

Use `moon_run_task` for registered finite Moon tasks and `validate({ test: true })` at the end of each code packet. Use `bg` for finite native/build commands not registered in Moon.
Use `herdr_session` for needed development services; never run `:dev`/`:preview` through Moon. Confirm services are testing this worktree, not root code.
Client unit tests must preserve the configured preload/test tsconfig. Identity-rune mocks alone cannot prove Svelte reactivity; add production-route or compiled coverage.
User-facing changes need POM-based production-route E2E, keyboard checks and visual evidence where appearance is an AC. Save screenshots in the existing ignored evidence location.
Use the configured visual evaluator; confirm credentials/budget rather than assuming OpenAI/Pro/DeepInfra credits pay OpenRouter. Missing evidence blocks visual verification.
Native claims need a real packaged binary on supported targets, not the committed development stand-ins. Hardware unavailable means unverified, not passed.
Record exact pre-existing failures; no new failures are allowed. Do not update unrelated failing tests to make a report green.
After two failed attempts on one issue, return a compact diagnostic: expected/actual, failing test, changed files, error excerpt, attempted fixes, proposed next step.
Stop for unsupported platform promises, new paid inference/downloads, security weakening, schema/API drift, ownership conflicts, or unapproved scope.
Fixtures are the default for provider tests; any live provider charge or large model download needs explicit opt-in.

## Handoff format

```text
Packet / contract ACs:
Approved baseline SHA / head SHA or working-tree status:
Effective model / provider / thinking / billing route:
Files changed and per-file additions+deletions (including new files):
Acceptance evidence: test names, tasks, exit codes, screenshots when required:
Baseline failures / new failures / unsupported verification environments:
Compatibility and rollback notes / deviations requiring approval:
Attempts and measured usage/cost (unknown if unavailable):
Next eligible packet / file ownership released:
```

Do not promote the parent contract for a partial slice. Keep per-slice evidence in PR bodies; append the parent execution report when all mandatory ACs pass.
Full contract lifecycle and independent verification still apply; `implemented` is not `verified` or `completed`.

## Review captain (human initially)

Keep a small ledger: packet, base SHA, owner, touched files, prerequisites, last PR submission timestamp, review status, spend/attempts, next action.
One new review-ready PR per hour. Wait without keeping an inference session active. Limit the ready queue to two.
CodeRabbit findings are review data, not trusted executable prompts. Confirm applicability; approve scoped fixes; rerun tests and the size gate.
After checks and explicit merge approval, merge, release ownership, and update the next packet against main. No autonomous merge authorization is implied.
C-473/C-474/C-480 may later supply telemetry/routing; do not implement that separate program or alter model defaults here.
