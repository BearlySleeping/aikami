# Contract Backlog — C-485 onward (external review response)

> **Purpose**: a hand-off doc, same pattern as
> [`BACKLOG_C452_PLUS.md`](BACKLOG_C452_PLUS.md) and
> [`MVP_BACKLOG.md`](MVP_BACKLOG.md). Each seed has enough (title, problem
> with verified `file:line` evidence, target files, priority, dependencies,
> acceptance gate, explicit out-of-scope) for a drafting agent — **DeepSeek V4
> Flash** for this batch — to expand into a contract via
> `bun run contract C-XXX --root --critique` without re-deriving the "why".
>
> **Source**: external architecture/product review of Aikami by `gpt-6-astra`,
> 2026-09-06. Every code claim below was independently re-verified against
> `main` at `eacfc371` before being written down — line numbers are current.
>
> 🔴 **ID allocation caveat** (same one the other two backlogs document):
> `prepareDirectSource` computes the next ID as `maxId + 1` from contract
> filenames **on disk**, not from this doc. `C-485` is correct as of
> 2026-09-06 (`C-484` is the highest on disk). Re-check
> `ls docs/contracts/ | grep -oE '^C-[0-9]+' | sort -t- -k2 -n | tail -1`
> before authoring each seed, since earlier seeds will have claimed IDs by
> the time later ones are drafted.
>
> 🔴 **Run `bun run contract` from `main`**, not from a feature-branch
> worktree — a worktree misses the approval commit.

Taken from docs/research/astra-game-review.md

---

## The one finding that reorders everything

The review's central claim is that Aikami has _"more definitions of
'implemented' than convincing evidence of 'fun'."_ That is not a vibe. It is
a mechanical property of the current pipeline, and there is a clean proof:

**[C-456](C-456-group-chat-and-systemic-npc-interactions.md) is
`status: implemented` with 5/5 ACs ✅ and 22/22 unit tests passing — for a
feature with zero production callers.** `generateMultiNpcResponses()` and
`selectGroupParticipants()`
(`apps/frontend/client/src/lib/services/npc/autonomous_message_service.svelte.ts:425`,
`:444`) are referenced only by their own interface declaration and by
`autonomous_message_service.test.ts` / `autonomous_message_group.test.ts`.
No production code path invokes either.

The template already anticipated this — the Evidence Matrix has a
**Production Path** column. Nothing enforces it:
`scripts/src/lib/ops/lint_contracts.ts:494` checks only that the _section
exists_, never that the column is filled with a real route.

So Phase 0 fixes the measurement first. Otherwise the twelve contracts below
can all ship exactly the way C-456 did.

---

## Verified baseline (re-check before drafting; do not re-derive)

| #    | Finding                                                                                                   | Verified location                                                                                                                                                                                                                                  |
| ---- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V-1  | Free-text skill checks use a hardcoded `0` ability modifier                                               | `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte.ts:1309` — `const modValue = 0; // TODO: read from character sheet when available`                                                                |
| V-2  | Same path omits `playerContext`; the service defaults to "Level 1 Fighter"                                | same file; default in `npc_dialogue_service.svelte.ts`                                                                                                                                                                                             |
| V-3  | Production NPC persona is a single generic line                                                           | `apps/frontend/client/src/lib/services/game/npc_dialogue_service.svelte.ts:1615` — `` persona: `You are ${npcName}, a character in a fantasy world.` ``                                                                                            |
| V-4  | Content-pack NPCs carry no personality/agenda/knowledge                                                   | `content/packs/emberwatch/manifest.json` — each NPC has only `name`, `defaultDialogueKey`, `appearanceLayers`, `isVendor`, `initialSuggestions`                                                                                                    |
| V-5  | Emberwatch is 3 maps / 3 NPCs / 1 quest / 1 encounter / 7 items / 18 dialogues / 3 factions, no companion | `content/packs/emberwatch/manifest.json` v3.2.0                                                                                                                                                                                                    |
| V-6  | Group-chat methods have no production callers                                                             | `autonomous_message_service.svelte.ts:425`, `:444` — tests only                                                                                                                                                                                    |
| V-7  | Memory query takes the **keyword-overlap** branch precisely when entries _have_ embeddings                | `apps/frontend/client/src/lib/services/memory/local_embedding_backend.ts:174-182` — `if (hasPrecomputedEmbeddings) { /* use keyword overlap scoring */ }`. The condition is inverted relative to the service's documented behaviour                |
| V-8  | The pure rules kernel has no callers outside its own file                                                 | `packages/shared/utils/src/lib/rules/rules_kernel.ts:293` (`resolveCommand`), only self-referenced at `:331`                                                                                                                                       |
| V-9  | `trust_change` and `relationship_update` are validated then **dropped**                                   | `apps/frontend/client/src/lib/services/game/npc_dialogue_service.svelte.ts:1889` and `:1954` — both `push` to `valid` with no state mutation, while sibling cases (`flag_set`, `inventory_grant`) do call `questStateService` / `inventoryService` |
| V-10 | Branch switching restores message arrays only                                                             | `dialogue_overlay_view_model.svelte.ts:1624` (`createBranch`), `:1654` (`switchBranch`) — `messages`/`_baseMessages` copies, no inventory/quest/relationship/RNG restore                                                                           |
| V-11 | Release gate's start-button matcher cannot match the real label                                           | `apps/e2e/tests/client/release_gate.spec.ts:64` matches `/new game\|start\|play/i`; the production start menu renders **"New Adventure"** (`apps/frontend/client/src/lib/views/start/start_view.svelte:90`)                                        |
| V-12 | Release gate's combat leg is conditional                                                                  | `release_gate.spec.ts:116-121` — `if (inCombat) { ... }`                                                                                                                                                                                           |
| V-13 | Release gate's "HP preserved" assertion only checks positivity                                            | `release_gate.spec.ts:476` captures `hpBefore`, `:500` asserts `expect(hpAfter).toBeGreaterThan(0)` — never compares the two                                                                                                                       |
| V-14 | LPC loader hardcodes a single animation state                                                             | `packages/frontend/engine/src/game_world.ts:3532` — `const stateStr = 'walk'; // default state for engine`; geometry inferred from texture dimensions in `packages/shared/lpc/src/lib/sheet_geometry.ts`                                           |
| V-15 | Evidence Matrix "Production Path" is unenforced                                                           | `scripts/src/lib/ops/lint_contracts.ts:494-505` — presence check only                                                                                                                                                                              |

### Already covered — do NOT write new contracts for these

- **Onboarding / provider-first setup / infrastructure terminology** (review
  §6): [C-483](C-483-guided-ai-setup.md) (`approved`) and
  [C-484](C-484-capability-first-settings.md) (`approved`) already specify the
  short text-only path, optional artwork/read-aloud, capability-first settings
  and the "Character / Adventure / Voice" terminology reframe. They are
  drafted and unimplemented — **implement them, do not re-contract them.**
- **BYOK 60-second onboarding**: [C-458 seed in
  `BACKLOG_C452_PLUS.md`](BACKLOG_C452_PLUS.md) + the distribution strategy doc.
- **Reference-platform choice / Docker-not-default** (review §2): the
  web-vs-desktop × BYOK-vs-local-engines matrix in
  `docs/strategy/distribution-and-onboarding-2026-08-19.md` §1 already frames
  this. It needs a **decision**, not a contract.

---

## Ordering

```
Phase 0 — fix the measurement (blocks nothing conceptually, gates everything in practice)
  C-485 ─ production-path evidence gate  ─┐
  C-486 ─ unconditional release journey  ─┘ independently mergeable, do both first

Phase 1 — restore trust (the character sheet and the world must not lie)
  C-487 ─ skill checks honour the character sheet
  C-488 ─ authored NPC identity in the content pack   ──┐
  C-489 ─ one authority path for consequences         ──┤ C-489 depends on C-487
  C-490 ─ branching honesty (thin)                      │

Phase 2 — depth (the review's "one conversation that changes tomorrow")
  C-491 ─ committed narrative event record   ← depends on C-489
  C-492 ─ memory retrieval correctness       ← depends on C-491
  C-493 ─ group scene wiring (thin)          ← depends on C-488
  C-494 ─ one companion who reacts           ← depends on C-488, C-491, C-492
  C-495 ─ Emberwatch dramatic structure      ← depends on C-488, C-491, C-494

Phase 3 — presentation (parallelisable with Phase 2 once C-488 lands)
  C-496 ─ sprite atlas + animation manifest import
  C-497 ─ camera framing and default-asset review (thin)
  C-498 ─ preset-first character creation (thin)
```

**The milestone that matters** is the review's own: after C-495, a player
learns something specific, makes a consequential promise or threat, resolves
it with their real character sheet, causes a validated state change, sees an
immediate reaction, leaves, saves, reloads, returns to a changed interaction,
and has a companion acknowledge what happened. C-486's journey spec is where
that gets asserted end to end.

---

# Phase 0 — Fix the measurement

## C-485 — Enforce a production path in the Evidence Matrix

| Field           | Value                                                                                                                                                                                                                                                                                         |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Priority**    | P0 — every contract after this one inherits the bar it sets                                                                                                                                                                                                                                   |
| **Type**        | full                                                                                                                                                                                                                                                                                          |
| **Target**      | `docs/contracts/TEMPLATE.md`, `docs/contracts/THIN_TEMPLATE.md`, `docs/contracts/SHARED_SECTIONS.md`, `scripts/src/lib/ops/lint_contracts.ts`, new `scripts/src/lib/ops/guard_orphaned_capability.ts` + baseline JSON, `package.json` `guard:all`, `.pi/skills/contract-calibration/SKILL.md` |
| **Depends on**  | None                                                                                                                                                                                                                                                                                          |
| **Docs impact** | internal                                                                                                                                                                                                                                                                                      |

### Problem & baseline evidence

`lint_contracts.ts:494-505` accepts any contract that contains the literal
string `**Evidence Matrix**`. It never inspects the **Production Path**
column. The result is V-6: C-456 reached `implemented` with every AC green
and no production caller for the capability it shipped. C-457–C-460 shipped
through the same gate and should be re-audited under the new rule.

The failure mode is specific and repeatable: an AC phrased as _"`X()` returns
N participants — verified by unit test"_ is independently verifiable, satisfies
the template, and proves nothing about whether a player can ever reach `X()`.

### Acceptance gate

1. Given a contract whose Evidence Matrix has an empty or `TBD` **Production
   Path** cell on every row, when `lint_contracts.ts` runs at `approved` or
   later, then it fails with a message naming the offending ACs. A row may
   opt out only with an explicit `N/A — <reason>`, and at least one AC per
   contract must carry a real production route or a named production entry
   point.
2. Given an exported service method in `apps/frontend/client/src/lib/services/**`
   whose only non-declaration references are in `*.test.ts` files, when
   `guard_orphaned_capability.ts` runs, then it is reported. Existing
   offenders go in a baseline JSON (same pattern as
   `guard_service_conventions_baseline.json`) so the guard lands green and
   ratchets; **C-456's two methods must be listed in the baseline with a
   comment pointing at C-493**, not silently absorbed.
3. Given `TEMPLATE.md`, when read by a drafting agent, then the AC section
   states in one line that a unit test alone cannot satisfy an AC for a
   player-facing capability.
4. Given C-456 through C-460, when re-audited against rule 1, then each gets
   an Amendment row recording which ACs lacked a production path (status is
   **not** rolled back — record the gap, do not rewrite history).

### Out of scope

- Rewriting the ACs of already-implemented contracts.
- Changing the status lifecycle or the promotion states themselves.
- Any new pipeline stage; this is a lint/guard change, not an orchestration change.

### Notes

Keep the guard's AST work minimal — a reference count per exported symbol,
split by whether the referencing file matches `*.test.ts` / `__tests__/`, is
enough. Do not attempt call-graph reachability; false confidence there is
worse than the simple heuristic.

---

## C-486 — Replace the conditional release gate with one unconditional journey

| Field           | Value                                                                               |
| --------------- | ----------------------------------------------------------------------------------- |
| **Priority**    | P0 — the gate currently cannot fail for the reasons it exists                       |
| **Type**        | full                                                                                |
| **Target**      | `apps/e2e/tests/client/release_gate.spec.ts`, `apps/e2e/src/pom/game_page.ts`       |
| **Depends on**  | None (but C-495 will extend the journey later — leave the spec structured for that) |
| **Docs impact** | internal                                                                            |

### Problem & baseline evidence

Three independent weaknesses, all verified (V-11, V-12, V-13):

- `:64` — `getByRole('button', { name: /new game|start|play/i })` cannot match
  the production label **"New Adventure"** (`start_view.svelte:90`). Whatever
  this currently matches, it is not the front door the player uses.
- `:116-121` — combat runs only `if (inCombat)`. A build that never enters
  combat passes the combat leg.
- `:476` / `:500` — `hpBefore` is captured and never used; `hpAfter` is only
  asserted `> 0`. A save/load that resets HP to full passes "HP preserved".

`test.skip` at `:176` (offline AI requires Ollama) is legitimate and stays.

### Acceptance gate

1. Given the production start menu, when the gate runs, then it clicks the
   real "New Adventure" affordance via the POM — and the POM asserts the
   label exists rather than falling back to a permissive regex.
2. Given the demo adventure, when the gate runs, then combat is entered
   **unconditionally** and the run fails if combat cannot be reached.
3. Given a save/reload, when HP is compared, then the assertion is
   `hpAfter === hpBefore` (exact), not `> 0`. Same for inventory count and
   quest objective state.
4. Given any leg of the journey whose UI is absent, when the gate runs, then
   it **fails** — no `if (present)` guards remain in the spec. Deliberate
   environment skips must be `test.skip` with a stated reason at the top of
   the block.
5. Given the whole spec, when it runs against `main`, then it passes; if it
   does not, the failures are real product bugs and are filed as separate
   thin contracts rather than re-softened into conditionals.

### Out of scope

- Adding new journey steps for features that do not exist yet (companion
  acknowledgement, epilogue) — C-495 extends this spec.
- Visual/AI assessment suites (`*.visual.ts`).
- Fixing whatever product bugs the tightened gate surfaces; file them.

### Notes

AC-5 is the one that will hurt and is the point of the contract. Budget for
the gate going red on first tightening. Do not let the implementer "fix" a
red gate by loosening an assertion — call that out in Watch Points.

---

# Phase 1 — Restore trust

## C-487 — Free-text skill checks honour the real character sheet

| Field           | Value                                                                                                                                                                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Priority**    | P0 — this teaches players their character sheet is decorative                                                                                                                                                                                       |
| **Type**        | full                                                                                                                                                                                                                                                |
| **Target**      | `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte.ts` (~`:1309`), `apps/frontend/client/src/lib/services/game/npc_dialogue_service.svelte.ts`, `packages/shared/utils/src/lib/rules/rules_kernel.ts` |
| **Depends on**  | None                                                                                                                                                                                                                                                |
| **Docs impact** | user-facing                                                                                                                                                                                                                                         |

### Problem & baseline evidence

V-1: `const modValue = 0; // TODO: read from character sheet when available`
at `dialogue_overlay_view_model.svelte.ts:1309` — the free-text skill-check
path rolls with a flat `+0` regardless of ability scores. V-2: the same
caller omits `playerContext`, so the service substitutes a default
"Level 1 Fighter" persona for the player.

Character creation asks for class, ability scores, background, equipment and
personality (C-232, C-337). The single most common way a player expresses
those choices — attempting something through dialogue — ignores all of them.

### Acceptance gate

1. Given a character with a non-zero relevant ability modifier, when a
   free-text action triggers a skill check, then the applied modifier equals
   the character sheet's value for that ability plus proficiency where it
   applies, and the roll breakdown shown to the player names each component.
2. Given the same action, when the check is proposed, then the **stakes are
   shown before the player commits**: which ability, the total modifier, the
   DC, and what failure costs. No roll is committed without that preview.
3. Given the free-text path, when it calls the dialogue service, then
   `playerContext` carries the real character — the "Level 1 Fighter" default
   is never reached in production and a test asserts that.
4. Given ordinary conversation with no uncertain outcome, when the player
   speaks, then no dice are rolled. Rolls resolve uncertainty, not permission
   to participate.
5. Given a model-authored proposal that claims a bonus or advantage, when it
   is resolved, then the bonus is derived from character/world state, not
   from the model's suggestion. Eloquent prompting cannot manufacture a
   modifier.

### Out of scope

- Routing the _result_ through `resolveCommand` — that is C-489. This
  contract fixes the _inputs_ to the roll.
- New skills, spells, or class features.
- Combat-path modifiers (already sourced from the sheet).

### Notes

AC-5 overlaps C-489's territory. Draw the line explicitly: **C-487 owns what
goes into the roll; C-489 owns what happens to the result.** Keep both
contracts' Watch Points cross-referencing each other.

---

## C-488 — Authored NPC identity in the content pack

| Field           | Value                                                                                                                                                                                                                                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Priority**    | P0 — "a name plus 'fantasy NPC' is not a character"; blocks C-493/C-494/C-495                                                                                                                                                                                                                                    |
| **Type**        | full                                                                                                                                                                                                                                                                                                             |
| **Target**      | `packages/shared/schemas/src/lib/game/` (pack NPC schema), `packages/shared/types/`, `content/packs/emberwatch/manifest.json`, the pack loader (C-315), `apps/frontend/client/src/lib/services/game/npc_dialogue_service.svelte.ts:1615`, `apps/frontend/client/src/lib/services/gm/gm_prompt_service.svelte.ts` |
| **Depends on**  | None                                                                                                                                                                                                                                                                                                             |
| **Docs impact** | user-facing (pack authoring format)                                                                                                                                                                                                                                                                              |

### Problem & baseline evidence

V-3 + V-4. The production dialogue path builds a persona of
`` `You are ${npcName}, a character in a fantasy world.` `` because that is
genuinely all the pack gives it — pack NPCs carry `name`,
`defaultDialogueKey`, `appearanceLayers`, `isVendor`, `initialSuggestions`
and nothing else.

Meanwhile `gm_prompt_service.svelte.ts` (C-235, C-457) assembles a far richer
context and is **not** used by the main NPC dialogue path. The richer brain
exists; the interaction players actually reach does not use it.

Correction to the review, worth writing into the contract so the implementer
does not "fix" a non-bug: the intent prompt _does_ receive recent conversation
and game-state facts via `buildGameStateFacts()`, including relationship and
faction facts. The gap is the **persona/agenda/knowledge definition**, and the
fact that the roll-resolution prompt does not receive those same facts.

### Acceptance gate

1. Given the pack NPC schema, when extended, then it carries at minimum:
   `personality` (voice and manner), `agenda` (what they want, and what they
   want that conflicts with someone else's want), `knowledge` (facts they know
   and can share), `secrets` (facts they know and will not volunteer), and
   `boundaries` (what they will not do). All optional, all TypeBox in
   `packages/shared/schemas/`, derived types in `packages/shared/types/`.
2. Given a pack authored against the previous version, when loaded, then it
   still loads — missing fields degrade to the current generic behaviour and
   a test proves it. Pack version bumps and the loader's migration path is
   documented.
3. Given an NPC with an authored identity, when the player talks to them,
   then the assembled persona contains that identity — asserted by a test on
   the **production** dialogue path, not the sandbox.
4. Given the roll-resolution prompt, when it is built, then it receives the
   same conversation history and game-state facts the intent prompt receives.
5. Given all three Emberwatch NPCs, when the pack ships, then each has an
   authored identity with at least one agenda that conflicts with another
   NPC's.
6. Given the prompt budget, when identity is added, then assembly stays within
   the existing budget — identity displaces filler, it does not extend the
   ceiling.

### Out of scope

- Merging `npcDialogueService` into `gmPromptService`, or vice versa. Reuse
  the assembler; do not restructure service ownership in this contract.
- Memory retrieval feeding the persona — that is C-492.
- Writing the actual Emberwatch dilemma content — C-495 owns the story; this
  contract only requires that the _fields exist and are populated_.
- Character-card (SillyTavern/chub) import mapping. Note in the contract that
  imported prose must **not** automatically confer permission to alter world
  state, but do not build the importer here.

### Notes

AC-6 is the trap. The obvious implementation stuffs five new fields into
every prompt and blows the budget, degrading every NPC to make three of them
better. Require a measured before/after token count in the Execution Report.

---

## C-489 — One authority path for consequences

| Field           | Value                                                                                                                                                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Priority**    | P0 — the game currently makes promises it silently fails to keep                                                                                                                                                                             |
| **Type**        | full                                                                                                                                                                                                                                         |
| **Target**      | `apps/frontend/client/src/lib/services/game/npc_dialogue_service.svelte.ts:1881-1965` (`_validateAndApplyDeltas`), `packages/shared/utils/src/lib/rules/rules_kernel.ts:293` (`resolveCommand`), relationship/faction state services (C-341) |
| **Depends on**  | [C-487](#c-487--free-text-skill-checks-honour-the-real-character-sheet)                                                                                                                                                                      |
| **Docs impact** | internal                                                                                                                                                                                                                                     |

### Problem & baseline evidence

Three defects in one seam:

- **V-9 — silently dropped deltas.** `_validateAndApplyDeltas` pushes
  `trust_change` (`:1889`) and `relationship_update` (`:1954`) into `valid`
  after a bounds/label check and **never mutates anything**, while
  `flag_set`, `flag_clear`, `inventory_grant` and `inventory_remove` all call
  through to `questStateService` / `inventoryService`. The method's name
  claims it applies; for two of six kinds it does not.
- **V-8 — the rules kernel is unreachable.** `resolveCommand`
  (`rules_kernel.ts:293`) has no caller outside its own file. Combat and
  relationship math happen elsewhere, so "AI proposes, rules decide" has
  multiple authorities and the pure one is not among them.
- **Ordering.** Some paths narrate first and validate afterwards. If the NPC
  says _"Here, take the wand"_ and the mutation fails, the player experiences
  the game itself breaking a promise.

Bounds checking is not authority. It does not answer: is this NPC entitled to
give this item? has this reward already been granted? does this action deserve
advantage? did the claimed event actually happen?

### Acceptance gate

1. Given any `NpcStateDelta`, when it is accepted, then it is **applied** —
   `trust_change` and `relationship_update` mutate real relationship/faction
   state (C-341's stores), and a test asserts the value changed and survives
   a reload.
2. Given a consequential delta, when it is processed, then it passes through
   a single authority that checks **entitlement** (is this NPC allowed to
   grant this?), **idempotency** (has this reward already been granted?) and
   **provenance** (did the referenced event actually occur?), not just numeric
   bounds.
3. Given a consequential action, when it resolves, then **state commits before
   narration is shown**. Non-consequential conversation continues to stream
   freely — the contract must state which delta kinds are consequential.
4. Given a rejected delta, when it is rejected, then the player sees a
   coherent outcome — never a narrated success whose effect did not happen.
   A rejection is logged with the reason.
5. Given custom combat actions, when the model proposes advantage or bonus
   damage, then those are recomputed from state and the proposal is treated as
   a request, not an input.
6. Given `resolveCommand`, when this contract lands, then it either has real
   production callers for the delta path or is explicitly deleted. Do not
   leave a third unreachable authority behind — state which, and why, in the
   contract's Design Reference.

### Out of scope

- Migrating combat resolution wholesale into the kernel. AC-6 covers the
  dialogue/delta path only; a combat migration is its own contract.
- Event _recording_ — that is C-491. This contract decides and applies;
  C-491 writes down what happened and who saw it.
- Any new delta kinds.

### Notes

AC-6 is a genuine fork and should be an Open Question resolved during
drafting, not a coin flip during implementation. Both answers are acceptable;
an unreachable kernel left in place is not.

---

## C-490 — Transcript branching must not imply rewinding the world

| Field           | Value                                                                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Priority**    | P1 — a reference-tool feature that does not transfer cleanly to a consequential RPG                                                                      |
| **Type**        | thin                                                                                                                                                     |
| **Target**      | `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte.ts:1624-1685`, the dialogue overlay's message-action UI |
| **Depends on**  | None                                                                                                                                                     |
| **Docs impact** | user-facing                                                                                                                                              |

### Problem & baseline evidence

V-10: `createBranch` (`:1624`) snapshots `[...this.messages]`; `switchBranch`
(`:1654`) restores `[...branch.messages]`. Inventory, quest state,
relationships, world flags and RNG are untouched.

Concretely: threaten Rollo, obtain the Ward Wand, switch back to the polite
branch — you keep the wand, and the conversation says you never asked for it.
In a chat app that is a feature. Here it silently corrupts campaign state.

### Acceptance gate

1. Given campaign play, when the player opens a message's actions, then
   history edit / delete / branch controls are **not offered**. They remain
   available in the dev sandbox and in non-campaign chat modes.
2. Given the player wants to retry a reply, when they use the retry
   affordance, then it is labelled as changing **presentation only**
   ("Rephrase"), and it does not re-run any state mutation.
3. Given the existing branch data already persisted in a save, when it is
   loaded, then it does not crash and is not silently discarded — state the
   handling explicitly.
4. Given C-245's CYOA branching, when this lands, then it still works —
   campaign branching and transcript branching are different features and only
   the latter is gated.

### Out of scope

- Implementing real rewind (whole-campaign checkpoint restore) or fork-campaign.
  Name them in the contract as the future options; build neither here.
- Removing the branch code. Gate the UI, keep the capability.

### Notes

Upgrade to a full contract if AC-3 turns out to touch the save schema.

---

# Phase 2 — Depth

## C-491 — Committed narrative event record

| Field           | Value                                                                                                                                                             |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Priority**    | P0 — the backbone for memory, companions and consequence; nothing in Phase 2 works without it                                                                     |
| **Type**        | full                                                                                                                                                              |
| **Target**      | new event record in `packages/shared/schemas/` + `packages/shared/types/`, save/serialization path (C-117/C-132/C-334), journal, `npc_dialogue_service.svelte.ts` |
| **Depends on**  | [C-489](#c-489--one-authority-path-for-consequences)                                                                                                              |
| **Docs impact** | internal                                                                                                                                                          |

### Problem & baseline evidence

Consequences today are scattered across flags, inventory and (soon)
relationship deltas, with no record of _what happened, when, and who saw it_.
That makes every downstream feature guess: the journal cannot summarise, the
companion cannot react to something it witnessed, and memory cannot
distinguish a fact from a claim.

### Acceptance gate

1. Given a consequential resolution, when it commits (C-489's single
   authority), then exactly one committed event is appended, drawn from a
   closed set — at minimum `PromiseMade`, `EvidencePresented`,
   `ItemTransferred`, `ThreatWitnessed`, `QuestResolved`,
   `RelationshipChanged`.
2. Given an event, when it is recorded, then it carries **witnesses** — which
   NPCs perceived it. An NPC does not know an event merely because it is in
   the campaign log; they must witness it, be told, or infer it.
3. Given three categories of information, when they are stored, then they are
   **distinguishable**: world fact (Rollo possesses the wand), character
   belief (Thalia believes Rollo intends to sell it), dialogue claim (Rollo
   says he never touched it). A single undifferentiated "memory" store fails
   this AC.
4. Given a save and reload, when the campaign resumes, then the event record
   round-trips intact, and a save written before this contract still loads.
5. Given the journal, when an event commits, then the corresponding journal
   entry derives from the event rather than being written separately.

### Out of scope

- A general event-sourcing migration. Extend the existing local save/state
  architecture with a narrowly scoped record for this slice — say so in
  Architecture Directives and make it a Watch Point.
- Retrieval and ranking — C-492.
- Companion reactions — C-494.

### Notes

AC-2 and AC-3 are what make deception, investigation and secrets possible
later. They are cheap now and extremely expensive to retrofit. Do not let a
drafting agent collapse them into "store the events".

---

## C-492 — Memory retrieval correctness and production wiring

| Field           | Value                                                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Priority**    | P1 — the current implementation does the opposite of what its own docs say                                                                                                                  |
| **Type**        | full                                                                                                                                                                                        |
| **Target**      | `apps/frontend/client/src/lib/services/memory/local_embedding_backend.ts` (branch at `:181`), the memory singleton's initialization/background-index entry points, the production boot path |
| **Depends on**  | [C-491](#c-491--committed-narrative-event-record)                                                                                                                                           |
| **Docs impact** | internal                                                                                                                                                                                    |

### Problem & baseline evidence

V-7, and it is worth quoting exactly. `local_embedding_backend.ts:174`:

```ts
const hasPrecomputedEmbeddings =
  this._entries.length > 0 && this._entries[0].embedding.length > 0;

if (!hasPrecomputedEmbeddings) {
  await this._ensureModel();
}

if (hasPrecomputedEmbeddings) {
  // With pre-computed embeddings, use keyword overlap scoring
```

The normal indexed case — entries _with_ embeddings — takes the
**keyword-overlap** branch. The cosine-similarity path the service documents
runs only when embeddings are absent. Additionally, no production caller was
found for the singleton's initialization / background-index-on-load methods.

The right conclusion is **not** "build better RAG". For a five-character
village, a correct fact table outperforms an impressive disconnected memory
architecture.

### Acceptance gate

1. Given the retrieval path, when entries have embeddings, then the branch
   taken matches the service's documented behaviour — either fix the
   inversion, or delete the semantic path and document that retrieval is
   keyword-based. **Pick one and say why**; do not leave both half-live.
2. Given a fresh campaign boot, when the client starts, then memory
   initialization and indexing are invoked from a production path, asserted by
   a test.
3. Given a campaign where a specific fact was established, when the player
   leaves the conversation, saves, reloads, and returns, then the NPC recalls
   that fact — proven by an E2E journey, not a unit test.
4. Given retrieval for a specific NPC, when facts are gathered, then only
   facts that NPC could know (C-491's witnesses/belief model) are returned.
   Retrieving a secret the NPC never learned is a failure.
5. Given the retrieval budget, when facts are assembled into a prompt, then it
   respects C-488's budget ceiling.

### Out of scope

- Adopting VoiceMem or another third-party memory system — the
  [C-458](C-458-in-house-memory-and-lore-retrieval-system.md) decision
  (in-house, VoiceMem as inspiration only) stands and is not reopened.
- Semantic re-ranking, hybrid search, or embedding model selection. If AC-1
  resolves toward keyword retrieval, that is a legitimate outcome for a
  five-character village.

### Notes

AC-1 is the fork. Evidence that keyword retrieval is sufficient at this
content scale is a _good_ result and should be recorded, not treated as a
regression.

---

## C-493 — Wire group scenes into the production party path

| Field           | Value                                                                                                                                                                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Priority**    | P1 — closes C-456's production gap; the capability already exists and is tested                                                                                                                                                                           |
| **Type**        | thin                                                                                                                                                                                                                                                      |
| **Target**      | `apps/frontend/client/src/lib/services/npc/autonomous_message_service.svelte.ts:425,444`, the "Talk to Party" overlay, `apps/frontend/client/src/lib/services/npc/autonomous_message_service.svelte.ts` poller startup, `npc_awareness_service.svelte.ts` |
| **Depends on**  | [C-488](#c-488--authored-npc-identity-in-the-content-pack)                                                                                                                                                                                                |
| **Docs impact** | user-facing                                                                                                                                                                                                                                               |

### Problem & baseline evidence

V-6. `selectGroupParticipants()` and `generateMultiNpcResponses()` are fully
implemented and covered by 22 passing unit tests, and no production code calls
either. The production "Talk to Party" overlay addresses **one** companion
through `npcDialogueService`. Separately, the autonomous-message poller is
started only in a dev sandbox, and its known-NPC discovery reads
world-generation output rather than the authored scene cast.

This is deliberately a thin contract: **do not build another group-chat
system.** Connect and simplify what exists, around one real scene.

### Acceptance gate

1. Given the party overlay with two or more companions present, when the
   player addresses the party, then `generateMultiNpcResponses()` is invoked
   from the production path and two companions respond in one turn, the second
   aware of the first.
2. Given the autonomous-message poller, when a campaign is running (not the
   sandbox), then it is started from the production path and its NPC discovery
   reads the **authored scene cast**, not world-generation output.
3. Given C-485's orphaned-capability guard, when this lands, then both methods
   are removed from the baseline JSON.
4. Given C-248's idle-chat behaviour, when this lands, then it is unchanged —
   the multi-NPC cap applies to addressed turns only (C-456 AC-4 still holds).

### Out of scope

- New group-addressing UI beyond the existing `'party'` address mode toggle.
- Changing `MAX_GROUP_PARTICIPANTS` or the selection weighting.
- The narrative director's timed startup (still sandbox-only) — separate item,
  note it in the contract and leave it.

---

## C-494 — One companion who reacts

| Field           | Value                                                                                                                                                                              |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Priority**    | P1 — "I disapprove: −5" is bookkeeping; a companion is a character                                                                                                                 |
| **Type**        | full                                                                                                                                                                               |
| **Target**      | `content/packs/emberwatch/manifest.json` (new companion NPC), party roster (C-340/C-212), `npc_dialogue_service.svelte.ts`, C-491's event record                                   |
| **Depends on**  | [C-488](#c-488--authored-npc-identity-in-the-content-pack), [C-491](#c-491--committed-narrative-event-record), [C-492](#c-492--memory-retrieval-correctness-and-production-wiring) |
| **Docs impact** | user-facing                                                                                                                                                                        |

### Problem & baseline evidence

V-5: no Emberwatch NPC is configured as recruitable. Party, approval, dialogue
and persistence scaffolding all exist (C-212, C-340, C-341) and no authored
companion uses them.

**One** companion, not a roster.

### Acceptance gate

1. Given the demo adventure, when the player meets the companion early, then
   they can be recruited into the party through the existing roster system —
   no new party mechanics.
2. Given the companion's authored identity (C-488 fields), when defined, then
   it includes a desire, a fear, a belief they might revise, a relationship
   with another Emberwatch NPC, and one boundary they will not casually cross.
3. Given a `PromiseMade` or `ThreatWitnessed` event the companion witnessed
   (C-491), when the player next speaks with them, then they reference that
   specific event unprompted, in their own voice — not a numeric approval
   readout.
4. Given the companion's boundary, when the player crosses it, then the
   companion acts — refusal, objection, or leaving. The reaction is a state
   change, not only dialogue.
5. Given one scripted moment, when its trigger fires, then the companion acts
   **without being asked**.
6. Given save/reload, when the campaign resumes, then companion state,
   witnessed events and relationship survive intact.

### Out of scope

- A second companion, or generalising to a companion framework.
- Romance, companion quests, or companion progression.
- Party orders (wait/guard/scavenge) — that is the C-340 amendment already
  tracked in `BACKLOG_C452_PLUS.md`.

### Notes

AC-3 is the contract's whole point and the hardest to specify. Require the
Execution Report to quote an actual generated line, not just assert a test
passed.

---

## C-495 — Emberwatch dramatic structure

| Field           | Value                                                                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Priority**    | P1 — the review's core complaint: the dramatic possibility space is small                                                                                |
| **Type**        | full                                                                                                                                                     |
| **Target**      | `content/packs/emberwatch/manifest.json` (v4), quest graph (C-339), endings, `apps/e2e/tests/client/release_gate.spec.ts` (extend C-486's journey)       |
| **Depends on**  | [C-488](#c-488--authored-npc-identity-in-the-content-pack), [C-491](#c-491--committed-narrative-event-record), [C-494](#c-494--one-companion-who-reacts) |
| **Docs impact** | user-facing                                                                                                                                              |

### Problem & baseline evidence

V-5: three maps, three NPCs, one quest, one encounter, one declared ending.
The premise is "get the Ward Wand from Rollo, return it to Thalia". AI can
paraphrase a fetch quest indefinitely without making it dynamic.

🔴 **Content-authoring decision (made 2026-09-06):** this contract specifies
**structure, schema and validation only**. The actual dilemma, dialogue and
character writing are authored by the maintainer, not by the drafting agent
and not by the implementer. The reviewer's proposed ward dilemma (Rollo's
counterclaim that the ward diverts danger outward, a ledger as evidence,
Thalia as sympathetic antagonist) is **illustrative, not approved** — the
contract must not hardcode it. Placeholder content is acceptable in the
implementation as long as the structural ACs are met and the placeholders are
clearly marked for replacement.

The next content investment is a dilemma, not more geography — keep the three
maps.

### Acceptance gate

1. Given the quest, when the player investigates, then at least two NPCs give
   **materially conflicting accounts** of the same situation, and the schema
   supports marking which account is true.
2. Given the world, when the player explores, then at least one piece of
   physical **evidence** exists that can be discovered and presented to an NPC,
   producing an `EvidencePresented` event (C-491).
3. Given the quest, when it resolves, then at least **three endings** are
   reachable that differ in **world state**, not only in prose — different
   flags, different relationships, different item ownership.
4. Given any ending, when the player returns to the village afterward, then
   the village is **visibly changed** in a way that reflects which ending
   occurred, and NPCs reference it.
5. Given campaign creation, when a new campaign starts, then a small bounded
   set of starting conditions varies (who owes whom, which evidence is
   missing, what Rollo wants, how close the ward is to failure). The hidden
   truth is sampled **once** at campaign creation and all clues and NPC
   behaviour derive from that same truth — NPC generations must not
   independently invent contradictory answers.
6. Given C-486's release journey, when extended, then it asserts the full
   milestone: learn → promise or threaten → resolve with the real sheet →
   validated state change → immediate reaction → leave → save → reload →
   changed interaction → companion acknowledgement.
7. Given a pack authored against v3.2.0, when loaded, then it still loads or a
   documented migration runs.

### Out of scope

- New maps, new regions, procedural world generation.
- New combat mechanics or classes.
- Voice or image generation for the new content.
- Writing the final prose (maintainer authors it).

### Notes

AC-5 is the replayability mechanism and the easiest to get wrong: randomness
creates the _situation_, the player's decisions create what is _unique_.
A drafting agent will be tempted to make each NPC roll their own truth —
forbid it explicitly in Watch Points.

AC-6 is what makes this the milestone contract. It should be the last AC
verified, and it should be verified by watching the journey run, not by
reading a green check.

---

# Phase 3 — Presentation

## C-496 — Sprite atlas and animation manifest import path

| Field           | Value                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Priority**    | P2 — needed whether the art is AI-generated, commissioned, or hand-made                                                                                |
| **Type**        | full                                                                                                                                                   |
| **Target**      | `packages/shared/schemas/` (atlas manifest schema), `packages/shared/lpc/src/lib/sheet_geometry.ts`, `packages/frontend/engine/src/game_world.ts:3532` |
| **Depends on**  | None                                                                                                                                                   |
| **Docs impact** | user-facing (asset authoring format)                                                                                                                   |

### Problem & baseline evidence

V-14: `game_world.ts:3532` hardcodes `const stateStr = 'walk'` as the engine's
only animation state, and `sheet_geometry.ts` infers 64/128px cell layouts
from image dimensions. That path is an LPC-shaped loader, not a generic atlas
player — there is currently no way to ship a character whose frames are not
laid out like LPC.

One rectangle per animation is insufficient: an animation is a **sequence**
with timing and alignment.

### Acceptance gate

1. Given an atlas manifest, when defined, then it supports named frame rects
   (`x, y, width, height`), named clips (`idle.down`, `walk.left`,
   `attack.up`), ordered frame lists, per-frame durations, loop behaviour, a
   stable logical origin (typically at the feet), trim offsets for cropped
   frames, and explicit fallback behaviour for missing clips.
2. Given a manifest-described character, when rendered in the game world, then
   it animates through its declared clips — the `'walk'` hardcode is gone or
   is an explicit documented default for LPC-shaped sheets only.
3. Given both asset types, when a scene mixes an LPC modular character and a
   manifest atlas character, then both render correctly. **Two asset types,
   one engine** — do not fork the renderer.
4. Given gameplay collision and hit timing, when animation frames change, then
   they are unaffected — visual frame bounds and authoritative gameplay
   geometry stay separate.
5. Given a manifest missing a requested clip, when it is requested, then the
   declared fallback is used and the failure is logged, not thrown.

### Out of scope

- Per-frame hand/weapon attachment points, front/back equipment passes, and
  cosmetic animation markers. Note them as the deliberate next layer.
- Integrating any image-generation provider.
- Replacing LPC. **Keep LPC for customizable player characters**; the manifest
  path serves complete authored/generated sheets for NPCs and creatures.
- Deciding the equipment strategy (fixed outfit vs. a few outfit states vs.
  modular overlays) — that is a product decision informed by the art
  experiment below, not this contract.

---

## C-497 — Camera framing and default-asset review

| Field           | Value                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------- |
| **Priority**    | P2 — scale and composition strongly affect perceived sprite quality; cheap to fix, highly visible |
| **Type**        | thin                                                                                              |
| **Target**      | camera/zoom configuration (C-161, C-199), the `/game` diagnostic boot defaults, hotbar component  |
| **Depends on**  | None                                                                                              |
| **Docs impact** | internal                                                                                          |

### Problem & baseline evidence

A direct `/game` diagnostic boot showed very enlarged tile repetition, an
oversized portrait-like default character, and substantial empty background
near the map edge. That was a transient/default setup rather than a completed
onboarding journey, so it is **not** a complete art assessment — but it is
enough to justify a focused framing review before any art is replaced.

Do not judge LPC through a badly framed presentation.

### Acceptance gate

1. Given a normally-configured campaign boot, when the map renders, then tile
   scale and camera zoom are within a stated target range and the map fills
   the viewport without large empty margins.
2. Given the `/game` diagnostic boot, when it renders with default/transient
   state, then it uses the same framing as a normal boot — the diagnostic path
   does not have its own accidental defaults.
3. Given the hotbar, when slots are unassigned, then empty slots are hidden
   rather than displayed as empty controls.
4. Given the framing change, when applied, then a visual suite screenshot is
   captured as the new baseline.

### Out of scope

- Replacing any art.
- The art direction decision (proportions, palette, portrait style).

---

## C-498 — A preset means the character is ready

| Field           | Value                                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Priority**    | P2 — the fastest-looking route to play currently takes the longest                                                                                |
| **Type**        | thin                                                                                                                                              |
| **Target**      | `apps/frontend/client/src/lib/views/character/` creation flow, starter-character presets                                                          |
| **Depends on**  | None (coordinate with [C-483](C-483-guided-ai-setup.md) / [C-484](C-484-capability-first-settings.md), which own the AI-setup half of onboarding) |
| **Docs impact** | user-facing                                                                                                                                       |

### Problem & baseline evidence

In the observed session, character creation put the AI chat at the top and
presets below it. Selecting the "Thaldrin" preset opened a long character-sheet
form — missing portrait placeholder, small LPC preview, editable HP, AC, speed,
class, alignment, proficiencies. A preset should mean _"this character is
ready"_, not _"please finish filling out this form"_.

### Acceptance gate

1. Given the character creation screen, when it opens, then illustrated
   starter heroes are the primary affordance and AI generation is a clearly
   secondary path.
2. Given a selected preset, when confirmed, then the player supplies at most a
   name and one motivating choice before entering the world. Full editing is
   reachable via an explicit "customize everything" path.
3. Given a shipped starter hero or Emberwatch cast member, when displayed,
   then a portrait exists — no placeholder state in the default flow.
4. Given the preset path, when timed from character screen to world entry,
   then it is faster than the AI-generation path.

### Out of scope

- Removing AI character generation.
- The AI provider/model setup steps (C-483/C-484 own those).
- Commissioning the portrait art — see the art experiment below; ship the best
  available curated art and record what is placeholder.

---

## Not contracts — do these as spikes or decisions

- **Bounded art experiment.** Produce a small batch **externally** (three core
  NPCs × four directions × idle + walk + one expressive action, plus one
  outfit variation on one character). Evaluate them **inside the real map at
  real gameplay scale**, not in an image viewer. Measure: attempts per
  acceptable character, manual cleanup required, whether it looks good while
  _moving_, whether the whole cast looks like one game, license/provenance,
  and workflow reproducibility. Compare against a curated LPC set and, if
  possible, one artist-made sample. **Cost per accepted animated character is
  the metric, not cost per generated image.** Do not integrate an image
  provider first; do not contract this until it wins. Until then, restrict the
  shipped LPC catalogue to known-good combinations.
- **Art direction decision.** Proportions, camera angle, pixel density,
  lighting, palette, portrait style, environmental detail, UI density,
  animation exaggeration. A purple/dark UI palette is a theme, not an art
  direction. This is a maintainer decision; C-497 and C-498 assume it exists.
- **Reference-platform decision.** Which single OS/build is verified every
  release (the strategy doc's §1 matrix). A decision, not a contract.
- **Equipment strategy decision.** Fixed visual outfit vs. a few complete
  outfit states vs. modular overlays on a standardized rig. Blocked on the art
  experiment; C-496 deliberately does not pre-decide it.
- **Narrative director production startup.** Currently sandbox-only, like the
  autonomous poller. Noted in C-493's out-of-scope; needs its own seed once
  C-494/C-495 show what the director should actually be triggered by.
- **Implement C-483 and C-484.** Both are `approved` and unimplemented, and
  they already cover the review's onboarding critique. Running them is worth
  more than re-contracting that ground.

---

## Drafting notes for the DeepSeek V4 Flash pass

- **Seeds are premises, not conclusions.** Every `file:line` above was
  verified on `main` at `eacfc371` on 2026-09-06. Re-check before drafting —
  if a line has moved or the code has changed, the contract's Problem section
  must reflect what is there _now_, not what this doc says.
- **Out-of-scope lists are load-bearing.** They are the main defence against a
  cheap model helpfully refactoring adjacent systems. Copy them into the
  contract's Scope Boundaries verbatim and expand rather than replace.
- **Every AC needs a production path** under C-485's new rule. An AC that a
  unit test alone can satisfy, for a player-facing capability, is not
  acceptable in this batch — that rule exists precisely because of C-456.
- **Flag genuine forks as Open Questions**, do not resolve them by guessing:
  C-489 AC-6 (kernel callers vs. deletion), C-492 AC-1 (fix the semantic path
  vs. commit to keyword retrieval), C-490 AC-3 (existing persisted branch
  data).
- Run each as `bun run contract C-XXX --root --critique` **from `main`**.
