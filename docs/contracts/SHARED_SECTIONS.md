# Shared Contract Sections

Sections below are identical across all contracts. Individual contracts
reference this file instead of inlining them. When reading a contract,
treat these sections as static reference — they are NOT part of the
contract's scope to implement, verify, or critique.

---

## Promotion Lifecycle

```
— → sandbox → integrated → release_verified
```

| State | Meaning | Evidence Required |
|---|---|---|
| `—` | Not yet assessed — default for legacy or new contracts. | None |
| `sandbox` | Feature works in a dev sandbox route (`(dev)/sandbox/...`). | Dev sandbox route exists |
| `integrated` | Feature is wired into the production route and E2E tests pass. | Production route + E2E pass |
| `release_verified` | Feature has visual tests + all ACs verified. Ready for release. | Visual suite + verified ACs |

---

## Status Lifecycle

```
draft → approved → in_progress → implemented → verified → completed
                                      ↘ verification_failed → implemented
draft → blocked
draft → superseded
```

Rules:
- `implemented`: implementer believes code is ready. Set by `/contract`.
- `verified`: independent verifier passed all mandatory ACs. Set by `/contract-verify`.
- `completed`: merged and CI passed. Set manually after merge.
- Any mandatory AC marked ⚠️ or ❌ prevents `verified` and `completed`.
- Scope changes not recorded in Amendments prevent `verified`.

---

## Testing Conventions

For testing: **Playwright** handles functional E2E (`tests/*.spec.ts`), **Bun Visual Runner** handles AI visual assessment (`src/visual/suites/*.visual.ts`). Do NOT create `*_visual.spec.ts` files or use the old `scripts/*_visual.ts` pattern. See `.pi/skills/testing/SKILL.md` for conventions.

---

## Contract Size & Split Rule

A contract should be split if it contains:
- Multiple independently releasable systems
- More than 5 acceptance criteria
- More than 2 affected projects

Split deferred phases into separate contracts rather than declaring the parent complete.
