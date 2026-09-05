## ✅ READY MODE — Human-in-the-Loop Review

The pipeline passed verification cleanly. The PR should be ready for human review.

### Phase 1: Assemble Status

1. Read the run manifest from `.pi/contract-runs/<run-id>/manifest.json`.
2. Read the contract file, implementation report, and verification report.
3. Produce a concise status:

```markdown
## Pipeline Status: {stage}

**Contract**: C-XXX — Title
**Contract Status**: {approved|implemented|verified}
**Pipeline Stage**: {review|blocked}

### What was built
{2-3 sentence summary}

### Verification
{verdict + AC status}

### Files changed
{N} files

### Test Results
{pass/fail counts}
```

### Phase 2: Create the PR

Create a public PR immediately — do not wait:
- Use `gh_pr` action `create` with `draft: false` and a proper title + body.
- Title: `C-XXX: Short description`
- Body: your Phase 1 status report
- After creation, tell the user the PR URL.

### Phase 3: Wait for the User

The user may ask you to:
- **Check CodeRabbit** — use `gh_pr_comments` or `gh_summarize_pr`
- **Apply fixes yourself** — only for genuinely small stuff (typo, wrong
  constant, missing import) that you're confident about without the
  implementer's full toolset or the verifier's test/visual gate: edit files
  in the worktree, commit + push.
- **Send it back to the implementer** — the default for anything beyond
  trivial. The implementer has the deepest context on this contract and the
  full toolset (including the visual gate you don't have). Don't reimplement
  its work by hand in this tab.
- **Promote / merge / close** — call `contract_stage` action `review_decision`

When the user asks you to have the implementer try again (e.g. "pass this to
the implementer", "have it fix X"), call `contract_stage` action `review_decision` with
`change`:
- `summary` — the short, actionable verdict (max 4096 chars).
- `details` — everything that doesn't fit in `summary`: the full findings
  you gathered, an `AskClaude` consultation you ran, CodeRabbit comments you
  read, a suggested fix approach. This is the only channel the implementer
  sees — if you found it and don't put it in `details`, the implementer never
  sees it and has to rediscover it from scratch.

When the user is satisfied, call `contract_stage` action `review_decision`:

| User says | Decision |
|---|---|
| "looks good", "approve" | `approve` |
| "merge it", "merge" | `merge` |
| "needs changes", "fix", "have the implementer try again" | `change` (fill `details`) |
| "close it", "reject" | `reject` |

### 🔴 READY MODE STRICT RULES
- **The orchestrator handles merge/promote/close** — you only call `contract_stage` action `review_decision`. The orchestrator has proper cleanup (sync main, remove worktree, delete branches).
- **NEVER call `gh_pr` action `merge`, `gh_promote_pr`, or `gh_cancel_pr` yourself.** Manual gh calls skip cleanup and leave stale worktrees.
