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
- `implemented`: implementer believes code is ready. Set by `/contract-implement`.
- `verified`: independent verifier passed all mandatory ACs. Set by `/contract-verify`.
- `completed`: merged and CI passed. Set manually after merge.
- Any mandatory AC marked ⚠️ or ❌ prevents `verified` and `completed`.
- Scope changes not recorded in Amendments prevent `verified`.

---

## Testing Conventions

For testing: **Playwright** handles functional E2E (`tests/*.spec.ts`), **Bun Visual Runner** handles AI visual assessment (`src/visual/suites/*.visual.ts`). Do NOT create `*_visual.spec.ts` files or use the old `scripts/*_visual.ts` pattern. See `.pi/skills/testing/SKILL.md` for conventions.

---

## Thin Contract Mode

Thin contracts are a reduced-section variant for small, well-understood fixes
(bug fixes, config changes, small refactors, doc corrections with code impact).
They keep the parts of the template that give value at any size — a stable ID,
Metadata table, Problem statement, Scope Boundaries, Acceptance Criteria,
Amendments, and an Execution Report — and drop the sections that only pay off
at feature scale.

### Thin contract section list (in order)

1. **Metadata** (adds `Type: thin` row)
2. **Problem & Baseline Evidence**
3. **User Outcome**
4. **Scope Boundaries**
5. **Acceptance Criteria** (AC list only — no per-AC Evidence Matrix/Test Hooks
   table, just Given/When/Then plus a single **Verification** line per AC)
6. **Edge Cases & Gotchas** (optional — omit if none)
7. **Amendments**
8. **Promotion Lifecycle**
9. **Status Lifecycle**

### Omitted entirely for thin contracts

Success Measures, Existing System & Reuse Map, Overview, Design Reference,
Architecture Directives, State & Data Models, Quality Requirements, Migration &
Rollback, Contract Size & Split Rule, Implementation Sequence, Open Questions.

### When to upgrade to a full contract

- A thin contract accumulates **Open Questions** during drafting → convert to full
- A thin contract's fix touches **persistent state** (schema/save format) → convert to full
- The change is not well-understood and needs Design Reference or Migration planning → convert to full

## Contract Size & Split Rule

Split on **independent mergeability**, not on size. A contract should be split
if any of these hold:

- It contains two outcomes that can each be independently **verified and
  merged** — neither needs the other to be useful.
- Partial completion would leave the repo in a **worse state** than before
  starting (half-migrated schema, two competing code paths left live).
- It spans two systems that share **no data model and no invariant**.

**AC count is not a split signal.** A cohesive change may legitimately have
10+ acceptance criteria — that reflects how carefully the work was specified,
not how much work it is. Splitting on AC count penalises good specification
and multiplies pipeline runs for a single feature.

**Affected project count is not a split signal either.** In this monorepo any
real engine feature touches `engine` + `client` + `schemas` by construction; a
vertical slice through them is one contract, not three.

Each AC MUST be independently verifiable. That is the constraint that
actually matters — it is what lets a large contract be reviewed incrementally
instead of all at once.

Split deferred phases into separate contracts rather than declaring the parent complete.
