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
    pr_url: "https://github.com/BearlySleeping/aikami/pull/359"
    pr_number: 359
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
| AC-1 | Schema + integration | Environmental schema, adapter round-trip, and third-object registry-extensibility tests | `/game` encounter initialization | ✅ schema/adapter/registry + encounter-start wiring done (`combat_environment.test.ts`, `combat_environment_adapter.test.ts`, `combat_encounter_environment.test.ts`); inspector surfaced in `object_inspector.svelte`. Not browser-verified. |

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
| AC-2 | Unit + integration | Seeded check/effect, immutability, duplicate, cascade-bound tests | `/game` environmental commit | ✅ all four test families done (`combat_environment.test.ts`); reachable via the inspector → `COMBAT_INTERACT` → kernel. Not browser-verified. |

**Test Hooks:** Utils and engine Moon tests; fixed initial states and seeds.
**Watch Points:** Transactional cascade overflow; success/failure branches.

### AC-3: Environmental geometry and hazards affect later actions

**Given** moved/broken cover, oil/fire, or a forced-movement effect,
**When** an actor queries movement/LoS or resolves an action,
**Then** current geometry and hazards affect legal results consistently;
occupancy remains valid; surface damage/expiry cannot double-tick.

| AC   | Test Level         | Required Artifact                                    | Production Path                         | Evidence |
| ---- | ------------------ | ---------------------------------------------------- | --------------------------------------- | -------- |
| AC-3 | Unit + integration | Cover, movement, impact, and surface lifecycle tests | `/game` tactical preview and resolution | ✅ cover/movement/impact/surface tests done, including cover as an attack AC modifier and the forecast-to-resolution comparison |

**Test Hooks:** Utils/engine tests; forecast-to-resolution comparisons.
**Watch Points:** Map boundaries, footprints, overlapping hazard sources.

### AC-4: Manual and language inputs share preview and execution

**Given** equivalent manual and language requests from identical state,
**When** each is grounded, previewed, approved, and resolved,
**Then** the resulting mechanical commands/events match; no effect occurs
before approval; each later plan step is freshly previewed and validated.

| AC   | Test Level        | Required Artifact                                     | Production Path                     | Evidence |
| ---- | ----------------- | ----------------------------------------------------- | ----------------------------------- | -------- |
| AC-4 | Integration + E2E | `apps/e2e/tests/client/combat_v2_environment.spec.ts` | `/game` object actions and GM input | ⚠️ intent step + spec exist (`combat_environment_intent.ts`, `combat_v2_environment.spec.ts`); spec NOT executed — client cannot boot here |

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
| AC-5 | Integration | Perception payload, proposal, and narration fact tests | `/game` companion/enemy action and combat log | ✅ perception payload extended with perceived objects/affordances (`combat_ai_perception.test.ts`); the AI prompt lists them and `interact_with_object` grounds through `compileActionIntent` (`combat_environment.test.ts`); narration facts done |

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
| AC-6 | E2E + visual | Environment spec + `apps/e2e/src/visual/suites/combat.visual.ts` | `/game` real content encounter | ⚠️ objects authored + resolution path recorded (dev asset origin serving `content/packs/emberwatch/manifest.json`, which requires a catalog snapshot) + compile test on the shipped manifest; spec and visual cases written but NOT executed |

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
| AC-7 | Integration + E2E | Migration, save/reload, replay, and exploration persistence tests | `/game` save → reload → continue | ✅ save envelope v5 carries the world-object block (checksum-covered, version-aware so older saves still validate), the engine persists object state on encounter exit and overlays it on re-entry, and a load seeds the engine block — `game_save_environment.test.ts` drives the PRODUCTION envelope |

**Test Hooks:** Test new saves and a pre-C-531 fixture.
**Watch Points:** Content updates, retry rollback, failed migration.

### AC-8: UI, budgets, and delivery evidence meet the contract

**Given** the supported reference workload and production environment,
**When** functional, performance, accessibility, and visual verification run,
**Then** required controls remain usable, timing results are recorded,
mandatory visual fields pass, and documentation describes supported limits.

| AC   | Test Level               | Required Artifact                                | Production Path              | Evidence |
| ---- | ------------------------ | ------------------------------------------------ | ---------------------------- | -------- |
| AC-8 | E2E + visual + benchmark | Combat visual cases, timing report, updated docs | `/game` environmental combat | ⚠️ timing report committed (`docs/verification/C-531-timing.md`, both p95 PASS) + visual schema/cases + both docs pages; visual runner NOT executed |

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

Implemented: the versioned environmental wire contract (objects, surfaces, hazard
ticks, the closed nine-variant effect vocabulary, the selector vocabulary and the
pinned replay bundle), the registered-affordance resolver, kernel
validation/resolution for `interactWithObject`, derived walkability/sight/cover
**including cover as an attack AC modifier**, forced movement, object movement,
impact-zone payload drops, surface lifecycle with one-hazard-hit-per-actor-per-round,
the cascade bound, replay, the v2→v3 migration, the content-pack compile path,
encounter-start wiring, the `COMBAT_INTERACT` bridge command, the object inspector
in the combat UI, the environmental intent step, environmental narration facts,
perceived-affordance perception **with a proposal path**, **world-object persistence
through the production save envelope (v5)**, two documentation pages, an E2E spec,
two visual cases and a committed timing report.

**Not independently run in this session:** the Playwright E2E lane and the visual
runner. Everything else — including the AC-7 persistence path through the real
save-envelope boundary — is exercised by the suites below. The client cannot boot
here because `PUBLIC_ASSETS_BASE_URL` (`http://localhost:8788`) has no working
target: the local asset origin refuses to start without
`.local/catalog/production/snapshots`, and there is no bundled fallback. The
**pre-existing** `apps/e2e/tests/client/combat_v2.spec.ts` lane fails identically
with `ContentPackLoader: manifest not found (HTTP 404)`, so this is an
environmental precondition, not a C-531 regression. AC-4, AC-6 and AC-8 therefore
carry written-but-unexecuted production-path evidence, and are reported as such.

### Baseline

- **Starting revision:** worktree `contract-task-c-531-mu1p8v1j-1r8a50`, base
  `59df67a32832c7628efc429329931126cfd80c11` (bootstrap). `origin/main` carried one
  later commit (`fecb6d741`, which only set this contract's status to `approved`).
- **Dependency status:** C-509 / C-514 / C-515 / C-525 `verified`; C-516 and C-526
  `implemented` (not verified), matching the contract's own statement. The
  environmental path touches neither the C-526 approval gate nor its continuation
  protocol, so nothing here relies on C-526 remediation.
- **Content fixture availability at baseline:** `proof_encounter` was authored in
  the repo but unresolvable from the deployed seed. AC-6 was resolved by shipping
  it through the **client's local/offline pack path** — see *Deviations* §3.
- **Baseline commands and results** (run in the worktree with the changes stashed,
  so every failure below is demonstrably pre-existing):
  - `packages/shared/schemas` → `bun test`: **758 pass / 0 fail**.
  - `packages/shared/utils` → `bun test`: **371 pass / 0 fail**.
  - `packages/frontend/engine` → `bun test`: **1467 pass / 3 fail / 1 error**.
  - `scripts` → `bun test`: **1 failure**, `pre_commit checkPlaintextSecrets`
    ("fails closed when git inspection itself fails") — it inspects git and this is
    a worktree.
  - `apps/frontend/client` → `bun run typecheck`: **1 pre-existing error**
    (`dialogue_overlay_view_model.svelte.ts:17` — `Module '"*.svelte"' has no
    exported member 'DiceState'`). `svelte-check` alone is clean; only the `tsc`
    lane reports it.
  - The 3 engine failures and the 1 engine error are the pre-existing
    `Per-pack content audit (C-376 AC-6)` cases for
    `/game-data/sprites/tilesets/{props.webp,props.json,atlas.json}` — those
    generated assets are absent from the worktree.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Authoritative object state, adapter round trip, third-object registry extensibility, content-pack compile and **encounter-start wiring** (`startProductionEncounter` pins the pair; `buildV2CombatState` projects it) are implemented and tested. The object inspector is surfaced in the production combat sidebar. Not browser-verified (see Summary). |
| AC-2 | ✅ | Seeded check/effect determinism, rejected-command immutability, attempt-cost-on-failure, stale-revision no-reroll, cascade bound with no retained mutation, and `checkModifierUnavailable` instead of an attack-bonus substitution — all tested. Reachable through production `/game` via the inspector and `COMBAT_INTERACT`. Not browser-verified. |
| AC-3 | ✅ | Derived walkability/sight/cover, **cover applied as an attack AC modifier** in the kernel *and* in the forecast (so preview and commit agree), forced-movement stepping, object movement, impact-zone payload drop, surface creation/expiry, fire-consumes-oil and one-hazard-hit-per-actor-per-round. The required forecast-to-resolution comparison test exists. |
| AC-4 | ⚠️ | The intent compiler now grounds `interact_with_object` through the same command the inspector sends (the line-670 reservation is discharged), and `apps/e2e/tests/client/combat_v2_environment.spec.ts` exists with four cases. **The spec has not been executed** — the client cannot boot in this session. |
| AC-5 | ✅ | `CombatDecisionContextSchema` gained `visibleObjects` (perceived objects only, each with only its registry-available affordances) plus a negative test proving an unperceived object's id never enters the serialised context. The AI system prompt names the field and the `interact_with_object` step, and that step grounds through `compileActionIntent` — the same path as player language — so a companion or enemy can actually choose an environmental action. Narration derives environmental facts from committed events. |
| AC-6 | ⚠️ | The table, brazier, oil pool, breakable support and attached payload are authored into `content/packs/emberwatch/manifest.json` with their affordances and impact zone; the resolution path is chosen and recorded (client local/offline pack path); `buildEnvironmentFromContent` compiles it and a test compiles the **shipped** manifest. **The production journey has not been run in a browser.** |
| AC-7 | ✅ | Deterministic replay, bundle pinning, the v2→v3 migration and a JSON save-format round trip are tested. Committed object changes now persist through the **production save envelope**: a v5 `world` block (checksum-covered; the digest is version-aware so v3/v4 saves still validate), a per-world engine store captured on encounter exit and overlaid on the next encounter start (identity preserved, combat-scoped surfaces dropped, content-removed props dropped), and a load that seeds the engine block. `game_save_environment.test.ts` drives the real `parseSavePayloadEnvelope` / `validateEnvelopeChecksum` boundary. |
| AC-8 | ⚠️ | The timing report exists at `docs/verification/C-531-timing.md` with the recorded CPU/OS/runtime and both p95 targets PASSing; `CombatEnvironmentVisualSchema` and the `environment-preview` / `environment-resolved` cases exist with `requiredTrueFields` and `minScore: 90`; both docs pages are updated. **The visual runner has not been executed** in this session. |

### Files Created

| File | Purpose |
|---|---|
| `packages/shared/schemas/src/lib/game/combat/combat_grid.ts` | Leaf `GridPointSchema`, so the environmental schemas can depend on it without closing a module cycle. |
| `packages/shared/schemas/src/lib/game/combat/combat_environment.ts` | The environmental wire contract: bounds, the closed `SurfaceKind` (`oil`/`fire`), `BattlefieldObject`, `SurfaceCell`, `HazardTickStamp`, `EnvironmentalState`, the nine-variant `RegisteredEffect` union, `MechanicalRequirement`, `RegisteredCheckDefinition`, `AffordanceDefinition`, `BattlefieldObjectDefinition`, `ImpactZoneDefinition` and the pinned `CombatEnvironmentBundle`. |
| `packages/shared/schemas/src/lib/game/content_pack_environment.ts` | `ContentPackPropEnvironmentSchema`, `ContentPackEncounterObjectSchema`, `ContentPackEncounterEnvironmentSchema` — the content-pack extension (extracted so `content_pack.ts` returns to its baseline). |
| `packages/shared/schemas/src/lib/game/content_pack_encounter.ts` | The encounter-authoring block (skill check, loot entry, encounter entry) extracted for the same reason. |
| `packages/shared/types/src/lib/game/combat/combat_environment.ts` | `Static<>`-derived public types. |
| `packages/shared/utils/src/lib/rules/combat_message_keys.ts` | Leaf reason→i18n-key table shared by the kernel and the resolver. |
| `packages/shared/utils/src/lib/rules/combat_environment_internal.ts` | Constants, result shapes, derived geometry (including `coverArmorClassBonus`), lookups and dice helpers. |
| `packages/shared/utils/src/lib/rules/combat_environment_selectors.ts` | The registered selector vocabulary, check-modifier resolution, the requirement evaluator and the object inspector's projection. |
| `packages/shared/utils/src/lib/rules/combat_environment_effects.ts` | One implementation per registered effect kind, plus the budget spend and the forced/object movement steppers. |
| `packages/shared/utils/src/lib/rules/combat_environment_resolver.ts` | Pure validation, the transactional commit path and the round-boundary rules. |
| `packages/shared/utils/src/lib/rules/combat_environment_forecast.ts` | The deterministic, non-mutating forecast. |
| `packages/shared/utils/src/lib/rules/combat_environment.ts` | Explicit public re-export barrel (the module split must not leak internals). |
| `packages/shared/utils/src/lib/rules/combat_environment_intent.ts` | Grounds the `interact_with_object` intent step against the pinned registry (compiler helpers injected, so no cycle). |
| `packages/shared/utils/src/lib/rules/combat_environment_bundle.ts` | Pure compile of content-pack props + encounter placements into the pinned bundle and initial state. |
| `packages/shared/utils/src/lib/rules/combat_canonical_json.ts` | Leaf canonical sorted-key JSON. |
| `packages/shared/utils/src/lib/rules/combat_replay.ts` | `replayCombat` / `findFirstCombatDivergence`, extracted so the kernel returns under the file-size limit. |
| `packages/shared/utils/src/lib/rules/__tests__/combat_environment.test.ts` | 33 tests: AC-1/AC-2/AC-3 including the cover AC modifier and the forecast-to-resolution comparison. |
| `packages/shared/utils/src/lib/rules/__tests__/combat_environment_bundle.test.ts` | 7 tests: content-pack compile, reference rejection, kernel resolution of the compiled encounter. |
| `packages/shared/utils/src/lib/rules/__tests__/combat_environment_persistence.test.ts` | 4 tests: save-format round trip, replay from the serialized state, migration, unresolvable-reference rejection. |
| `packages/frontend/engine/src/combat/combat_encounter_environment.ts` | Per-world pinned `{ state, bundle }` store, cleared with the encounter. |
| `packages/frontend/engine/src/__tests__/combat_environment_adapter.test.ts` | 5 tests: ECS projection round trip, unprojected-modifier rejection, `COMBAT_INTERACT` bridge mapping. |
| `apps/frontend/client/src/lib/services/game/combat_encounter_environment.ts` | Content-pack → pinned environmental pair, on the thread that owns the loader. |
| `apps/frontend/client/src/lib/services/game/combat_encounter_environment.test.ts` | 3 tests: compiles the **shipped** `proof_encounter`, asserts both recipes and the impact zone, and that an encounter authoring no objects stays empty. |
| `apps/frontend/client/src/lib/views/combat/combat_object_inspector.svelte.ts` | The inspector controller: engine-derived availability with reasons → non-committing preview → explicit confirm. |
| `apps/frontend/client/src/lib/views/combat/combat_object_inspector.test.ts` | 10 tests: engine-derived rows, broken-object unavailability, no commit while previewing, confirm-only-after-preview, typed rejections, cancel. |
| `apps/frontend/client/src/lib/views/combat/components/object_inspector.svelte` | The panel: keyboard-reachable buttons, `aria-pressed`, text equivalents for cover/burning, Confirm/Cancel. |
| `apps/e2e/tests/client/combat_v2_environment.spec.ts` | AC-4/AC-6 production journey spec (4 cases). Written, not executed here. |
| `packages/frontend/engine/src/combat/combat_world_object_state.ts` | The per-world object state that outlives an encounter: capture on exit, overlay on the next start, drop combat-scoped surfaces. |
| `apps/frontend/client/src/lib/services/game/game_save_environment.test.ts` | 7 tests driving the PRODUCTION envelope (write → parse → checksum), the v4→v5 compatibility branch, tamper rejection, and the return-to-exploration overlay. |
| `scripts/src/lib/ops/benchmark_combat_environment.ts` | The reference-workload benchmark that writes the timing report. |
| `docs/verification/C-531-timing.md` | The committed timing report (workload, recorded environment, both p95 results). |

### Files Modified

| File | Change |
|---|---|
| `packages/shared/schemas/src/lib/game/combat/combat_state.ts` | Re-exports `GridPointSchema`; `COMBAT_SCHEMA_VERSION` 2→3; required `environment` + `environmentBundle`; optional `CombatantState.checkModifiers`; `migrateCombatStateToCurrentVersion`. |
| `packages/shared/schemas/src/lib/game/combat/combat_command.ts` | The `interactWithObject` command variant. |
| `packages/shared/schemas/src/lib/game/combat/combat_event.ts` | Ten environmental event variants. |
| `packages/shared/schemas/src/lib/game/combat/combat_preview.ts` | `checkOutcome`, `environmentalEffects`, `impactCells` on `ActionForecast`; four new warnings. |
| `packages/shared/schemas/src/lib/game/combat/combat_validation.ts` | Eight new rejection reasons. |
| `packages/shared/schemas/src/lib/game/combat/combat_intent.ts` | The `interact_with_object` intent step. |
| `packages/shared/schemas/src/lib/game/combat/combat_ai_decision.ts` | `visibleObjects` + `VisibleObjectContextSchema` + two bounds. |
| `packages/shared/schemas/src/lib/game/content_pack.ts` | `props[].environment`, `encounters[].environment`; the extracted blocks are re-exported so the public surface is unchanged. |
| `packages/shared/types/...` (combat command/event/preview/environment/ai_decision, content_pack, barrels) | Derived types and barrel exports. |
| `packages/shared/utils/src/lib/rules/combat_kernel.ts` | Delegates `interactWithObject` to the registry; cover modifies the effective AC; round-boundary environmental rules after turn advance; `createCombatState` accepts the pair; replay/canonical-JSON extracted (837 → 738 lines). |
| `packages/shared/utils/src/lib/rules/combat_tactical.ts` | Intact blocking objects are impassable; the forecast reads the same effective AC; `interactWithObject` forecasting. |
| `packages/shared/utils/src/lib/rules/combat_intent_compiler.ts` | Dispatches the environmental step to the new module. |
| `packages/frontend/engine/src/combat/combat_state_adapter.ts` | `environment` / `environmentBundle` / `checkModifiersByCombatant` projection options. |
| `packages/frontend/engine/src/combat/combat_encounter_start.ts` | Accepts and pins the roster's environmental pair; re-exports the store. |
| `packages/frontend/engine/src/combat/combat_encounter_types.ts` | `EncounterEnvironment` on the roster; `EncounterRosterPayload`. |
| `packages/frontend/engine/src/combat/combat_encounter_retry.ts` | Retry captures and re-pins the opening pair. |
| `packages/frontend/engine/src/combat/combat_v2_resolver.ts` | Projects the pinned pair; clears it when the encounter ends; `COMBAT_INTERACT` mapping. |
| `packages/frontend/engine/src/combat/combat_bridge_types.ts` / `combat_bridge_commands.ts` / `combat_command_dispatch.ts` / `worker/ecs_worker.ts` | `CombatInteractCommand` through the whole bridge path; the roster payload carries the environment. |
| `packages/frontend/engine/src/combat/combat_ai_perception.ts` | `buildVisibleObjects` — perceived objects with only available affordances. |
| `packages/frontend/engine/src/assets/content_pack_loader.ts` | `getProp(propId)`. |
| `packages/frontend/engine/src/index.ts` | Barrel exports for the new types. |
| `apps/frontend/client/src/lib/services/game/combat_encounter_roster.ts` | Returns `{ participants, environment? }`. |
| `apps/frontend/client/src/lib/services/game/game_composition_root.svelte.ts` / `game_test_seam.ts` / `game_overlay_service.svelte.ts` / `game_overlay_types.ts` | The roster payload carries the environment to the worker. |
| `apps/frontend/client/src/lib/views/combat/combat_view_model.svelte.ts` / `combat_view_model_contract.ts` / `combat_sidebar.svelte` | Inspector wiring, runes, contract and rendering. |
| `apps/frontend/client/src/lib/views/combat/combat_narration.ts` / `combat_intent_flow.svelte.ts` | Environmental narration facts and the `interact` attempt kind. |
| `apps/e2e/src/visual/suites/combat.visual.ts` | `CombatEnvironmentVisualSchema`, `startProofEncounter`, and both C-531 cases. |
| `apps/frontend/client/src/lib/services/game/game_save_envelope.ts` | `SaveWorldBlock`, `world?` on the parsed envelope, and a **version-aware** checksum digest (v5 world / v3-v4 map / v2 neither) so older saves keep validating. |
| `apps/frontend/client/src/lib/services/game/game_save_service.svelte.ts` | Envelope version 4→5; `_requestWorldObjects()` bounded round trip (skipped when the bridge is unready); the block is hashed and persisted; a load sends `WORLD_OBJECTS_RESTORED`. |
| `packages/frontend/engine/src/combat/combat_v2_resolver.ts` | Captures the committed object state on encounter end, before the environment is cleared. |
| `packages/frontend/engine/src/combat/combat_encounter_start.ts` | Overlays the persisted block onto the freshly authored state at encounter start. |
| `packages/frontend/engine/src/combat/combat_bridge_types.ts` / `combat_bridge_commands.ts` / `combat_command_dispatch.ts` / `sim.ts` | `WORLD_OBJECTS_REQUESTED` / `WORLD_OBJECTS_RESTORED` round trip and the store's public exports. |
| `apps/frontend/client/src/lib/services/game/combat_ai_prompt.ts` | The constant system prompt names `visibleObjects` and the `interact_with_object` step, so a planner can actually choose an environmental action. |
| `content/packs/emberwatch/manifest.json` | Five environmental props + `proof_encounter.environment`. |
| `content/packs/asset_hashes.json` | Refreshed for the manifest change. |
| `scripts/src/lib/ops/guard_source_file_size_baseline.json` | Re-locked after the `content_pack.ts` reduction. |
| Test fixtures updated for schema version 3 / the new required fields (no assertion weakened): `combat_state.test.ts`, `combat_kernel.test.ts`, `combat_kernel_purity.test.ts`, `combat_replay.test.ts`, `combat_ai_perception.test.ts`, `combat_preview_bridge.test.ts`, `combat_v2_start.test.ts`, `combat_ai_companion_ownership.test.ts`, `combat_ai_decision.test.ts`, `combat_engine_routing.test.ts`, `combat_ai_turns.test.ts`, `combat_v2_retry.test.ts`, `combat_bridge_commands.test.ts`, `combat_encounter_roster.test.ts`, `combat_intent_flow.test.ts`. |
| `apps/frontend/docs/src/content/docs/features/combat-controls.md` / `guides/content-pack-authoring.mdx` | User-facing and creator-facing documentation. |

### Deviations from Spec

1. **`BattlefieldObject` gained `cover`, `footprint` and `attachedToObjectId`** beyond
   the contract's conceptual shape. `cover` is required by the contract's own
   `setCover` effect and by AC-1's "cover reflects the committed state";
   `attachedToObjectId` is how `dropPayload` identifies "its attached payload";
   `footprint` is the contract's own field, given an explicit origin convention
   (offsets relative to `position`, always including `{0,0}`).
2. **`CombatantState` gained optional `checkModifiers`.** The contract requires
   check modifiers to come from "identified character-sheet fields projected into
   the snapshot" and forbids substituting an unrelated bonus. Absent means "this
   snapshot projects none", which is a rejection — not a fallback.
3. **AC-6 resolution path (recorded as required):** the **dev asset origin**.
   `scripts/src/lib/ops/local_asset_origin.ts` serves
   `content/packs/emberwatch/manifest.json` as the `emberwatch:manifest` tag over
   `PUBLIC_ASSETS_BASE_URL`, so the authored encounter becomes resolvable with no
   seed republish (C-448/C-496). Stated precisely rather than as an "offline
   path": the origin **proxies everything it does not override to the published
   CDN** and its own header records that "there is no bundled fallback" — it
   requires a catalog snapshot (`.local/catalog/production/snapshots`) and a
   network path to the published origin for every artifact it does not override.
   *In this session it could not be brought up at all*: that snapshot does not
   exist in this worktree. A genuinely offline content path (a bundled pack or a
   seed republish) remains future work.
4. **`CombatState` gained required `environment` and `environmentBundle`**;
   `COMBAT_SCHEMA_VERSION` moved 2→3. `COMBAT_RULES_VERSION` was deliberately left
   at `combat-2.0.0` — the environmental semantics are versioned by the bundle's own
   `rulesVersion` (`combat-environment-1.0.0`), and bumping the shared rules version
   would have invalidated twelve unrelated fixtures without adding a compatibility
   signal the schema version does not already carry.
5. **`damage` effects target combatants only.** Objects break through
   `setObjectState`, the contract's declared variant for that.
6. **Registered surface interaction:** creating `fire` on a cell that already holds
   `oil` consumes the oil. The contract requires an explicit surface interaction
   order but does not name this pair; it is the only v1 interaction.
7. **Hazard damage is applied at the round boundary**, from
   `applyEnvironmentalRoundStart`, on the existing `actions` stream.
8. **The environmental content-pack extension is split across two new modules**
   (`content_pack_environment.ts`, `content_pack_encounter.ts`) and re-exported from
   `content_pack.ts`. This is a file-size consequence, not a scope change: the prop
   and encounter definitions are still the single source, and no parallel object
   catalog was created.
9. **The proof-encounter objects reuse existing packed frames**
   (`counter.png`, `barrel.png`, `notice_board.png`, `village_gate.png`,
   `crate.png`) and inherit their artwork's provenance. The prop atlas is build
   output produced from `content/packs/emberwatch/props/*.png`, and this contract
   adds no artwork — inventing new frame names would have been a latent
   content-audit failure.
10. **No Amendment was required** — no AC text or scope boundary was changed.
11. **The save envelope moved from v4 to v5** to carry the world-object block.
    The checksum digest is **version-aware** — v5 hashes the world block, v3/v4
    the map block, v2 neither — so an existing save written by any earlier
    version still validates and still loads, with no block (which clears the
    engine's persisted state rather than inventing it). The two C-381 tests that
    asserted the literal envelope version were updated to assert the current
    version; their packVersion/worldSeed assertions are unchanged.
12. **Combat-scoped surfaces do not persist.** The contract allows a surface to
    survive encounter exit only when its authored definition declares world
    persistence, and the v1 surface vocabulary declares none. Objects persist;
    surfaces and hazard tick stamps are dropped at capture.

### Verification

- **Source-file-size guard:** `bun run scripts/src/lib/ops/guard_source_file_size.ts`
  → **PASS** (3017 files checked, 38 baselined, 140 non-failing warnings). The three
  failures reported against the previous attempt are fixed:
  `combat_environment.ts` 1839 → split into five cohesive modules plus a barrel;
  `combat_kernel.ts` 837 → 738; `content_pack.ts` 1200 → 1075 (baseline re-locked).
  The guard script, its baseline, its exceptions, its helpers and its test **do
  exist and do run** — the previous attempt's Execution Report wrongly claimed
  otherwise, and that claim is retracted here.
- `packages/shared/schemas` → `bun test`: **758 pass / 0 fail** (baseline 758/0).
- `packages/shared/utils` → `bun test`: **419 pass / 0 fail** (baseline 371/0;
  **+48 new tests**).
- `packages/frontend/engine` → `bun test`: **1476 pass / 3 fail / 1 error** out of
  1480 tests (baseline 1467 pass / 3 fail / 1 error out of 1471; **+9 new tests,
  0 new failures**).
- `apps/frontend/client` → `bun run test:unit`: **3287 pass / 0 fail / 7 skip /
  2 todo** out of 3296.
- `scripts` → `bun test`: **1208 pass / 1 fail** — the failure is the pre-existing
  `pre_commit checkPlaintextSecrets` case, reproduced with the changes stashed.
- `apps/frontend/client` → `bun run typecheck`: only the **pre-existing** `DiceState`
  `tsc` error; `svelte-check` reports 0 errors, 0 warnings.
- `apps/e2e` and `scripts` → `typecheck`: clean.
- `docs:build`: succeeds (34 pages).
- **Benchmark** (`bun scripts/src/lib/ops/benchmark_combat_environment.ts`, report
  committed to `docs/verification/C-531-timing.md`): reference workload 32×32
  battlefield, 8 combatants, 32 objects, 64 surface cells; preview p95 **0.002 ms**
  (target ≤16 ms) and kernel resolution p95 **1.836 ms** (target ≤10 ms), both PASS,
  with CPU/OS/runtime recorded in the report.
- **NOT RUN:** the Playwright E2E lane (`apps/e2e/tests/client/combat_v2_environment.spec.ts`)
  and the visual runner (`environment-preview`, `environment-resolved`). Evidence of
  the environmental cause: `curl http://localhost:8788/emberwatch/manifest.json` →
  connection failure (`000`); `.local/catalog/production/snapshots` does not exist, so
  `local_asset_origin.ts` cannot start; there is no bundled fallback at
  `apps/frontend/client/static/emberwatch`. In the previous attempt the **pre-existing**
  `combat_v2.spec.ts` lane failed with the identical
  `ContentPackLoader: manifest not found (HTTP 404)` boot error.
- **Not produced:** any browser screenshot or `ai_validate_image` result. No abstract
  claim is made in their place.

### Remaining Work and Release Decision

1. **Run the production lanes** once an asset origin is available: create
   `.local/catalog/production/snapshots`, start
   `bun scripts/src/lib/ops/local_asset_origin.ts --port 8788`, then run Playwright
   with `CI=` **unset** (with `CI=true` the preflight selects the hub-worker serve
   port, which herdr does not start). Execute
   `apps/e2e/tests/client/combat_v2_environment.spec.ts` and the two visual cases,
   and attach the screenshots.
2. **Offline content path:** the recorded AC-6 resolution path is the dev asset
   origin, which proxies to the published CDN and needs a catalog snapshot. A
   genuinely offline path (bundled pack, or the C-448/C-496 seed republish) would
   remove the last network dependency from the proof encounter.
3. **AC-8 (residual):** record the visual-run results once the lane is executable.

**Release decision: do not promote to `verified` on this report alone.** All eight
ACs are implemented and covered by unit/integration tests, and the guard, the
timing targets and every affected suite are green. The one thing this report cannot
supply is **executed production-path evidence for AC-4, AC-6 and AC-8**: the client
cannot boot in this environment because `PUBLIC_ASSETS_BASE_URL` has no working
target (see *Verification*), and the pre-existing `combat_v2.spec.ts` lane fails
identically. Those three ACs should be re-verified by running the E2E and visual
lanes where an asset origin exists; nothing in this contract should be treated as
browser-verified until that happens.
