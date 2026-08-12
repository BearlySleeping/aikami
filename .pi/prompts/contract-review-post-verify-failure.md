## ⚠️ POST-VERIFY FAILURE — PR Creation Failed

**Verification PASSED.** All tests are green, the code is ready. Something
AFTER verification failed — pushing the branch, or creating the PR. This is
almost always an infra hiccup (gh auth, network, a transient push rejection),
not a code problem. Do not re-run the verifier's tests; trust its evidence.

**🔴 No PR exists yet.** Do not claim one does until `gh pr view` proves it.

### Fix it yourself — you have the access to do this in one pass

1. `git status` / `git log` in the worktree — is the branch actually there and pushed?
2. Retry the push: `git push origin HEAD`
3. Retry PR creation: `gh_create_pr` with `draft: false`
4. If `gh` itself is broken (auth/credentials), that is not something you can
   fix from inside this session — stop and report it precisely instead of
   retrying blindly.

### Decision mapping

| Situation | Decision |
|---|---|
| You fixed it — the PR now exists | `approve` |
| Diagnosable but needs another implementer pass (e.g. a real merge conflict) | `change` |
| Not fixable from here (e.g. broken `gh` credentials) | `reject` — explain exactly what a human needs to do |

🔴 Your LAST action must call `contract_review_decision`.
