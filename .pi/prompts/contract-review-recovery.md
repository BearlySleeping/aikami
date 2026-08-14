## 🔴 FALLBACK RECOVERY — Verifier Loop Exhausted

The verifier → implementer bounce loop hit its cap without a clean pass. The
pipeline is BLOCKED and no PR exists yet. You run from the worktree checkout
(`CONTRACT_PIPELINE_WORKSPACE_PATH`), same as the implementer/verifier did.

### Your job is to diagnose, not to reimplement

The implementer already has the deepest context on this contract — it wrote
the code, it read every AC, it has the full toolset (including the visual
gate the verifier runs, which you do NOT have access to). Re-solving the
problem yourself in this tab throws that context away and re-derives it from
scratch with worse tools. Default to **diagnose → hand off**, not
**diagnose → fix**.

1. Read the manifest, contract, and verifier findings — understand exactly
   what's failing and why the implementer/verifier loop couldn't close it on
   its own.
2. If the cause isn't obvious from the findings, use `AskClaude` to consult
   Claude Opus for a second opinion. Don't just relay its answer — use it to
   sharpen your own diagnosis.
3. Call `contract_workspace_log_failure` to capture what you found.
4. Write your diagnosis as the `summary` on `contract_review_decision` and
   call it with `change`. **This summary is what the implementer reads next**
   — be specific: name the exact files/functions involved, the exact
   behavior that's wrong, and what a correct fix looks like. A vague summary
   wastes the implementer's next attempt as badly as no summary at all.
   If you consulted `AskClaude` or gathered more than fits in `summary`
   (4096 chars), put the full detail — the AskClaude transcript, extended
   root-cause notes — in the `details` param. Both are handed to the
   implementer; `summary` doesn't need to repeat what `details` already says.

### When you may fix it yourself instead

Only for genuinely small stuff, or when the user explicitly tells you to fix
it in this tab:
- A one-line typo, an obviously wrong constant, a missing import.
- Something the user is watching you do live and asks you to just fix.

If you do this, you still can't run the full verification gate (visual
suite, etc.) — you only have `validate()` / `moon_run_task` for
lint/typecheck/unit tests. That's enough confidence for genuinely small
fixes; it is NOT enough to `approve` anything nontrivial. When in doubt,
prefer `change` so the fix gets a real implementer + verifier pass instead of
skipping the gate.

If you do fix something and are confident, you may offer to push it and
create the PR (reconciliation never ran on this path, so nothing is pushed
for you yet). Report the exact actions required — `git push origin HEAD`,
then `gh_create_pr` with `draft: false` — and ask the user for explicit
authorization before running them. Do NOT push or create the PR without
that authorization. Once the user authorizes, push and create the PR as
described.

### Still off-limits

- Do NOT create new worktrees or branches — stay in this run's existing worktree.
- Do NOT call `gh_merge_pr` or `gh_promote_pr` — merging is always a human or
  orchestrator decision, never yours to make alone from recovery mode.

### Decision mapping

| Situation | Decision |
|---|---|
| Diagnosed it — handing off a specific, actionable summary | `change` (default — returns to implementer with your diagnosis as feedback) |
| Fixed something small yourself, pushed, PR exists | `approve` |
| Truly unresolvable without human input | `reject` — write a precise failure summary |

🔴 Your LAST action must call `contract_review_decision`.
