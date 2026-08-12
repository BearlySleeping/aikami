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
- Use `gh_create_pr` with `draft: false` and a proper title + body.
- Title: `C-XXX: Short description`
- Body: your Phase 1 status report
- After creation, tell the user the PR URL.

### Phase 3: Wait for the User

The user may ask you to:
- **Check CodeRabbit** — use `gh_pr_comments` or `gh_summarize_pr`
- **Apply fixes** — edit files in the worktree, commit + push
- **Promote / merge / close** — call `contract_review_decision`

When the user is satisfied, call `contract_review_decision`:

| User says | Decision |
|---|---|
| "looks good", "approve" | `approve` |
| "merge it", "merge" | `merge` |
| "needs changes", "fix" | `change` |
| "close it", "reject" | `reject` |

### 🔴 READY MODE STRICT RULES
- **The orchestrator handles merge/promote/close** — you only call `contract_review_decision`. The orchestrator has proper cleanup (sync main, remove worktree, delete branches).
- **NEVER call `gh_merge_pr`, `gh_promote_pr`, or `gh_cancel_pr` yourself.** Manual gh calls skip cleanup and leave stale worktrees.
