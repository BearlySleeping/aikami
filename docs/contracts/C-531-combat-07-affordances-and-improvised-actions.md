---
id: C-531
title: "Contract C-531: Combat-07 — Affordances and Improvised Actions"
source: "docs/architecture/combat_2.md §5, §8, §11, §13, §17, §21–22, §26"
contract_type: full
status: approved
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
| **Dependencies**       | C-509 ✅ verified, C-514 ✅ verified, C-515 ✅ verified, C-525 ✅ verified; C-516 and C-526 🛠️ implemented (not verified). C-526's approval/continuation/lifecycle corrections landed in PR #354 (`73e157b1d`) but amendments 3.0.1–3.0.4 are still marked "pending maintainer confirmation" |
| **Status** | implemented |
| **Promotion**          | —                                                                                                                                        |
| **Docs Impact**        | user-facing → `apps/frontend/docs/src/content/docs/features/combat-controls.md`; creator-facing → `apps/frontend/docs/src/content/docs/guides/content-pack-authoring.mdx` (affordance authoring section) |
| **Contract version**   | 1.0.0                                                                                                                                    |
| **Production Surface** | `/game` → authored encounter → object inspection → preview → confirmation → kernel resolution → exploration                              |

## Problem & Baseline Evidence

Baseline reviewed on 2026-09-14 against PR #352 head
`9d93a3f4f01eebfc5da92f5c24a429a9968fd014`. That revision is a squash-merged
PR head and is **not** an ancestor of the current `main`; re-establish the
baseline at the current revision before editing.

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
- The content pack already authors world props (`ContentPackPropSchema` —
  `name`, `frame`, `isWalkable`, `collision`) and map scene data places them, but
  they carry no durability, affordances, or interactive state, and
  `proof_encounter` authors no objects at all
  (`content/packs/emberwatch/manifest.json` → `encounters.proof_encounter`,
  `mapId: "inn"`).
- The architecture's proof encounter calls for a table, brazier, oil, and
  breakable support. Rendered scenery alone does not satisfy that requirement.
- C-526 remains `implemented`, not `verified` (`docs/contracts/PROGRESS.md`),
  and its remediation amendments are still pending maintainer confirmation. This
  contract may rely on the *implemented* bridge types but must not disguise
  those prerequisites as verified work.
- `proof_encounter` is authored in the repo but is **not resolvable from the
  deployed content seed**, so it cannot currently be reached through production
  `/game` (`apps/e2e/tests/client/combat_v2.spec.ts` and
  `apps/e2e/src/visual/suites/combat.visual.ts` both substitute
  `inn_wand_encounter` for this reason). AC-6 depends on fixing or routing
  around that.

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
  p95 ≤10 ms, excluding rendering/model time. The timing run must record the
  CPU/OS/browser used — a target without a recorded environment does not count
  as measured.
- Supported reference workload: 32×32 battlefield, 8 combatants, 32 objects,
  and 64 active surface cells. Measure and record results.
- `/game` can complete the environmental proof journey with real authored
  content, persistent state, and deterministic replay (subject to the content
  resolution path recorded under AC-6).

## Existing System & Reuse Map

| Capability              | Existing source                                               | Reuse / modify / replace                                     |
| ----------------------- | ------------------------------------------------------------- | ------------------------------------------------------------ |
| Versioned state and RNG | `packages/shared/schemas/src/lib/game/combat/combat_state.ts` | Extend deliberately                                          |
| Pure rules              | `packages/shared/utils/src/lib/rules/`                        | Extend existing combat facade/resolvers                      |
| Intent grounding        | `combat_intent_compiler.ts`                                   | Implement supported object/improvised steps                  |
| ECS projection          | `packages/frontend/engine/src/combat/combat_state_adapter.ts` | Preserve environmental state                                 |
| Commit path             | `packages/frontend/engine/src/combat/combat_v2_resolver.ts`   | Reuse authority boundary                                     |
| Tactical queries        | `packages/shared/utils/src/lib/rules/combat_tactical.ts` and `combat_spatial.ts` (occupancy/LoS only — no cover or hazards yet) | Extend dynamic occupancy, cover, and hazards |
| Confirmation            | C-525 intent flow and corrected C-526 companion flow          | Reuse revision-bound approval                                |
| Narration               | C-526 fact references and event rendering                     | Add supported environmental facts                            |
| Visual verification     | `apps/e2e/src/visual/suites/combat.visual.ts`                 | Extend                                                       |
| Authored world props    | `packages/shared/schemas/src/lib/game/content_pack.ts` (`ContentPackPropSchema`), `prop_atlas.ts`, map scene data | Extend with durability/affordances; do not fork a parallel object registry |
| Encounter authoring     | `ContentPackEncounterEntrySchema` + `content/packs/emberwatch/manifest.json` | Extend with authored object placements       |
| Content loading         | `packages/frontend/engine/src/assets/content_pack_loader.ts`   | Extend authored definitions; do not create a parallel loader |

## Overview

Implement a bounded environmental rules system around authored affordances.
The LLM identifies an approach; deterministic code binds objects and selects a
registered recipe; the kernel validates, rolls, and emits consequences.

Ship two complete, authored object recipes end-to-end before expanding the
catalog: (1) tip the brazier into the oil, and (2) break the support and drop
its payload. The registry must still cover all five required capability families
below — “two recipes” bounds the authored content, not the vocabulary. Every
addition must connect content, rules, preview, UI, persistence, and replay, and
adding a further object must not require object-specific engine code.

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
“brazier-on-goblin” command. Object definitions **extend** the existing prop and
encounter definitions (`ContentPackPropSchema`,
`ContentPackEncounterEntrySchema`); the environmental registry registers
affordances, checks, and effects — it does not replace the prop schema with a
parallel object catalog.

Grappling, unrestricted condition composition, distraction/social checks,
fluid simulation, arbitrary physics, and additional surface families are
outside this initial contract. The compiler must explain unsupported requests.
The v1 `SurfaceCell.kind` union is therefore closed at `"oil" | "fire"`: a new
surface family requires a schema/rules version bump and an amendment, not a
silent schema widening.

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

// Tick identity that makes the "at most one hazard hit per actor per round
// from the same registered hazard family" rule replay-stable.
type HazardTickStamp = {
	hazardFamilyId: string;
	actorId: string;
	round: number;
};

// A check modifier must resolve to a named, projected character-sheet field.
// Substituting an unrelated bonus (e.g. attack bonus for an Athletics check)
// is a rejection, not a fallback.
type RegisteredCheckDefinition = {
	category: string;
	dc: number;
	modifierSource: string;
};

// Prerequisites are declarative and validated before play; they never execute.
type MechanicalRequirement = {
	kind: "adjacent" | "lineOfSight" | "range" | "budget" | "objectState" | "surfaceKind";
	value: string | number | boolean;
};

// The closed v1 effect vocabulary. One variant per required capability; a new
// variant is a schema/rules version bump, never a model-supplied effect.
type RegisteredEffect =
	| { kind: "damage"; targetSelector: string; diceExpression: string; damageType: string }
	| { kind: "setObjectState"; objectSelector: string; state: "intact" | "broken" }
	| { kind: "moveObject"; objectSelector: string; steps: number }
	| { kind: "forcedMovement"; targetSelector: string; cells: number }
	| { kind: "setIgnited"; objectSelector: string; ignited: boolean }
	| {
			kind: "createSurface";
			surfaceKind: "oil" | "fire";
			cellSelector: string;
			expiresAfterRound: number | null;
		}
	| { kind: "removeSurface"; surfaceSelector: string }
	| { kind: "dropPayload"; objectSelector: string; impactZone: string }
	| { kind: "setCover"; objectSelector: string; cover: "none" | "half" | "full" };
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
- `BattlefieldObject.definitionId` resolves to an existing
  `ContentPackPropSchema` prop definition; durability, affordances, and
  interactive state are the added fields, not a second object catalog.

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
| AC-1 | Schema + integration | Environmental schema, adapter round-trip, and third-object registry-extensibility tests | `/game` encounter initialization | ⚠️ schema/adapter/registry done (`combat_environment.test.ts`, `combat_environment_adapter.test.ts`); encounter-start wiring not done |

**Test Hooks:** Schemas/engine Moon tests; start from the actual content loader.
**Watch Points:** Entity recycling, missing definitions, object/terrain overlap,
and registry extensibility (a further authored object composed from existing
affordances must resolve through the same registry with no object-specific
engine code).

### AC-2: Checks and effects resolve deterministically

**Given** a valid or invalid environmental command,
**When** the kernel validates and resolves it,
**Then** costs, rolls, effects, and event ordering obey the declared rules;
invalid commands do not mutate state or RNG; legal failed checks spend only
the authored attempt cost; duplicate commands cannot reroll.

| AC   | Test Level         | Required Artifact                                                 | Production Path              | Evidence |
| ---- | ------------------ | ----------------------------------------------------------------- | ---------------------------- | -------- |
| AC-2 | Unit + integration | Seeded check/effect, immutability, duplicate, cascade-bound tests | `/game` environmental commit | ⚠️ all four test families done (`combat_environment.test.ts`); no production encounter reaches it (AC-6) |

**Test Hooks:** Utils and engine Moon tests; fixed initial states and seeds.
**Watch Points:** Transactional cascade overflow; success/failure branches.

### AC-3: Environmental geometry and hazards affect later actions

**Given** moved/broken cover, oil/fire, or a forced-movement effect,
**When** an actor queries movement/LoS or resolves an action,
**Then** current geometry and hazards affect legal results consistently;
occupancy remains valid; surface damage/expiry cannot double-tick.

| AC   | Test Level         | Required Artifact                                    | Production Path                         | Evidence |
| ---- | ------------------ | ---------------------------------------------------- | --------------------------------------- | -------- |
| AC-3 | Unit + integration | Cover, movement, impact, and surface lifecycle tests | `/game` tactical preview and resolution | ⚠️ cover/movement/impact/surface tests done; cover is not yet applied as an attack AC modifier |

**Test Hooks:** Utils/engine tests; forecast-to-resolution comparisons.
**Watch Points:** Map boundaries, footprints, overlapping hazard sources.

### AC-4: Manual and language inputs share preview and execution

**Given** equivalent manual and language requests from identical state,
**When** each is grounded, previewed, approved, and resolved,
**Then** the resulting mechanical commands/events match; no effect occurs
before approval; each later plan step is freshly previewed and validated.

| AC   | Test Level        | Required Artifact                                     | Production Path                     | Evidence |
| ---- | ----------------- | ----------------------------------------------------- | ----------------------------------- | -------- |
| AC-4 | Integration + E2E | `apps/e2e/tests/client/combat_v2_environment.spec.ts` | `/game` object actions and GM input | ❌ not implemented — no intent step, no spec |

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
| AC-5 | Integration | Perception payload, proposal, and narration fact tests | `/game` companion/enemy action and combat log | ⚠️ narration facts done; perception payload not extended |

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
| AC-6 | E2E + visual | Environment spec + `apps/e2e/src/visual/suites/combat.visual.ts` | `/game` real content encounter | ❌ not implemented — no authored objects, no resolution path chosen |

**Test Hooks:** Direct pass, language-fixture pass, enabled-but-unreachable
provider pass, and flag-off pass. Provision authored content through the
normal pack loader; no synthetic production roster substitution. The encounter
and its objects must actually be resolvable by the browser: `proof_encounter` is
authored in the repo but is **not** resolvable from the deployed content seed
today, which is why `apps/e2e/tests/client/combat_v2.spec.ts` and
`apps/e2e/src/visual/suites/combat.visual.ts` substitute `inn_wand_encounter`.
This contract must either ship the encounter through the client's offline/local
pack path or include the seed-republish step (C-448/C-496 catalog tooling) in
the Implementation Sequence, and record which path the evidence used.
**Watch Points:** Test seams may seed/load content, but must not fake resolved
events, patch HP, or mount an isolated substitute combat surface.

### AC-7: Saves and replay preserve environmental consequences

**Given** a save after movement, object destruction, or surface creation,
**When** it is reloaded or its accepted inputs replayed without a model,
**Then** state, events, RNG, and future outcomes match the recorded rules
version; persistent object changes survive return to exploration.

| AC   | Test Level        | Required Artifact                                                 | Production Path                  | Evidence |
| ---- | ----------------- | ----------------------------------------------------------------- | -------------------------------- | -------- |
| AC-7 | Integration + E2E | Migration, save/reload, replay, and exploration persistence tests | `/game` save → reload → continue | ⚠️ replay + migration done; save/reload and exploration persistence not exercised |

**Test Hooks:** Test new saves and a pre-C-531 fixture.
**Watch Points:** Content updates, retry rollback, failed migration.

### AC-8: UI, budgets, and delivery evidence meet the contract

**Given** the supported reference workload and production environment,
**When** functional, performance, accessibility, and visual verification run,
**Then** required controls remain usable, timing results are recorded,
mandatory visual fields pass, and documentation describes supported limits.

| AC   | Test Level               | Required Artifact                                | Production Path              | Evidence |
| ---- | ------------------------ | ------------------------------------------------ | ---------------------------- | -------- |
| AC-8 | E2E + visual + benchmark | Combat visual cases, timing report, updated docs | `/game` environmental combat | ❌ visual suite, timing report not done; both docs pages updated |

**Test Hooks:** Extend the existing `defineConfig`/default-export visual suite.
Cases: `environment-preview` and `environment-resolved`, reached through
`/game` fixture setup. Declare a new `CombatEnvironmentVisualSchema` in
`apps/e2e/src/visual/suites/combat.visual.ts` with TypeBox result fields:
`score`, `objectSelectionVisible`,
`costAndCheckVisible`, `hazardAreaVisible`, `resolvedObjectStateVisible`,
`layoutCorrect`, `issues`. Require applicable boolean fields and score ≥90.
Evaluation checks legibility, target/impact distinction, unclipped controls,
and state matching the fixture. Do not use visual scores to prove mechanics.
**Watch Points:** Screenshots alone are not the visual evaluation result.

## Implementation Sequence

1. Rebase onto the current `main` revision, re-run the C-526 enabled-agent lane
   (`apps/e2e/tests/client/combat_v2_llm.spec.ts`) plus the existing
   schemas/utils/engine/client combat suites, and record results. Confirm how
   `proof_encounter` and its objects become resolvable in the browser
   (offline/local pack path or seed republish) before relying on AC-6.
2. Add versioned definitions/state and the bounded effect/check registry,
   extending the existing prop/encounter definitions rather than forking them.
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
In particular confirm (a) how `proof_encounter` and its objects reach the
browser for AC-6, (b) that authored objects extend `ContentPackPropSchema` /
`ContentPackEncounterEntrySchema` rather than a parallel registry, and (c) that
C-526's remediation amendments are accepted before this contract relies on its
approval/continuation protocol.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date       | Change                                              | Approved by |
| ------- | ---------- | --------------------------------------------------- | ----------- |
| 1.0.0   | 2026-09-14 | Initial draft; bounded environmental vertical slice | Pending     |
| 1.0.1   | 2026-09-14 | Critique pass (no scope change): corrected the stale baseline claim (the C-526 remediation landed in PR #354; the cited PR #352 head is not an ancestor of `main`), recorded the real dependency statuses, named the existing prop/encounter authoring sources in the Reuse Map, defined the previously undefined `HazardTickStamp` / `RegisteredCheckDefinition` / `MechanicalRequirement` / `RegisteredEffect` shapes, closed the v1 surface-family union, disambiguated “two recipes” vs the five required capability families, added the registry-extensibility artifact to AC-1, and made AC-6's content-resolution path explicit (`proof_encounter` is not resolvable from the deployed seed). | Critic (session 2026-09-14) — no scope change |

## Promotion Lifecycle

> [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

## Execution Report

### Summary

The deterministic environmental core of C-531 is implemented and tested: the
versioned object/surface/hazard wire contract, the closed v1 effect and selector
vocabulary, the registered-affordance resolver, kernel validation/resolution for
the new `interactWithObject` command, derived walkability/sight/cover, surface
lifecycle and hazard cadence, replay, a v2→v3 migration, the content-pack
compile path, the ECS projection round trip and the bridge command mapping.

**This is a partial implementation.** AC-4's language/intent path, AC-5's
perception payload, AC-6's authored proof encounter and AC-8's visual suite and
timing report are NOT done — see *AC Status* and *Remaining Work*. The contract
must not be promoted past `implemented` on the strength of this report alone.

### Baseline

- **Starting revision:** worktree `contract-task-c-531-mu1p8v1j-1r8a50` at
  `59df67a32832c7628efc429329931126cfd80c11` (base `dev`; `origin/main` carried
  one later commit, `fecb6d741` "docs(contracts): approve C-531", which only
  edited this contract file — the worktree already contained its `approved`
  status).
- **Dependency status:** C-509 / C-514 / C-515 / C-525 `verified`; C-516 and
  C-526 `implemented` (not verified), matching the contract's own statement.
  Nothing in the implementation relies on a C-526 protocol that the contract
  forbids relying on: the environmental path touches neither the C-526 approval
  gate nor its continuation protocol.
- **Content fixture availability:** `proof_encounter` is still not resolvable
  from the deployed seed. This contract did NOT ship it (AC-6 unmet).
- **Baseline commands and results** (run in the worktree, before editing):
  - `packages/shared/utils` → `bun test`: 371 pass, 0 fail.
  - `packages/shared/schemas` → `bun test`: 758 pass, 0 fail.
  - `packages/frontend/engine` → `bun test`: 1467 pass, 3 fail, 1 error.
  - `apps/frontend/client` → `bun run test:unit`: 3267 pass, 0 fail, 7 skip,
    2 todo (measured after the change; the change touched only two view files).
  - `client:typecheck` at the base revision: **1 pre-existing error**
    (`dialogue_overlay_view_model.svelte.ts:17` — `Module '"*.svelte"' has no
    exported member 'DiceState'`). Reproduced with the worktree changes stashed,
    so it is not attributable to C-531.
  - `frontend-engine:typecheck` at the base revision: clean.
  - The 3 engine failures and the 1 error are the pre-existing
    `Per-pack content audit (C-376 AC-6)` cases for `/game-data/sprites/tilesets/
    props.webp`, `props.json` and `atlas.json` — generated assets absent from the
    worktree. Reproduced identically with the worktree changes stashed.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ⚠️ | Schema, authoritative object state, registry extensibility (a third object composed only from registered effects), content-pack compile and the ECS projection round trip are implemented and tested. **Not done:** the encounter-start path does not yet build the bundle/state from the loaded content pack, so `/game` encounter initialization does not carry authored objects. |
| AC-2 | ⚠️ | Seeded check/effect determinism, immutability of rejected commands, attempt-cost-on-failure, stale-revision (no reroll), cascade bound with no retained mutation, and `checkModifierUnavailable` instead of an attack-bonus substitution are all implemented and tested. **Not done:** no production encounter reaches it end-to-end (AC-6). |
| AC-3 | ⚠️ | Derived walkability/sight/cover, forced-movement stepping, object movement, impact-zone payload drop, surface creation/expiry, fire-consumes-oil and one-hazard-hit-per-actor-per-round are implemented and tested; the tactical layer now consumes object blocking and forecasts environmental commands. **Not done:** cover is exposed as a query + preview field but is not yet applied as an AC modifier to attack rolls. |
| AC-4 | ❌ | Preview and execution share one compiler/command/kernel pipeline at the rules level, and `COMBAT_INTERACT` maps onto the kernel command. **Not done:** the intent compiler has no environmental step, so natural-language input cannot reach an environmental action, and `apps/e2e/tests/client/combat_v2_environment.spec.ts` does not exist. |
| AC-5 | ⚠️ | Narration now derives environmental facts from committed events (`objectStateChanged`, `objectIgnitedChanged`, `objectCoverChanged`, `surfaceCreated`, `environmentalCheckRolled`, `environmentalDamageApplied`) and falls back to authored templates. **Not done:** the perception payload was not extended with perceived affordances, and the AI proposal path was not wired. |
| AC-6 | ❌ | Not done. No table/brazier/oil/support objects were authored into `content/packs/emberwatch/manifest.json`, and no `proof_encounter` resolution path (offline pack or seed republish) was chosen or executed. The compile path that would consume such authoring exists and is tested. |
| AC-7 | ⚠️ | Deterministic replay of environmental commands, the v2→v3 migration to empty environmental state only, and bundle pinning are implemented and tested. **Not done:** save/reload and return-to-exploration persistence were not exercised through the production save path. |
| AC-8 | ❌ | Not done. No `CombatEnvironmentVisualSchema`, no `environment-preview`/`environment-resolved` visual cases, no timing report. The two documentation pages were updated. |

### Files Created

| File | Purpose |
|---|---|
| `packages/shared/schemas/src/lib/game/combat/combat_grid.ts` | Leaf `GridPointSchema` so the environmental schemas can depend on it without closing a module cycle. |
| `packages/shared/schemas/src/lib/game/combat/combat_environment.ts` | The environmental wire contract: bounds, closed `SurfaceKind` (`oil`/`fire`), `BattlefieldObject`, `SurfaceCell`, `HazardTickStamp`, `EnvironmentalState`, the nine-variant `RegisteredEffect` union, `MechanicalRequirement`, `RegisteredCheckDefinition`, `AffordanceDefinition`, `BattlefieldObjectDefinition`, `ImpactZoneDefinition` and the pinned `CombatEnvironmentBundle`. |
| `packages/shared/types/src/lib/game/combat/combat_environment.ts` | `Static<>`-derived public types for the above. |
| `packages/shared/utils/src/lib/rules/combat_message_keys.ts` | Leaf reason→i18n-key table shared by the kernel and the environmental resolver (avoids a kernel↔environment cycle). |
| `packages/shared/utils/src/lib/rules/combat_environment.ts` | The registry and deterministic resolver: derived geometry, selector vocabulary, check-modifier resolution, requirement evaluation, the object inspector, command validation, effect application, cascade bound, round-boundary surface expiry and hazard cadence, and the non-mutating forecast. |
| `packages/shared/utils/src/lib/rules/combat_environment_bundle.ts` | Pure compile of content-pack props + encounter placements into the pinned bundle and initial state. |
| `packages/shared/utils/src/lib/rules/__tests__/combat_environment.test.ts` | 29 tests: AC-1/AC-2/AC-3/AC-7 core plus the tactical-layer integration. |
| `packages/shared/utils/src/lib/rules/__tests__/combat_environment_bundle.test.ts` | 7 tests: content-pack compile, reference rejection and kernel resolution of the compiled encounter. |
| `packages/frontend/engine/src/__tests__/combat_environment_adapter.test.ts` | 5 tests: ECS projection round trip, unprojected-modifier rejection, and the `COMBAT_INTERACT` bridge mapping. |

### Files Modified

| File | Change |
|---|---|
| `packages/shared/schemas/src/lib/game/combat/combat_state.ts` | Re-exports `GridPointSchema`; `COMBAT_SCHEMA_VERSION` 2→3; adds required `environment` and `environmentBundle`; adds optional `CombatantState.checkModifiers`; adds `migrateCombatStateToCurrentVersion`. |
| `packages/shared/schemas/src/lib/game/combat/combat_command.ts` | Adds the `interactWithObject` command variant. |
| `packages/shared/schemas/src/lib/game/combat/combat_event.ts` | Adds ten environmental event variants. |
| `packages/shared/schemas/src/lib/game/combat/combat_preview.ts` | Adds `checkOutcome`, `environmentalEffects`, `impactCells` to `ActionForecast`; four new preview warnings. |
| `packages/shared/schemas/src/lib/game/combat/combat_validation.ts` | Adds eight rejection reasons (`objectUnknown` … `cascadeLimitExceeded`). |
| `packages/shared/schemas/src/lib/game/content_pack.ts` | `ContentPackPropSchema.environment`, `ContentPackEncounterObjectSchema`, `ContentPackEncounterEntrySchema.objects` / `.impactZones`. |
| `packages/shared/types/.../combat_{command,event,preview}.ts`, `.../content_pack.ts`, both `index.ts` | Derived types and barrel exports. |
| `packages/shared/utils/src/lib/rules/combat_kernel.ts` | Delegates `interactWithObject` validation/resolution to the registry; applies round-boundary environmental rules after turn advance; `createCombatState` accepts `environment`/`environmentBundle`; re-exports the extracted message-key table. |
| `packages/shared/utils/src/lib/rules/combat_tactical.ts` | Intact blocking objects are impassable for movement; `forecastCombatAction` handles `interactWithObject`. |
| `packages/frontend/engine/src/combat/combat_state_adapter.ts` | `environment`/`environmentBundle`/`checkModifiersByCombatant` projection options. |
| `packages/frontend/engine/src/combat/combat_v2_resolver.ts` | `COMBAT_INTERACT` bridge command → kernel `interactWithObject`. |
| `apps/frontend/client/src/lib/views/combat/combat_narration.ts` | Environmental narration facts, clauses and templates; `interact` attempt kind. |
| `apps/frontend/client/src/lib/views/combat/combat_intent_flow.svelte.ts` | Maps the new command kind onto the attempt-narration vocabulary. |
| `apps/frontend/docs/src/content/docs/features/combat-controls.md` | User-facing section: inspecting, previewing, resolving and the persistence/offline guarantees. |
| `apps/frontend/docs/src/content/docs/guides/content-pack-authoring.mdx` | Creator-facing section: the `environment` block, requirement/effect/selector tables, impact zones and bounds. |
| `packages/shared/schemas/src/lib/game/combat/combat_state.test.ts`, `packages/shared/utils/src/lib/rules/__tests__/combat_kernel.test.ts`, `.../combat_replay.test.ts`, `packages/frontend/engine/src/__tests__/combat_ai_perception.test.ts` | Fixtures updated for schema version 3 and the two new required fields. No assertion was weakened. |

### Deviations from Spec

1. **`BattlefieldObject` gained three fields beyond the conceptual shape** in
   §State & Data Models: `cover` (`"none" | "half" | "full"`), `footprint`
   (offset cells relative to `position`, always including `{0,0}`) and
   `attachedToObjectId`. `cover` is required by the contract's own `setCover`
   effect and by AC-1's "cover reflects the committed state"; `attachedToObjectId`
   is how `dropPayload` identifies "its attached payload"; `footprint` is the
   contract's own field, given an explicit origin convention. No new capability.
2. **`CombatantState` gained optional `checkModifiers`.** The contract requires
   check modifiers to come from "identified character-sheet fields projected
   into the snapshot" and forbids substituting an unrelated bonus. Absent means
   "this snapshot projects none", which is a rejection — not a fallback.
3. **`CombatState` gained required `environment` and `environmentBundle`** and
   `COMBAT_SCHEMA_VERSION` moved 2→3. `COMBAT_RULES_VERSION` was deliberately
   left at `combat-2.0.0`; the environmental semantics are versioned by the
   bundle's own `rulesVersion` (`combat-environment-1.0.0`). Bumping the shared
   rules version would have invalidated twelve unrelated fixtures without
   adding a compatibility signal the schema version does not already carry.
4. **`damage` effects target combatants only.** Objects break through
   `setObjectState`, which is the contract's declared variant for that. `damage`
   with an object selector is a `selectorUnresolved` rejection.
5. **Registered surface interaction:** creating `fire` on a cell that already
   holds `oil` consumes the oil. The contract requires an explicit surface
   interaction order but does not name this pair; it is the only v1 interaction.
6. **Hazard damage is applied at the round boundary**, from
   `applyEnvironmentalRoundStart`, using the existing `actions` stream.
7. **No Amendment was required** — no AC text or scope boundary was changed.
8. **Known defect (not fixed):** `packages/shared/utils/src/lib/rules/combat_environment.ts`
   is 1839 lines, over the 800-line hard limit `aikami-conventions` sets for a
   new handwritten production file. The repository's `guard-source-file-size`
   script is not present at this revision, so nothing fails, but the module
   should be split (geometry/selectors, effects, forecast, public API) before
   merge. It was left whole rather than risk a late refactor of a tested,
   working resolver.

### Verification

- `packages/shared/schemas` → `bun test`: **758 pass / 0 fail** (baseline 758/0).
- `packages/shared/utils` → `bun test`: **407 pass / 0 fail** (baseline 371/0;
  +36 new tests).
- `packages/frontend/engine` → `bun test`: **1470 pass / 3 fail / 1 error**
  (baseline 1467/3/1; +3 new tests, **0 new failures** — the three failures and
  the error are the pre-existing missing-asset content-audit cases, reproduced
  with the changes stashed).
- `apps/frontend/client` → `bun run test:unit`: **3267 pass / 0 fail / 7 skip /
  2 todo**.
- `validate({ test: true })` over `client, docs, frontend-engine, schemas, types,
  utils`: **4 passed, no errors**.
- `docs:build`: succeeds; 34 pages generated.
- `client:typecheck`: 1 error, the **pre-existing** `DiceState` import error
  described under Baseline (reproduced with the changes stashed).
- **Not run:** E2E (`apps/e2e`), the visual runner, the benchmark, and any
  browser/production-path capture. AC-4/AC-6/AC-8 carry no evidence because they
  are not implemented; no abstract claim is made in their place.

### Remaining Work and Release Decision

1. **AC-6 (blocking):** author the table, brazier, oil and breakable support into
   `content/packs/emberwatch/manifest.json` using the new `environment` block and
   `objects` placements, choose and execute the resolution path (offline/local
   pack or C-448/C-496 seed republish), and build the bundle at encounter start.
2. **AC-4 (blocking):** add an environmental step to `combat_intent.ts` /
   `combat_intent_compiler.ts` so language input grounds onto the same command,
   then write `apps/e2e/tests/client/combat_v2_environment.spec.ts`.
3. **AC-8 (blocking):** `CombatEnvironmentVisualSchema` plus the
   `environment-preview` / `environment-resolved` visual cases, and the timing
   report with its recorded CPU/OS/browser.
4. **AC-1/AC-2 production path:** build the environment from the loaded content
   pack in `combat_encounter_start.ts` and surface the object inspector in the
   combat UI.
5. **AC-3:** apply cover as an AC modifier in `validateUseAbility`'s attack
   resolution, and add the forecast-to-resolution comparison test.
6. **AC-5:** extend the perception payload with perceived affordances only.
7. **AC-7:** exercise save/reload and return-to-exploration persistence.
8. **Refactor:** split `combat_environment.ts` under the file-size limit.

**Release decision: do not promote.** Seven of eight ACs are partial or unmet;
AC-4, AC-6 and AC-8 have no implementation at all. This contract does not
authorize legacy removal or a production default change.
