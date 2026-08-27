---
name: contract-calibration
description: >-
  Decide WHETHER something needs a contract, and how heavy it should be, before
  writing one. Load when the user asks for contracts covering several things at
  once ("write contracts for all of this", "set up contracts for X, Y and Z"),
  when a request could be satisfied by just doing the work, or when you are
  about to produce more than two contracts in one pass. Pairs with
  contract-implementer, which covers executing a contract that already exists.
version: 1.0.0
tags: ["aikami", "contracts", "planning", "delegation", "process"]
---

# Contract Calibration

**A contract is a delegation artifact, not a record of thinking.** Its job is to
let someone else — usually a cheaper model — do work correctly without the
context you have. If nobody else is going to implement it, or the work is
self-evidently correct on reading the diff, a contract is overhead.

Writing a full contract routinely costs **more output than the code it
describes**. That trade is worth it when the contract prevents a trap. It is
pure waste when it narrates an obvious change.

## 🔴 When the user asks for "contracts for all of this"

**Do not write N full contracts by reflex.** Triage first, then propose the
split and get agreement before writing.

1. **Check what already exists.** `ls docs/contracts/` and
   `grep -ril "<topic>" docs/contracts/`. A surprising amount is already
   specified, in progress, or implemented. Never write a contract that
   duplicates a live one.
2. **Sort the items into the three tiers below.**
3. **Say the split out loud**, with a one-line reason per item, and ask before
   writing. A batch of seven where three should have been "just do it" wastes
   an hour of review, not just tokens.

## The three tiers

| Tier | Use when | Shape |
|---|---|---|
| **Full contract** | Touches persisted state, a public boundary, a documented invariant, or crosses apps | Full `TEMPLATE.md` |
| **Thin contract** | Mechanical, but expensive if done wrong | ~60 lines: Problem, ACs, Scope Boundaries, Watch Points |
| **Just do it** | Prose, docs, obvious reversible fixes, single-file cleanups | No contract. Do the work, show the diff |

### Full contract — the test

Write a full contract if **any** of these is true:

- **Persisted state changes shape or meaning.** Saves, schemas, cache keys,
  published asset tags, URL formats. Anything a user's existing data depends on.
- **An ordering or indexing invariant exists.** If "the order of this list" or
  "the value of this index" is load-bearing for old data, that fact must be
  written down with a test attached.
- **A public boundary moves.** Package exports, wire schemas, published object
  layout, route contracts.
- **A documented invariant is affected** — anything asserted in `CLAUDE.md`, a
  prior contract, or user-facing docs. Changing the code without changing the
  claim leaves the next contract starting from a false premise.

### Thin contract — the test

Mechanical work where the *result* is obvious but a specific mistake would be
costly: an import boundary, a package split, a route addition, a component
extraction. Write the Problem, the ACs, the out-of-scope list, and the Watch
Points. Skip Overview, Design Reference, Success Measures, and Migration when
they would restate what the ACs already say.

### Just do it — the test

- Documentation, comments, marketing copy, changelogs.
- Renames, dead-code deletion, dependency bumps.
- Anything where you would be able to review the diff and know it is right.
- Anything the user could have asked for as "fix this" rather than "spec this".

For these, **offer to do it now** rather than proposing a contract. Say plainly
that you would not contract it and why. If the scope you discovered is larger
than what the user asked for, name the new scope and get one confirmation —
then do the whole thing.

## Prefer a prompt over a contract

When work needs delegating but does not need a durable spec, write a **prompt**
instead — a short, self-contained instruction with the file paths, the
constraint, and the check. Prompts belong in `.pi/prompts/` when reusable, or
in the conversation when one-shot.

Use a prompt when:

- The work is a repeated shape (regenerate a fixture, sweep a rename, update a
  doc set) rather than a design decision.
- The value is in *what to touch*, not *what to be careful about*.
- Nobody will need to read it again in three months.

Use a contract when the answer to "what will bite the implementer?" is
non-obvious and worth preserving.

## What earns length in a contract

For a delegated implementer — especially a cheaper model — the sections that
carry the value are:

| Section | Why it earns its length |
|---|---|
| **Watch Points** | The traps. This is the single highest-value section |
| **Migration & Rollback** | Writing it is what *surfaces* data-compat traps you would otherwise ship |
| **Scope Boundaries → Out of Scope** | Stops scope creep and "helpful" adjacent refactors |
| **Acceptance Criteria** | Each must be independently verifiable — that is the real constraint |
| **Problem & Baseline Evidence** | Concrete file:line and command output, so the implementer can confirm the premise still holds |

Sections to cut hard when the tier is thin: Overview, Design Reference,
Success Measures, User Outcome. A capable implementer infers these; they mostly
restate the ACs in prose.

### Evidence this works

Two ACs from the C-442…C-448 batch that only existed because the template
forced the question, and that would each have shipped silent damage:

- **C-442 AC-3** — derived LPC variant ordering must match the legacy generated
  ordering, proven against a fixture recovered from git history. Saves store
  1-indexed variant numbers; a different order silently re-skins every existing
  character. Surfaced by writing *Migration & Rollback*, not by coding.
- **C-448 AC-2** — the published `urlPrefix` must stay `/content-packs` even
  though the source directory moved to `content/packs`. A "tidy the path while
  I'm here" instinct would have re-tagged every pack asset and invalidated every
  cached copy on every install. Surfaced by writing *Watch Points*.

Neither is a design decision. Both are traps. That is what contracts are for.

## Batch hygiene

When a batch is genuinely warranted:

- **Order by dependency and say so.** If A removes the reason B's duplication
  exists, A must land first — write that in the batch's sequencing rules.
- **Mark exactly one entry point.** The reader should know what to start on.
- **Record rejected alternatives inside the contract that rejects them**, with
  the evidence. "We considered splitting into three packages and did not,
  because <13 files / these specific cross-cutting edges>" is worth more than a
  clean spec of the thing you did build.
- **Resolve Open Questions before handing off.** A delegated implementer cannot
  make a judgment call it lacks the context for; an unresolved question becomes
  an invented answer. Write the decision and its date.

## Anti-patterns

- ❌ Writing seven full contracts because the user listed seven things.
- ❌ A contract for a documentation change.
- ❌ Duplicating a contract that already exists — check first.
- ❌ Uniform density: a 500-line contract for a one-file import fix.
- ❌ Leaving Open Questions unresolved in a contract meant for delegation.
- ❌ Padding Overview and Design Reference to look thorough. Length is not rigor.

## Related

- `contract-implementer` — executing a contract that already exists
- `docs/contracts/TEMPLATE.md` — the full template
- `docs/contracts/SHARED_SECTIONS.md` — split rules, status and promotion lifecycle
