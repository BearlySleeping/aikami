# YOLO Mode Overrides — Automated CodeRabbit Pipeline

🚀 YOLO MODE is active. The `yolo_overrides.md` prompt has been injected.

## 🔴 State Awareness

At the start of this session, you were given a state JSON object. Always check it:

```json
{"mode": "YOLO", "coderabbitStatus": "<pending|completed|skipped>", "unresolvedComments": 0, "autofixCycle": 1, "maxAutofixCycles": 2}
```

- **coderabbitStatus**: `pending` → review not started; `completed` → review done; `skipped` → no fixable findings
- **unresolvedComments**: Number of actionable findings autofix couldn't fix
- **autofixCycle**: Current autofix iteration (starts at 1)
- **maxAutofixCycles**: Hard limit before YOLO degrades to manual

## 🔴 CIRCUIT BREAKER

**If `autofixCycle >= maxAutofixCycles`:** You are in the FINAL autofix cycle.
- If autofix still fails after this cycle, DO NOT loop again.
- Instead, call `contract_review_decision` with `change` and note in the summary
  that the autofix limit was hit.
- The orchestrator will degrade to manual review mode.

## 🔴 HARD RULE: CodeRabbit-Only Automation (with fallback)

You are completely forbidden from running full test suites or build commands.

Code editing and local linting/typechecking (e.g., `biome check`, `tsc`) are ALLOWED as a FALLBACK when CodeRabbit autofix fails:
- If `code_rabbit_autofix` reports that autofix could not resolve findings,
  call `code_rabbit_findings` to get the fix prompts.
- Apply fixes manually using `edit` based on the 🤖 Prompt for AI Agents.
- You MAY run local linting or typechecking to verify your manual edits.
- Commit + push (using `--no-verify`), then re-run `code_rabbit_autofix` to verify.
- Only merge when findings are resolved or judged non-blocking.

Git operations for sync + merge are ALLOWED (automation glue).
If any step fails with an infrastructure error, stop immediately, report
the diagnostic log, and call `contract_review_decision` with `blocked`.

## YOLO Execution Sequence

### Y1: Create PR
Call `gh_create_pr` with `draft: false`. Use the contract summary as body.

### Y2: Trigger + Await CodeRabbit Autofix
Call `code_rabbit_autofix` with the PR number. This SINGLE tool call:
1. Waits for CI checks to complete (no triggering mid-build)
2. Checks for duplicate autofix commands (won't re-post if already in flight)
3. Posts `@coderabbitai autofix` if needed
4. Polls until CodeRabbit pushes its autofix commit
5. Returns `autofixApplied`, `autofixSkipped`, `actionableCount`, `duplicatePrevented`

Do NOT manually post `gh pr comment` — the tool handles the trigger.
Do NOT apply manual edits unless autofix fails (see fallback below).

🔴 **AUTOFIX FALLBACK**: If `code_rabbit_autofix` reports that autofix could NOT
resolve findings (check `actionableCount > 0` in the response):
1. Call `code_rabbit_findings` to get the structured findings with fix prompts
2. Look for the "🤖 Prompt for all review comments with AI agents" section
3. Apply the fixes yourself using `edit` on each file
4. Commit + push your fixes (ensure you use `git commit --no-verify -m "..."`)
5. Call `code_rabbit_autofix` again to verify
6. Only proceed to Y3 when findings are resolved or you judge them non-blocking

### Y3: Sync Local Worktree
If `code_rabbit_autofix` returned `autofixApplied: true`, CodeRabbit pushed changes
directly to the remote branch. Your local worktree is now stale. You MUST sync it:

```bash
git fetch origin <headBranch>
git reset --hard origin/<headBranch>
```

Skipping this step causes non-fast-forward errors when the orchestrator
tries to finalize the merge.

### Y4: Merge + Cleanup
You are the merge authority. The orchestrator will handle the final worktree cleanup.

1. Call `gh_merge_pr` with the PR URL:
   `gh_merge_pr({ pr: "<url>", method: "squash" })`
   🔴 If merge fails with "worktree" error, run gh from the main repo:
   `cd /path/to/main/repo && gh pr merge <num> --squash`
2. Verify the merge succeeded (check the return value / output).
3. 🔴 Delete the remote branch yourself:
   `git push origin --delete <headBranch>`
4. Call `contract_review_decision` with `merge` as the final signal. Do NOT attempt to remove the worktree yourself.

Do NOT run `validate()` or full test suites — CodeRabbit verified its autofix
commit on its own platform. Trust CodeRabbit's platform verification.

## 🔴 SYNC GUARDS (built into code_rabbit_autofix)

The `code_rabbit_autofix` tool now has built-in guards:
1. **CI check gate**: Waits for all PR checks before triggering autofix
2. **Duplicate prevention**: Checks if `@coderabbitai autofix` was already posted
3. **State detection**: Reads CodeRabbit's reply to know if autofix applied/skipped/failed/rate_limited
4. **Post-autofix verification**: Returns `autofixApplied` / `autofixSkipped` flags

You should NOT manually gate these — the tool handles them. Just check the
returned `autofixApplied`, `autofixSkipped`, and `actionableCount` fields to decide next steps.

### Handling Tool Bails (Rate Limits & CI)
If `code_rabbit_autofix` returns `autofixSkipped: true`, check the `reason` field:
- If `reason === 'rate_limited'`: STOP immediately. Call `contract_review_decision` with `blocked` and state that CodeRabbit is rate limited.
- If `reason === 'ci_checks_running'`: Do NOT fail. Wait/sleep for 2 minutes, then call `code_rabbit_autofix` again to re-check.

## 🔴 FINDINGS GATE

Before merging, always check the `actionableCount` from `code_rabbit_autofix`:
- `actionableCount === 0` → safe to merge
- `actionableCount > 0` → call `code_rabbit_findings`, judge if blocking, then decide
