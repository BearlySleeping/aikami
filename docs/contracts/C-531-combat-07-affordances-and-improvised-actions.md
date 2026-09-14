---
id: C-531
title: "Contract C-531: Combat-07 — Affordances and Improvised Actions"
source: "docs/architecture/combat_2.md §5, §8, §11, §13, §17, §21–22, §26"
contract_type: full
status: draft
github:
    issue_number: null
    issue_url: null
    project_item_id: null
    pr_url: null
created_at: "2026-09-14T00:00:00Z"
---

# Contract C-531: Combat-07 — Affordances and Improvised Actions

## Metadata

| Field                  | Value                                                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Source**             | `docs/architecture/combat_2.md`, especially §13 and §22.3                                                                                |
| **Target**             | Combat object/surface state, registered environmental effects, intent compilation, previews, ECS/world persistence, production combat UI |
| **Type**               | full                                                                                                                                     |
| **Priority**           | P1 — environmental actions are currently unsupported by the v2 combat loop                                                               |
| **Dependencies**       | C-509, C-514, C-515, C-516, C-525; C-526 implementation plus verified approval/continuation/lifecycle corrections                        |
| **Status**             | draft                                                                                                                                    |
| **Promotion**          | —                                                                                                                                        |
| **Docs Impact**        | user-facing → `apps/frontend/docs/src/content/docs/features/combat-controls.md`; creator-facing affordance authoring documentation       |
| **Contract version**   | 1.0.0                                                                                                                                    |
| **Production Surface** | `/game` → authored encounter → object inspection → preview → confirmation → kernel resolution → exploration                              |

## Problem & Baseline Evidence

Baseline reviewed on 2026-09-14 against PR #352 head
`9d93a3f4f01eebfc5da92f5c24a429a9968fd014`.

- `packages/shared/schemas/src/lib/game/combat/combat_state.ts` defines the
  combat state, tactical positions, budgets, ability catalog, and named RNG
  streams. It does not yet provide the environmental simulation required here.
- `packages/shared/utils/src/lib/rules/combat_intent_compiler.ts` reserves
  interaction/improvised intent vocabulary without a complete environmental
  resolution path.
- `packages/frontend/engine/src/combat/combat_state_adapter.ts` and the v2
  resolver project/apply authoritative combat state. Environmental additions
  must survive this round trip.
- C-526 provides decision agents and post-resolution narration. Neither the
  narrator nor an LLM response may become an environmental rules authority.
- The architecture's proof encounter calls for a table, brazier, oil, and
  breakable support. Rendered scenery alone does not satisfy that requirement.
- PR #352 still needs approval/continuation corrections. This contract must
  not disguise those prerequisites as completed work.

**Reproduction:** In a v2 encounter, request “tip the brazier into the oil” or
“cut the support.” Observe whether a real object can be selected, a mechanical
preview generated, and persistent object/surface state changed through the
kernel. Narration without those changes is a failure.

**Baseline tests:** Run existing schemas/utils/engine/client combat tests,
`apps/e2e/tests/client/combat_v2.spec.ts`, the C-526 enabled-agent lane, and
the existing combat visual suite. Record exact results before editing.

## User Outcome

A player can inspect battlefield objects and use their actual affordances
through clicks or natural language. The game explains the cost, check, targets,
and risks before confirmation. Objects break, move, ignite, or provide cover
according to deterministic rules, and those changes remain visible in the world.

A content author can create another usable environmental object by composing
supported declarative affordances, without adding object-specific engine code.

## Success Measures

- Direct environmental actions remain available without network or AI.
- Interpretation failure returns control and legal alternatives; it never
  invents a successful action.
- Preview consumes no resources or RNG.
- From identical state and equivalent grounded inputs, manual and language
  actions produce identical mechanical results.
- Proof-fixture preview target: p95 ≤16 ms; kernel command resolution target:
  p95 ≤10 ms, excluding rendering/model time, on documented reference hardware.
- Supported reference workload: 32×32 battlefield, 8 combatants, 32 objects,
  and 64 active surface cells. Measure and record results.
- `/game` can complete the environmental proof journey with real authored
  content, persistent state, and deterministic replay.

## Existing System & Reuse Map

| Capability              | Existing source                                               | Reuse / modify / replace                                     |
| ----------------------- | ------------------------------------------------------------- | ------------------------------------------------------------ |
| Versioned state and RNG | `packages/shared/schemas/src/lib/game/combat/combat_state.ts` | Extend deliberately                                          |
| Pure rules              | `packages/shared/utils/src/lib/rules/`                        | Extend existing combat facade/resolvers                      |
| Intent grounding        | `combat_intent_compiler.ts`                                   | Implement supported object/improvised steps                  |
| ECS projection          | `packages/frontend/engine/src/combat/combat_state_adapter.ts` | Preserve environmental state                                 |
| Commit path             | `packages/frontend/engine/src/combat/combat_v2_resolver.ts`   | Reuse authority boundary                                     |
| Tactical queries        | Existing battlefield and combat forecast helpers              | Extend dynamic occupancy, cover, and hazards                 |
| Confirmation            | C-525 intent flow and corrected C-526 companion flow          | Reuse revision-bound approval                                |
| Narration               | C-526 fact references and event rendering                     | Add supported environmental facts                            |
| Visual verification     | `apps/e2e/src/visual/suites/combat.visual.ts`                 | Extend                                                       |
| Content loading         | Existing pack/encounter loader                                | Extend authored definitions; do not create a parallel loader |

## Overview

Implement a bounded environmental rules system around authored affordances.
The LLM identifies an approach; deterministic code binds objects and selects a
registered recipe; the kernel validates, rolls, and emits consequences.

Deliver two complete object interactions before expanding the catalog. Every
addition must connect content, rules, preview, UI, persistence, and replay.

## Design Reference

Follow `AGENTS.md`, applicable repository guidance, the current contract
dependencies, and `docs/architecture/combat_2.md`.

Retain quantized tactical cells with smooth presentation. Follow existing
TypeBox/derived-type conventions, Svelte MVVM, dependency injection, logging,
EngineBridge, and command/event patterns.

> Testing conventions:
> [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

### One mechanical authority

- Manual UI, player language, companion proposals, and enemies use the same
  compiler/command/kernel pipeline.
- UI and AI may propose an object, approach, and registered capability.
- The kernel owns eligibility, costs, DCs, modifiers, dice, damage, conditions,
  movement, surface changes, and object destruction.
- Model output cannot contain trusted numeric mechanics, executable code,
  arbitrary state patches, or new effect definitions.
- Authored content is declarative and schema-validated. Unknown effects,
  invalid references, and excessive expansion fail validation.

### Bounded initial vocabulary

Required capabilities:

1. Interact with, move, and break an authored object.
2. Shove a combatant or move an object using registered forced movement.
3. Ignite/extinguish and create/remove supported oil/fire surfaces.
4. Take advantage of authored cover and destroy that cover.
5. Resolve an authored environmental impact/improvised attack, including a
   breakable support dropping its attached payload.

Implement these through a reusable registry. Do not add a dedicated
“brazier-on-goblin” command.

Grappling, unrestricted condition composition, distraction/social checks,
fluid simulation, arbitrary physics, and additional surface families are
outside this initial contract. The compiler must explain unsupported requests.

### Checks and costs

- Authored recipes declare action cost, prerequisites, check category, DC,
  success effects, and any explicit failure effects.
- Check modifiers must come from identified character-sheet fields projected
  into the snapshot. Do not substitute attack bonus for an unrelated check.
- Default check rule: d20 + registered modifier ≥ authored DC.
- Natural 1/20 have no special check behavior unless a registered rule says so.
- Invalid commands consume neither resources nor RNG.
- A legal attempted check consumes its declared cost even when the roll fails.
- Use the existing `actions` RNG stream; do not introduce an unrelated RNG.

### Deterministic environmental resolution

- Resolve effects in declared order with stable-ID tie-breaks.
- Derived walkability, sight blocking, and cover combine immutable terrain
  with current object state. Destroying an object must not erase terrain data.
- Each forced-movement step validates bounds, footprint, and occupancy.
  Stop at the last legal cell; never overlap actors or teleport through walls.
- Dropped payloads use authored impact zones and registered rules, not a new
  real-time physics engine.
- Surface interaction order, expiry, and damage cadence are explicit rules.
  For the initial fire rule, apply at most one hazard hit per actor per round
  from the same registered hazard family; store the necessary tick identity.
- Bound cascade expansion to 64 effects per initiating command. Validate
  authored definitions before play. Detect overflow during transactional
  resolution and reject without retaining tentative mutation or RNG changes.
- Invalidating a later command does not roll back earlier committed commands
  in a multi-command plan; report partial execution accurately.

### Input and confirmation

- The object inspector exposes available actions and why others are unavailable.
- Manual selections use stable IDs; model drafts use bounded visible selectors.
- Preview shows target/impact cells, action cost, check/DC/modifier or odds,
  damage range, movement, cover changes, and known environmental risks.
- A probabilistic preview states branches; it never presents success as certain.
- Commit validates encounter run, actor, turn, revision, and command identity.
- An interrupted or materially changed plan requires a fresh preview.
- Multi-step player language reuses the corrected step-wise execution
  infrastructure. Preview each step before its approval; do not silently
  discard steps after the first or execute unseen fallback steps.

## State & Data Models

Conceptual shape; exact names may follow repository conventions. Implement
strict TypeBox schemas in `packages/shared/schemas/` and derive public types in
`packages/shared/types/`. Do not maintain separate handwritten wire types.

```ts
type BattlefieldObject = {
	objectId: string;
	definitionId: string;
	position: GridPoint;
	footprint: GridPoint[];
	durability: number;
	state: "intact" | "broken";
	ignited: boolean;
	affordanceIds: string[];
};

type AffordanceDefinition = {
	affordanceId: string;
	actionCost: CombatActionCost;
	requirements: MechanicalRequirement[];
	check: RegisteredCheckDefinition | null;
	successEffects: RegisteredEffect[];
	failureEffects: RegisteredEffect[];
};

type SurfaceCell = {
	surfaceId: string;
	kind: "oil" | "fire";
	cell: GridPoint;
	expiresAfterRound: number | null;
	sourceObjectId: string | null;
};

type EnvironmentalState = {
	objects: Record<string, BattlefieldObject>;
	surfaces: SurfaceCell[];
	hazardTickStamps: HazardTickStamp[];
};
```

Additional requirements:

- Pin relevant object/affordance/effect definitions or an immutable replay
  dependency bundle into the encounter snapshot. Replay must not fetch the
  latest mutable content pack.
- Add strict environmental command/event variants, stable event identities,
  rejection reasons, and narration fact references.
- Record check inputs/results and explicit object/surface changes.
- Keep runtime entity IDs out of persistent state and replay.
- Bound arrays, strings, coordinates, dice expressions, references, and effect
  expansion. Reject unsupported schema/rules versions.

## Quality Requirements

- **Offline/degraded mode:** All mechanics and direct controls work offline.
  Language failure offers direct controls; narration uses templates.
- **Accessibility/input:** Keyboard-selectable objects and actions, visible
  focus, readable preview, text equivalents for hazard/cover colors, Escape
  cancellation without committing.
- **Performance budget:** Meet the reference workload targets above; no model
  call or animation completion inside the kernel.
- **Security/privacy:** Only perceived affordances enter model context;
  authored descriptions are untrusted data, never executable instructions.
- **Persistence/migration:** Object, surface, and check/tick state survive
  save/reload and projection/application.
- **Cancellation/retry/idempotency:** Stale previews and duplicate commits cannot
  spend resources, reroll checks, or apply an effect twice.
- **Observability:** Log command/event identity, recipe, rejection, check
  provenance, cascade count, and timings without hidden narrative secrets.

## Migration & Rollback

- Increment schema/rules versions when their semantics change. Follow the
  existing compatibility policy rather than replacing all older snapshots.
- Older snapshots migrate to empty environmental state only when they contain
  no environmental mechanics; do not infer destroyed/intact state from scenery.
- Persist committed world-object changes through the existing world-save path.
  Destroyed/moved objects retain stable identity after returning to exploration.
- Combat-scoped temporary surfaces expire at encounter exit unless their
  authored definition explicitly declares world persistence.
- Validate migrations before replacing the old save; retain recoverable data.
- Continue choosing legacy/v2 composition at encounter start. Do not change
  that selection during an active fight.
- Disabling new encounter creation must not make existing environmental saves
  unreadable. Retain the compatible rules or offer an explicit pre-combat
  checkpoint recovery without overwriting the original save.
- Retry follows the established encounter checkpoint policy and restores
  object/surface state consistently with actor state.

## Scope Boundaries

**In scope:** The required registry, checks, objects, cover, oil/fire surfaces,
forced movement, two authored interaction recipes, unified input/preview,
production content, persistence, narration facts, replay, and evidence.

**Out of scope:** Objective/morale resolution and reactions (C-532), new
classes, large spell catalogs, grouped initiative, full physics, general
scripting, asset-generation infrastructure, theme redesign, and legacy removal.

C-526 defects remain C-526 work. Fix and verify them before relying on its
approval/continuation protocols.

## Contract Size & Split Rule

> [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

This is one environmental-action vertical slice. State, authoring, kernel
resolution, preview, and persistence share the same command/event invariants.

Review it in checkpoints: first registry/state, then one complete interaction,
then the second interaction and evidence. Do not merge a production path that
renders effects without authoritative persistence. Independent additional
effect families belong in later contracts.

## Acceptance Criteria

### AC-1: Authored objects are authoritative and persist

**Given** an authored encounter with stable object IDs,
**When** it starts, an object changes, and state is projected/applied again,
**Then** identity, position, durability, affordances, collision, sight, and
cover reflect the committed state without resetting or duplicating objects.

| AC   | Test Level           | Required Artifact                                 | Production Path                  | Evidence |
| ---- | -------------------- | ------------------------------------------------- | -------------------------------- | -------- |
| AC-1 | Schema + integration | Environmental schema and adapter round-trip tests | `/game` encounter initialization | Pending  |

**Test Hooks:** Schemas/engine Moon tests; start from the actual content loader.
**Watch Points:** Entity recycling, missing definitions, object/terrain overlap.

### AC-2: Checks and effects resolve deterministically

**Given** a valid or invalid environmental command,
**When** the kernel validates and resolves it,
**Then** costs, rolls, effects, and event ordering obey the declared rules;
invalid commands do not mutate state or RNG; legal failed checks spend only
the authored attempt cost; duplicate commands cannot reroll.

| AC   | Test Level         | Required Artifact                                                 | Production Path              | Evidence |
| ---- | ------------------ | ----------------------------------------------------------------- | ---------------------------- | -------- |
| AC-2 | Unit + integration | Seeded check/effect, immutability, duplicate, cascade-bound tests | `/game` environmental commit | Pending  |

**Test Hooks:** Utils and engine Moon tests; fixed initial states and seeds.
**Watch Points:** Transactional cascade overflow; success/failure branches.

### AC-3: Environmental geometry and hazards affect later actions

**Given** moved/broken cover, oil/fire, or a forced-movement effect,
**When** an actor queries movement/LoS or resolves an action,
**Then** current geometry and hazards affect legal results consistently;
occupancy remains valid; surface damage/expiry cannot double-tick.

| AC   | Test Level         | Required Artifact                                    | Production Path                         | Evidence |
| ---- | ------------------ | ---------------------------------------------------- | --------------------------------------- | -------- |
| AC-3 | Unit + integration | Cover, movement, impact, and surface lifecycle tests | `/game` tactical preview and resolution | Pending  |

**Test Hooks:** Utils/engine tests; forecast-to-resolution comparisons.
**Watch Points:** Map boundaries, footprints, overlapping hazard sources.

### AC-4: Manual and language inputs share preview and execution

**Given** equivalent manual and language requests from identical state,
**When** each is grounded, previewed, approved, and resolved,
**Then** the resulting mechanical commands/events match; no effect occurs
before approval; each later plan step is freshly previewed and validated.

| AC   | Test Level        | Required Artifact                                     | Production Path                     | Evidence |
| ---- | ----------------- | ----------------------------------------------------- | ----------------------------------- | -------- |
| AC-4 | Integration + E2E | `apps/e2e/tests/client/combat_v2_environment.spec.ts` | `/game` object actions and GM input | Pending  |

**Test Hooks:** Client tests; compiled Playwright tests with a deterministic
interpreter fixture at the existing service boundary.
**Watch Points:** Ambiguous objects, stale previews, duplicate approvals,
unsupported requests, and interrupted multi-step plans.

### AC-5: AI and narration use permitted facts

**Given** visible and hidden environmental objects,
**When** an actor plans or narration renders resolved events,
**Then** only permitted observations enter planning; all actions use the same
registry/kernel; narration references actual checks and environmental events.

| AC   | Test Level  | Required Artifact                                      | Production Path                               | Evidence |
| ---- | ----------- | ------------------------------------------------------ | --------------------------------------------- | -------- |
| AC-5 | Integration | Perception payload, proposal, and narration fact tests | `/game` companion/enemy action and combat log | Pending  |

**Test Hooks:** Engine/client tests with captured provider inputs.
**Watch Points:** Shared-team batching must not imply unapproved shared vision;
an unavailable model must not disable direct object controls.

### AC-6: The authored proof encounter is playable

**Given** a shipped/local-loadable proof encounter with the player, one real
combat-capable companion, three enemies, table, brazier, oil, and support,
**When** the player tips the brazier into oil and breaks the support,
**Then** both interactions produce visible mechanical consequences and the
encounter remains completable through production `/game`.

| AC   | Test Level   | Required Artifact                                                | Production Path                | Evidence |
| ---- | ------------ | ---------------------------------------------------------------- | ------------------------------ | -------- |
| AC-6 | E2E + visual | Environment spec + `apps/e2e/src/visual/suites/combat.visual.ts` | `/game` real content encounter | Pending  |

**Test Hooks:** Direct pass, language-fixture pass, enabled-but-unreachable
provider pass, and flag-off pass. Provision authored content through the
normal pack loader; no synthetic production roster substitution.
**Watch Points:** Test seams may seed/load content, but must not fake resolved
events, patch HP, or mount an isolated substitute combat surface.

### AC-7: Saves and replay preserve environmental consequences

**Given** a save after movement, object destruction, or surface creation,
**When** it is reloaded or its accepted inputs replayed without a model,
**Then** state, events, RNG, and future outcomes match the recorded rules
version; persistent object changes survive return to exploration.

| AC   | Test Level        | Required Artifact                                                 | Production Path                  | Evidence |
| ---- | ----------------- | ----------------------------------------------------------------- | -------------------------------- | -------- |
| AC-7 | Integration + E2E | Migration, save/reload, replay, and exploration persistence tests | `/game` save → reload → continue | Pending  |

**Test Hooks:** Test new saves and a pre-C-531 fixture.
**Watch Points:** Content updates, retry rollback, failed migration.

### AC-8: UI, budgets, and delivery evidence meet the contract

**Given** the supported reference workload and production environment,
**When** functional, performance, accessibility, and visual verification run,
**Then** required controls remain usable, timing results are recorded,
mandatory visual fields pass, and documentation describes supported limits.

| AC   | Test Level               | Required Artifact                                | Production Path              | Evidence |
| ---- | ------------------------ | ------------------------------------------------ | ---------------------------- | -------- |
| AC-8 | E2E + visual + benchmark | Combat visual cases, timing report, updated docs | `/game` environmental combat | Pending  |

**Test Hooks:** Extend the existing `defineConfig`/default-export visual suite.
Cases: `environment-preview` and `environment-resolved`, reached through
`/game` fixture setup. TypeBox result fields: `score`, `objectSelectionVisible`,
`costAndCheckVisible`, `hazardAreaVisible`, `resolvedObjectStateVisible`,
`layoutCorrect`, `issues`. Require applicable boolean fields and score ≥90.
Evaluation checks legibility, target/impact distinction, unclipped controls,
and state matching the fixture. Do not use visual scores to prove mechanics.
**Watch Points:** Screenshots alone are not the visual evaluation result.

## Implementation Sequence

1. Rebase the baseline and verify C-526 prerequisite behavior. Record results.
2. Add versioned definitions/state and the bounded effect/check registry.
3. Implement one complete brazier/oil journey through production and saves.
4. Add breakable-support impact, cover, and forced-movement edge cases.
5. Wire manual/language/AI contexts and environmental narration facts.
6. Run migrations/replay, production E2E, visual, and performance verification.
7. Complete the execution report; request independent verification.

Use direct OpenCode execution and the repository's normal validation commands.
Read `.pi` guidance where required; do not launch the pi pipeline.

## Edge Cases & Gotchas

- A successful roll is not permission to violate bounds or occupancy.
- An extinguished, destroyed, or missing object cannot retain stale actions.
- Multiple objects with the same display name require disambiguation.
- A late language response cannot resurrect a cancelled interaction.
- A surface or impact may down the acting unit; stop remaining plan steps.
- No environmental effect may depend on animation timing.
- Content fixtures must be available through the real loader, including offline.

## Open Questions

No unresolved implementation choices are required to start after approval.
The vocabulary, check semantics, hazard cadence, bounds, and persistence policy
above are proposed decisions of this draft. Changes require an amendment.

Before approval, confirm these decisions against the latest dependency
contracts and identify any concrete conflict; do not silently broaden scope.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date       | Change                                              | Approved by |
| ------- | ---------- | --------------------------------------------------- | ----------- |
| 1.0.0   | 2026-09-14 | Initial draft; bounded environmental vertical slice | Pending     |

## Promotion Lifecycle

> [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

## Execution Report

### Baseline

Not executed. Record actual starting revision, dependency status, content
fixture availability, and baseline commands/results.

### Acceptance Evidence

AC-1 through AC-8: Pending. Replace with per-AC implementation and evidence.

### Changes and Deviations

Pending. List files, migrations, decisions, and approved amendments.

### Verification

Pending. Record exact commands, pass/fail/not-run counts, visual artifacts,
timing environment/results, and independently demonstrated baseline failures.

### Remaining Work and Release Decision

Pending. Any unmet mandatory AC prevents verified/completed status.
This contract does not authorize legacy removal or a production default change.
