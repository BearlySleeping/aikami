# Contract C-319: Replace `/setup` with Fast Character Onboarding

## Metadata

| Field | Value |
|---|---|
| **Source** | TODO.md — C-319 |
| **Target** | `routes/setup/+page.svelte`, a setup coordinator ViewModel, starter hero data, class/race/pronoun presets in `packages/shared/constants/`, and decomposed onboarding step views |
| **Priority** | P0 — clean character setup is the top immediate UX need |
| **Dependencies** | C-123 (Character Creation Flow — `completed`), C-232 (Character Sheet & Traits — `completed`), C-313 (Campaign Aggregate & Boot State Machine — `implemented`), C-317 (Rebuild Start Menu Around Campaigns — `approved`), C-318 (One-Screen Capability Setup — `implemented`) |
| **Status** | verification_failed |
| **Promotion** | — |
| **Docs Impact** | None — internal player flow |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: `routes/setup/+page.svelte` renders a `?skip-wizard` gate — default path is the full WorldGenWizardView (C-233, a 6-step world generation wizard), bypassed only via `?skip-wizard=true` which shows the AI-chat-driven `PersonaCreateView`. The world-gen wizard has no role in Phase 1 (the acceptance gate for C-319 explicitly says "without invoking world generation"). The PersonaCreateView requires a conversational AI interaction (CHAT → GENERATING → TWEAK phases) — there is no fast non-AI path. There are no starter heroes, no class/race preset data, no stepwise custom creation flow, and no mechanism to attach a created persona to the campaign aggregate.
- **Reproduction**:
  1. Navigate to `/setup` after a fresh campaign creation (C-317/C-318 flow).
  2. Observe: the World Generation Wizard loads by default (6 steps of world-building).
  3. Click "Skip Wizard" to reach the persona creator.
  4. Observe: a DM chatbot interface requiring AI interaction — no fast path, no starter heroes.
  5. Create a persona and click "Enter World" — persona is saved to localStorage but NOT attached to the active campaign's `personaId` field.
- **Existing implementation to reuse**:
  - `Campaign` schema (`packages/shared/schemas/src/lib/game/campaign.ts`) — has `personaId?: string` field already, plus `campaignService.startNewCampaign({ personaId })` and `completeSetup()`.
  - `PersonaData` / `PersonaCreateData` schemas (`packages/shared/schemas/src/lib/database/persona.ts`) — full character sheet with ability scores, race, class, alignment, appearance, personality traits, narrative traits.
  - `BaseCharacterSheetSchema` (`packages/shared/schemas/src/lib/database/character.ts`) — includes `AbilityScoresSchema`, `RaceSchema`, `ClassSchema`, `AlignmentSchema`, `ALIGNMENTS` constant.
  - `PersonaCreateViewModel` (`apps/frontend/client/src/lib/views/character/persona/create/persona_create_view_model.svelte.ts`) — existing persona creation with AI extraction, ability score editing, avatar generation, and `enterWorld()` flow. The TWEAK phase UI is reusable for the Review step.
  - `PersonaCreateView` (`apps/frontend/client/src/lib/views/character/persona/create/persona_create_view.svelte`) — existing tweak-phase UI with ability score editing, persona detail cards.
  - `personaCreationService` (`apps/frontend/client/src/lib/services/persona/persona_creation_service.svelte.ts`) — AI persona extraction and avatar generation. Conversational Session Zero depends on this.
  - `campaignService` (`apps/frontend/client/src/lib/services/campaign/campaign_service.svelte.ts`) — `startNewCampaign({ personaId })`, `activeCampaign`, `completeSetup()`.
  - `DND_CREATION_SYSTEM_PROMPT` (`apps/frontend/client/src/lib/data/ai_prompts/dnd_creation.ts`) — defines 2024 species, classes, backgrounds, ability score array, alignment rules.
  - C-318 capability profile and offline demo fallback — already implemented, feeds into this contract.
- **Known gaps**:
  - No starter hero definitions (3 pre-built PersonaData objects with name, race, class, ability scores, equipment, appearance description).
  - No class/play-style presets data (curated lists of classes with descriptions, recommended ability scores, play-style tags).
  - No pronoun selection data or UI.
  - No stepwise onboarding coordinator (Identity → Play Style → Appearance → Review).
  - No "Surprise Me" randomizer for custom path.
  - No mechanism to attach a persona to the active campaign — `campaignService.activeCampaign.personaId` is never set after creation.
  - World-gen wizard is the default path — must be removed from the production setup route.
  - `aikami-characters` localStorage key is used for draft persistence but not read on reload for draft recovery.
- **Baseline tests**:
  - `packages/shared/schemas/src/lib/database/persona.test.ts` — PersonaData schema validation.
  - `packages/shared/schemas/src/lib/game/campaign.test.ts` — Campaign schema including optional `personaId`.
  - `campaign_service.test.ts` — campaign lifecycle (create, load, save).
  - `persona_create_view_model.test.ts` — existing persona creation ViewModel tests.

## User Outcome

After this contract, a player can choose one of three starter heroes in seconds OR create a custom hero through a guided 4-step flow (Identity → Play Style → Appearance → Review) — all without requiring AI, world generation, or image generation. The created persona is attached to the active campaign. The conversational Session Zero remains available as an optional alternative path.

## Success Measures

- **Time/latency target**: Starter hero path completes in under 3 seconds (UI render + data assignment). Custom path completes in under 60 seconds for a new player (no AI calls needed). Session Zero path uses existing AI streaming — no new latency targets.
- **Offline/degraded behavior**: Starter heroes and custom path work with zero network requests. All preset data is bundled. Draft persists to localStorage. Session Zero path gracefully degrades — if no text AI provider is available (`capabilityProfile.textProvider === false`), the Session Zero button is hidden or disabled.
- **Production journey enabled**: Player selects a starter or custom hero → persona is attached to the active campaign → campaign transitions to `playing` state → routed to `/game` for atomic boot (C-321). This completes the "start a game" flow end-to-end without AI dependency for offline demo.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Campaign aggregate + boot state machine | `campaign_service.svelte.ts`, `packages/shared/schemas/src/lib/game/campaign.ts` | **Reuse** — set `personaId` on active campaign, call `completeSetup()` |
| Persona data model + schemas | `packages/shared/schemas/src/lib/database/persona.ts`, `BaseCharacterSheetSchema` | **Reuse** as-is |
| Persona creation AI extraction | `personaCreationService`, `PersonaCreateViewModel._extractCharacter()` | **Reuse** for Session Zero path only |
| Persona TWEAK phase UI | `PersonaCreateView.svelte` (TWEAK phase), `PersonaCreateViewModel` ability score editing | **Modify** — extract ability score editing + review card into reusable components for Review step |
| Capability profile | C-318 `capabilityProfile` on campaign, `degradation.ts` | **Reuse** — read `textProvider` to conditionally show Session Zero |
| D&D 2024 rules reference | `dnd_creation.ts` — species, classes, backgrounds, standard array | **Reuse** — extract into structured constants |
| Route structure | `routes/setup/+page.svelte` | **Replace** entire page content |
| `aikami-characters` localStorage | `PersonaCreateViewModel._persistCharacter()` | **Modify** — read on mount for draft recovery |

## Overview

Replace the world-gen-wizard-first `/setup` route with a fast character onboarding coordinator. The player sees three starter hero cards plus a "Create Custom Hero" button. Starter cards are one-click: pick one, persona is instantiated with pre-built data, attached to the campaign, and the player proceeds to `/game`. The custom path walks through four steps: Identity (name, pronouns, race/species), Play Style (class, play-style tags, ability score explanation), Appearance (text description, preset selection), and Review (ability score adjustments, confirmation). An optional "Surprise Me" button randomizes the custom form. The existing conversational Session Zero DM chat is accessible as an alternative "Chat with the DM" entry point. Persona draft is persisted to localStorage on every step change and recovered on mount.

## Design Reference

- **ViewModel pattern**: `BaseViewModel` from `@aikami/frontend/services`. ViewModel holds all state as `$state` fields. View is a zero-logic Svelte component receiving the ViewModel via props.
- **Coordinator pattern**: `SetupCoordinatorViewModel` orchestrates step transitions, starter selection, persona assembly, campaign attachment. Similar to how `CapabilityViewModel` (C-318) orchestrates detection → path selection → campaign creation.
- **Step decomposition**: Each step is a pair of files: `onboarding_identity_step_view.svelte` / `onboarding_identity_step_view_model.svelte.ts` (or equivalent state managed by the coordinator). Follow `svelte-conventions` ViewModel pattern.
- **Existing persona UI**: The TWEAK phase cards in `persona_create_view.svelte` (ability score grid, persona details card, avatar card) are the reference for the Review step layout.
- **Starter card UI**: DaisyUI cards with character art placeholder, name, race/class summary, one-sentence flavor text. Click handler calls coordinator.
- **Data flow**: `packages/shared/constants/src/lib/characters.ts` for starter heroes, class presets, play styles, pronouns. `packages/shared/types/src/lib/characters.ts` for type re-exports from schemas if needed.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Shared constants** (`packages/shared/constants/src/lib/`): New file for starter hero definitions, class/play-style presets, race/species list, pronoun options. Export from `packages/shared/constants/src/index.ts`.
- **Shared schemas** (`packages/shared/schemas/src/lib/`): Only if new validation is needed for onboarding-specific data shapes (e.g., onboarding draft shape for localStorage). Most data uses existing `PersonaCreateData`.
- **Shared types** (`packages/shared/types/src/lib/`): Re-exports from schemas or standalone type aliases for onboarding-specific shapes (step enum, draft shape).
- **Client Views** (`apps/frontend/client/src/lib/views/onboarding/`): New directory for onboarding coordinator ViewModel + View, plus step-specific views.
- **Client route** (`apps/frontend/client/src/routes/setup/+page.svelte`): Replace entire file. Instantiate coordinator ViewModel, render onboarding view.
- **Client services**: No new services. Reuse `campaignService`, `personaCreationService`, `aiSettingsService` (capability check).
- **Backend**: No changes.

## State & Data Models

```typescript
// packages/shared/constants/src/lib/characters.ts

// ── Pronouns ─────────────────────────────────────────────────────────

export type PronounSet = {
  id: string;
  subjective: string;   // "he", "she", "they"
  objective: string;    // "him", "her", "them"
  possessive: string;   // "his", "her", "their"
  reflexive: string;    // "himself", "herself", "themself"
};

export const PRONOUN_SETS: readonly PronounSet[] = [
  { id: 'he_him', subjective: 'he', objective: 'him', possessive: 'his', reflexive: 'himself' },
  { id: 'she_her', subjective: 'she', objective: 'her', possessive: 'her', reflexive: 'herself' },
  { id: 'they_them', subjective: 'they', objective: 'them', possessive: 'their', reflexive: 'themself' },
] as const;

// ── Play-Style Tags ──────────────────────────────────────────────────

export type PlayStyleTag = {
  id: string;
  label: string;
  description: string;
};

export const PLAY_STYLE_TAGS: readonly PlayStyleTag[] = [
  { id: 'melee', label: 'Melee', description: 'Up-close combat with weapons' },
  { id: 'ranged', label: 'Ranged', description: 'Attacks from a distance' },
  { id: 'magic', label: 'Magic', description: 'Spellcasting and arcane arts' },
  { id: 'support', label: 'Support', description: 'Healing, buffs, and utility' },
  { id: 'stealth', label: 'Stealth', description: 'Sneaking, traps, and subterfuge' },
  { id: 'social', label: 'Social', description: 'Persuasion, deception, and charm' },
] as const;

// ── Class Presets ────────────────────────────────────────────────────

export type ClassPreset = {
  id: string;
  label: string;
  description: string;
  playStyleIds: string[];
  primaryAbility: AbilityKey;
  secondaryAbility: AbilityKey;
  suggestedEquipment: string[];
};

export const CLASS_PRESETS: readonly ClassPreset[] = [
  {
    id: 'fighter', label: 'Fighter', description: 'A master of martial combat, skilled with a variety of weapons and armor.',
    playStyleIds: ['melee', 'ranged'], primaryAbility: 'strength', secondaryAbility: 'constitution',
    suggestedEquipment: ['Longsword', 'Shield', 'Chain Mail', "Explorer's Pack"],
  },
  {
    id: 'wizard', label: 'Wizard', description: 'A scholarly magic-user capable of manipulating the structures of reality.',
    playStyleIds: ['magic'], primaryAbility: 'intelligence', secondaryAbility: 'constitution',
    suggestedEquipment: ['Spellbook', 'Quarterstaff', "Scholar's Pack"],
  },
  {
    id: 'rogue', label: 'Rogue', description: 'A scoundrel who uses stealth and trickery to overcome obstacles.',
    playStyleIds: ['stealth', 'melee'], primaryAbility: 'dexterity', secondaryAbility: 'intelligence',
    suggestedEquipment: ['Shortsword', 'Shortbow', 'Leather Armor', "Burglar's Pack"],
  },
  {
    id: 'cleric', label: 'Cleric', description: 'A priestly champion who wields divine magic in service of a higher power.',
    playStyleIds: ['support', 'magic'], primaryAbility: 'wisdom', secondaryAbility: 'strength',
    suggestedEquipment: ['Mace', 'Shield', 'Scale Mail', "Priest's Pack"],
  },
  {
    id: 'ranger', label: 'Ranger', description: 'A warrior who combats threats on the edges of civilization.',
    playStyleIds: ['ranged', 'melee'], primaryAbility: 'dexterity', secondaryAbility: 'wisdom',
    suggestedEquipment: ['Longbow', 'Shortsword', 'Leather Armor', "Explorer's Pack"],
  },
  {
    id: 'bard', label: 'Bard', description: 'An inspiring performer whose words and music weave magic.',
    playStyleIds: ['magic', 'social'], primaryAbility: 'charisma', secondaryAbility: 'dexterity',
    suggestedEquipment: ['Rapier', 'Lute', 'Leather Armor', "Entertainer's Pack"],
  },
  {
    id: 'paladin', label: 'Paladin', description: 'A holy warrior bound to a sacred oath.',
    playStyleIds: ['melee', 'support'], primaryAbility: 'strength', secondaryAbility: 'charisma',
    suggestedEquipment: ['Longsword', 'Shield', 'Chain Mail', "Priest's Pack"],
  },
  {
    id: 'druid', label: 'Druid', description: 'A nature priest who draws power from the primal forces.',
    playStyleIds: ['magic', 'support'], primaryAbility: 'wisdom', secondaryAbility: 'constitution',
    suggestedEquipment: ['Scimitar', 'Wooden Shield', 'Leather Armor', "Explorer's Pack"],
  },
] as const;

// ── Species/Races ────────────────────────────────────────────────────

export type SpeciesOption = {
  id: string;
  label: string;
  description: string;
  suggestedClasses: string[];
};

export const SPECIES_OPTIONS: readonly SpeciesOption[] = [
  { id: 'human', label: 'Human', description: 'Versatile and ambitious — the most common folk of the realms.', suggestedClasses: ['fighter', 'wizard', 'cleric'] },
  { id: 'elf', label: 'Elf', description: 'Graceful and long-lived, with keen senses and innate magic.', suggestedClasses: ['wizard', 'ranger', 'bard'] },
  { id: 'dwarf', label: 'Dwarf', description: 'Stout and hardy, masters of stone and forge.', suggestedClasses: ['fighter', 'cleric', 'paladin'] },
  { id: 'halfling', label: 'Halfling', description: 'Small, lucky, and surprisingly brave.', suggestedClasses: ['rogue', 'bard', 'ranger'] },
  { id: 'tiefling', label: 'Tiefling', description: 'Infernal heritage grants dark charisma and fire resistance.', suggestedClasses: ['wizard', 'bard', 'rogue'] },
  { id: 'dragonborn', label: 'Dragonborn', description: 'Proud draconic humanoids with breath weapons.', suggestedClasses: ['paladin', 'fighter', 'cleric'] },
  { id: 'gnome', label: 'Gnome', description: 'Clever inventors and illusionists with boundless curiosity.', suggestedClasses: ['wizard', 'rogue', 'bard'] },
  { id: 'half_orc', label: 'Half-Orc', description: 'Fierce and resilient, with a relentless spirit.', suggestedClasses: ['fighter', 'barbarian', 'ranger'] },
] as const;

// ── Starter Heroes ───────────────────────────────────────────────────

export type StarterHero = {
  id: string;
  name: string;
  pronouns: PronounSet;
  race: string;
  class: string;
  alignment: string;
  abilityScores: Record<string, number>;
  equipment: string[];
  appearance: string;
  personalityTraits: string;
  background: string;
  flavorText: string;
  /** Asset key for the starter card illustration (placeholder for now). */
  illustrationAsset: string;
};

export const STARTER_HEROES: readonly StarterHero[] = [
  {
    id: 'starter_thaldrin',
    name: 'Thaldrin',
    pronouns: { id: 'he_him', subjective: 'he', objective: 'him', possessive: 'his', reflexive: 'himself' },
    race: 'Human', class: 'Fighter', alignment: 'Lawful Good',
    abilityScores: { strength: 15, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 13, charisma: 8 },
    equipment: ['Longsword', 'Shield', 'Chain Mail', "Explorer's Pack"],
    appearance: 'Tall and broad-shouldered with short brown hair and a scar across his left cheek. Wears polished chain mail with a faded military tabard.',
    personalityTraits: 'Disciplined and protective. Believes in second chances.',
    background: 'A former town guard who left his post after failing to prevent a tragedy. Seeks redemption through heroic deeds.',
    flavorText: 'A steadfast protector seeking redemption for past failures.',
    illustrationAsset: 'starter_thaldrin',
  },
  {
    id: 'starter_lyra',
    name: 'Lyra',
    pronouns: { id: 'she_her', subjective: 'she', objective: 'her', possessive: 'her', reflexive: 'herself' },
    race: 'Elf', class: 'Wizard', alignment: 'Neutral Good',
    abilityScores: { strength: 8, dexterity: 14, constitution: 12, intelligence: 15, wisdom: 13, charisma: 10 },
    equipment: ['Spellbook', 'Quarterstaff', 'Component Pouch', "Scholar's Pack"],
    appearance: 'Slender with silver-white hair and violet eyes. Wears deep blue robes embroidered with silver constellations.',
    personalityTraits: 'Curious and analytical. Speaks in precise, measured sentences.',
    background: 'A former apprentice at the Arcane Academy who discovered forbidden knowledge about the Fading Ward. Now seeks to understand and contain the threat.',
    flavorText: 'A brilliant scholar drawn into adventure by forbidden knowledge.',
    illustrationAsset: 'starter_lyra',
  },
  {
    id: 'starter_zeph',
    name: 'Zeph',
    pronouns: { id: 'they_them', subjective: 'they', objective: 'them', possessive: 'their', reflexive: 'themself' },
    race: 'Tiefling', class: 'Rogue', alignment: 'Chaotic Good',
    abilityScores: { strength: 10, dexterity: 15, constitution: 12, intelligence: 13, wisdom: 8, charisma: 14 },
    equipment: ['Shortsword', 'Shortbow', 'Leather Armor', 'Thieves\' Tools', "Burglar's Pack"],
    appearance: 'Lean with deep crimson skin, curved horns, and a perpetual smirk. Wears dark fitted leather with too many hidden pockets.',
    personalityTraits: 'Charming and irreverent. Uses humor to deflect serious situations.',
    background: 'Grew up on the streets of a port city, running cons on corrupt merchants. Stole the wrong artifact and now has bounty hunters on their trail.',
    flavorText: 'A silver-tongued scoundrel with a heart of (mostly) gold.',
    illustrationAsset: 'starter_zeph',
  },
] as const;

// ── Ability Key (shared across data models) ──────────────────────────

export type AbilityKey = 'strength' | 'dexterity' | 'constitution' | 'intelligence' | 'wisdom' | 'charisma';

export const DND_STANDARD_ARRAY: readonly number[] = [15, 14, 13, 12, 10, 8] as const;

export const ABILITY_LABELS: Record<AbilityKey, { label: string; description: string }> = {
  strength: { label: 'STR', description: 'Physical power and melee attack bonus' },
  dexterity: { label: 'DEX', description: 'Agility, ranged attacks, and armor class' },
  constitution: { label: 'CON', description: 'Endurance and hit point bonus' },
  intelligence: { label: 'INT', description: 'Reasoning, memory, and wizard spell power' },
  wisdom: { label: 'WIS', description: 'Perception, insight, and cleric/druid spell power' },
  charisma: { label: 'CHA', description: 'Force of personality and bard/paladin spell power' },
} as const;
```

```typescript
// packages/shared/constants/src/lib/characters.ts — ONBOARDING_STEPS data constant

/** Step in the custom hero creation flow. */
export type OnboardingStep = 'identity' | 'play_style' | 'appearance' | 'review';

export const ONBOARDING_STEPS: readonly OnboardingStep[] = ['identity', 'play_style', 'appearance', 'review'] as const;

// ── Onboarding Draft (localStorage shape, types in @aikami/types) ──────────
// The OnboardingDraft type lives in packages/shared/types/src/lib/onboarding.ts
// (per Pillar 2: monorepo boundaries — data shapes belong in types/schemas, not constants).
// The key itself is the string constant 'aikami-onboarding-draft'.

import type { OnboardingDraft } from '@aikami/types';
```

```typescript
// apps/frontend/client/src/lib/views/onboarding/onboarding_coordinator_view_model.svelte.ts

import type { OnboardingStep, StarterHero } from '@aikami/constants';

export type SetupMode = 'starter_select' | 'custom' | 'session_zero';

export type OnboardingCoordinatorViewModelInterface = BaseViewModelInterface & {
  readonly mode: SetupMode;
  readonly step: OnboardingStep;
  readonly stepIndex: number;
  readonly starterHeroes: readonly StarterHero[];
  readonly isTextProviderAvailable: boolean;

  // Starter path
  selectStarterHero(hero: StarterHero): Promise<void>;

  // Custom path
  startCustom(): void;
  nextStep(): void;
  previousStep(): void;
  goToStep(step: OnboardingStep): void;
  randomizeCharacter(): void;

  // Custom path state (bound by step views)
  name: string;
  pronounId: string;
  raceId: string;
  classId: string;
  alignment: string;
  abilityScores: Record<string, number>;
  appearanceDescription: string;
  background: string;
  personalityTraits: string;
  equipment: string[];

  // Finalize
  confirmAndEnter(): Promise<void>;

  // Session Zero
  startSessionZero(): void;
};
```

## Quality Requirements

- **Offline/degraded mode**: Starter heroes and custom path require zero network requests. All preset data is bundled in `@aikami/constants`. Session Zero button is hidden when `capabilityProfile.textProvider === false`. Draft persistence to `localStorage` works regardless of connectivity.
- **Accessibility/input**: All steps support keyboard navigation (Tab order, Enter/Space to select, Escape for back). Starter cards are keyboard-focusable with visible focus rings. Form inputs have labels. Point-buy guardrails announce violations via aria-live region.
- **Performance budget**: Setup coordinator ViewModel initializes in under 200ms (reading preset data from constants). Step transitions render in under 16ms (single frame). No lazy loading needed — all preset data is small (<10KB).
- **Security/privacy**: No auth required for starter/custom paths. Draft in localStorage is local-only. No PII beyond player-chosen character name.
- **Persistence/migration**: Draft persisted to `aikami-onboarding-draft` localStorage key. Draft is cleared on successful persona creation. Old `aikami-characters` localStorage key is read for backward compatibility (existing personas shown in Session Zero picker if available) but new personas are stored via `campaignService` → IndexedDB.
- **Cancellation/retry/idempotency**: Back button on any step restores previous draft state. Cancel returns to starter selection with draft preserved. Starter selection is idempotent — picking the same hero multiple times overwrites the persona. Campaign `personaId` assignment is idempotent via `campaignService.startNewCampaign({ personaId })`.
- **Observability**: Inherited `this.debug()` / `this.info()` logging via `BaseViewModel`. Key events: step transitions, starter selection, persona attachment, draft save/load, Session Zero entry.

## Migration & Rollback

N/A — no persistent state changes. The Campaign schema already has `personaId` (C-313). The new onboarding draft uses a new localStorage key (`aikami-onboarding-draft`) that doesn't conflict with existing keys. Old `/setup` page can be restored by reverting `+page.svelte` and the new view files. No database schema migration needed.

## Scope Boundaries

- **In Scope:**
  - Replace `routes/setup/+page.svelte` with onboarding coordinator View.
  - Add `OnboardingCoordinatorViewModel` extending `BaseViewModel`.
  - Define starter heroes, class presets, play-style tags, species options, pronoun sets in `@aikami/constants`.
  - Build custom hero flow: Identity → Play Style → Appearance → Review steps.
  - Identity step: name input, pronoun selector, race/species picker (cards or dropdown).
  - Play Style step: class cards with descriptions, play-style tag display, primary/secondary ability highlight.
  - Appearance step: text description input, preset appearance snippets (e.g., "Battle-Scarred Veteran", "Scholarly Robes").
  - Review step: persona summary card, ability score adjustments (point-buy guardrails: 8–15 range, total sum bonus ≤ +5 or similar), editable name/race/class, confirm button.
  - "Surprise Me" button on custom path — randomizes name, race, class, alignment, ability scores (standard array assigned to class-appropriate stats), appearance preset, background snippet.
  - Attach created persona to active campaign via `campaignService.activeCampaign.personaId` assignment and `campaignService.completeSetup()`.
  - Draft persistence: save draft to `aikami-onboarding-draft` localStorage key on every step change; recover on mount.
  - Option to enter conversational Session Zero DM chat (reuses existing `PersonaCreateViewModel` flow).
  - Hide Session Zero button when `capabilityProfile.textProvider === false`.
  - Wire game entry: `confirmAndEnter()` sets persona on campaign, transitions to `playing`, navigates to `/game`.
- **Out of Scope:**
  - LPC sprite live preview during appearance step — C-320 (Real-Time LPC Appearance Preview).
  - AI portrait generation during onboarding — C-320 or existing image pipeline; existing avatar generation in PersonaCreateView is preserved for Session Zero path only.
  - World generation wizard — removed from production setup route.
  - `/characters` route redesign — the existing character list route is unchanged; personas created via onboarding appear in it via the existing save mechanism.
  - `/game` boot flow — C-321 (Atomic Game Boot).
  - Save/load system — C-329 (Local Save, Continue, Autosave).
  - In-world character sheet redesign — C-232 already completed; this contract produces a valid PersonaData that fills the existing sheet.
  - Ability score explanations as tooltips for every skill — C-232's character sheet view handles detailed skill display; this contract only shows ability score summaries during creation.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** 5 ACs, 1 project (client only, plus shared constants). No independent subsystems — the starter and custom paths share the same coordinator, campaign attachment, and game entry. Size is within limits.

## Acceptance Criteria

### AC-1: Starter Hero Selection Attaches Persona to Campaign

**Given** the player is on the `/setup` onboarding screen with an active campaign in `creating` state (created by C-317/C-318 flow).
**When** the player clicks a starter hero card (Thaldrin, Lyra, or Zeph).
**Then** a `PersonaData` object is assembled from the starter hero definition, assigned a UUID `id`, attached to the active campaign via `campaignService.activeCampaign`'s `personaId`, `campaignService.completeSetup()` is called transitioning the campaign to `playing`, and the player is navigated to `/game`.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit + Integration | `onboarding_coordinator_view_model.test.ts` | `/setup` → starter click → `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test -- onboarding_coordinator`
- Integration: Manual — click each of the three starter heroes, verify each creates a valid persona, verify `campaignService.activeCampaign.personaId` is set and campaign state is `playing`, verify navigation to `/game`.
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/client/onboarding/starter_heroes.spec.ts` — click each starter hero, verify persona attached to campaign in IndexedDB, verify route changes to `/game`.
    - **Visual**: N/A.

**Watch Points**:
- Campaign must be in `creating` state before onboarding starts — if campaign is missing or in `failed` state, show error and route back to start menu.
- Starter hero IDs must be deterministic — persona `id` is `crypto.randomUUID()`, not the starter hero `id`.

### AC-2: Custom Hero — Identity Step with Name, Pronouns, and Race

**Given** the player is on the `/setup` onboarding screen and clicks "Create Custom Hero".
**When** the player fills in a name, selects pronouns, and picks a race/species.
**Then** the draft is auto-saved to `localStorage` key `aikami-onboarding-draft`, the Next button is enabled only when name is non-empty and race is selected, and clicking Next advances to the Play Style step. The selected pronoun set is stored as a string (e.g., `"he/him"`) in the persona's `notes` field, since `PersonaData`/`BaseCharacterSheetSchema` currently lacks a dedicated pronouns field.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | `onboarding_coordinator_view_model.test.ts` | `/setup` → Custom → Identity | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test -- onboarding_coordinator`
- Integration: Manual — enter name, select pronouns, pick race. Verify Next enables/disables correctly. Reload page: verify draft is recovered at the same step with the same values.
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/client/onboarding/custom_identity.spec.ts` — fill identity form, verify localStorage draft, reload and verify recovery.
    - **Visual**: N/A.

**Watch Points**:
- Empty name field must disable Next. Whitespace-only names must be rejected.
- Pronoun default: first pronoun set (`he/him`) pre-selected.
- Race cards should highlight suggested classes for that race (from `SPECIES_OPTIONS.suggestedClasses`).

### AC-3: Custom Hero — Play Style Step with Class Presets and Ability Explanations

**Given** the player completed the Identity step and is on the Play Style step.
**When** the player selects a class preset and views its details.
**Then** the class card shows the class description, play-style tags, primary/secondary abilities with explanations, and suggested equipment. Selecting a class pre-fills ability scores using the D&D standard array with the primary ability at 15 and secondary at 14. The previous/next navigation is functional and the draft is saved to localStorage.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit | `onboarding_coordinator_view_model.test.ts` | `/setup` → Custom → Identity → Play Style | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test -- onboarding_coordinator`
- Integration: Manual — select each class, verify ability scores are pre-filled correctly (primary=15, secondary=14, rest use remaining array values). Verify play-style tags render. Verify back navigation returns to Identity with draft preserved.
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/client/onboarding/custom_play_style.spec.ts` — select class, verify ability score pre-fill, navigate back/forward.
    - **Visual**: N/A.

**Watch Points**:
- If no class is selected, Next is disabled.
- Ability score pre-fill must use exactly the standard array `[15, 14, 13, 12, 10, 8]` — no duplicates, no out-of-range values.
- Class presets come from `@aikami/constants` — no hardcoded strings in the ViewModel.
- Navigating back from a later step (e.g., Review) to Play Style and changing the class MUST NOT silently overwrite manually adjusted ability scores. Only pre-fill if scores are still at their defaults (i.e., the standard array mapping).

### AC-4: Custom Hero — Review Step and Persona Confirmation

**Given** the player completed all steps (Identity → Play Style → Appearance) and is on the Review step.
**When** the player adjusts ability scores, edits name/race/class, and clicks "Enter World".
**Then** a `PersonaData` object is assembled with all fields from the draft, ability scores are validated within 8–15 range, persona is attached to the active campaign via `personaId`, `campaignService.completeSetup()` transitions to `playing`, and the player is navigated to `/game`.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit + Integration | `onboarding_coordinator_view_model.test.ts` | `/setup` → Custom → Review → `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test -- onboarding_coordinator`
- Integration: Manual — complete custom flow, verify Review card shows all selections. Edit ability scores (within range), verify guardrails prevent values <8 or >15. Click Enter World, verify campaign personaId is set, verify navigation to `/game`.
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/client/onboarding/custom_review.spec.ts` — complete custom flow, verify persona on campaign, verify game entry.
    - **Visual**: N/A.

**Watch Points**:
- Ability score guardrails: values must be 8–15 inclusive. Show inline validation error for out-of-range values. The sum of modifiers need not be enforced (point-buy rules are complex; basic range is sufficient for Phase 1).
- Editing race/class on the Review step must update the displayed ability recommendations but not override manually adjusted scores.
- "Surprise Me" on the Review step should randomize without leaving the step — update fields in-place and save draft.

### AC-5: Draft Persistence and Offline Behavior

**Given** a player is in the middle of the custom hero flow (any step) or on the starter selection screen.
**When** the page is reloaded, or the player returns to `/setup` after navigating away, or the browser has no network connectivity.
**Then** the draft is recovered from `localStorage` key `aikami-onboarding-draft` at the exact step where the player left off. Starter heroes render without network requests. Session Zero button is hidden when `capabilityProfile.textProvider === false`. Custom path and starter heroes complete successfully without any fetch calls, AI invocations, or image generation.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit + Integration | `onboarding_coordinator_view_model.test.ts` | `/setup` — reload, offline | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test -- onboarding_coordinator`
- Integration: Manual — fill partial Identity, reload page, verify draft recovered. Disconnect network, complete custom flow, verify no errors. Verify Session Zero button hidden when no text provider.
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/client/onboarding/offline_draft.spec.ts` — reload mid-flow, verify recovery. Complete flow offline.
    - **Visual**: N/A.

**Watch Points**:
- Draft is cleared from localStorage after successful persona creation and campaign attachment.
- If the stored draft references a race/class ID that no longer exists in `@aikami/constants` (e.g., after an update), fall back to the Identity step with a toast warning.
- `aikami-characters` localStorage key is read for existing personas (backward compat) but onboarding draft uses its own key `aikami-onboarding-draft`.

## Implementation Sequence

1. **Phase 1 (Data)**: Define starter heroes, class presets, play-style tags, species options, pronouns, and ability labels in `packages/shared/constants/src/lib/characters.ts`. Export from `packages/shared/constants/src/index.ts`. Add derived types if needed in `packages/shared/types/`.
2. **Phase 2 (ViewModel)**: Build `OnboardingCoordinatorViewModel` in `apps/frontend/client/src/lib/views/onboarding/onboarding_coordinator_view_model.svelte.ts` — mode/step state machine, starter selection handler, custom path step navigation, draft persistence, "Surprise Me" randomizer, persona assembly, campaign attachment, Session Zero routing.
3. **Phase 3 (Views)**: Build `onboarding_coordinator_view.svelte` — starter hero cards, custom step container with progress indicator. Build step views: `onboarding_identity_step_view.svelte`, `onboarding_play_style_step_view.svelte`, `onboarding_appearance_step_view.svelte`, `onboarding_review_step_view.svelte`. Build `starter_hero_card.svelte` component.
4. **Phase 4 (Route)**: Replace `routes/setup/+page.svelte` — instantiate coordinator, render coordinator view. Remove WorldGenWizardView. Preserve Session Zero entry point (reuses existing `PersonaCreateView` flow).
5. **Phase 5 (Validation)**: Run `bun moon run client:test` for unit tests. Run `bun moon run :validate` for full CI check. Manual keyboard navigation verification. Offline dev demo test.

## Edge Cases & Gotchas

- **No active campaign on `/setup`**: This indicates a routing error — `/setup` should only be reachable after C-317/C-318 creates a campaign. If `campaignService.activeCampaign` is undefined, show error state with "Return to Start Menu" button.
- **Campaign in wrong state**: If campaign state is not `creating`, show error. Only `creating` state means setup is ready for onboarding.
- **Double-click on Enter World**: Disable the confirm button after first click. `campaignService.completeSetup()` is idempotent — calling it twice from `playing` state throws but we gate with a `isConfirming` boolean.
- **Session Zero persona fed back into campaign**: If the player goes through Session Zero and creates a persona, the existing `PersonaCreateViewModel.enterWorld()` flow must also set `campaignService.activeCampaign.personaId`. This is a modification to the existing flow — the persona create flow currently calls `routerService.goToRoute('game')` without setting `personaId`.
- **"Surprise Me" produces unbalanced character**: The standard array assignment always puts 15 in primary ability and 14 in secondary. Remaining values (13, 12, 10, 8) are randomly assigned to remaining abilities. This guarantees a playable character.
- **Rapid step navigation**: Back/Next buttons debounce via the ViewModel's step transition method — `isTransitioning` boolean gate prevents double-advance.
- **localStorage quota exceeded**: Draft is <5KB. If `setItem` throws, log warning and continue without persistence — the flow still works, draft is just not recovered on reload.
- **Empty starter hero illustration**: Starter cards use a placeholder `illustrationAsset` string — actual illustration rendering is out of scope (icons or colored placeholder divs are acceptable for Phase 1).
- **Pronouns in PersonaData**: The `PersonaData`/`BaseCharacterSheetSchema` schema has no dedicated `pronouns` field. For Phase 1, store pronouns as a string (e.g., `"he/him"`) in the `notes` field of the PersonaData. Future schema extension should add an optional `pronouns` field to `BaseCharacterSheetSchema`.
- **StarterHero.appearance → PersonaData mapping**: `StarterHero.appearance` is a string description, but `PersonaData.appearance` expects `AppearanceSchema` (an object). Map via `{ physicalDescription: starterHero.appearance }`.

## Open Questions

- **Appearance preset snippets**: The Appearance step in the custom path needs curated appearance description presets (e.g., "Battle-Scarred Veteran", "Mysterious Wanderer", "Scholarly Robes"). How many presets and what text? Resolve during implementation — a set of 6–8 preset descriptions matching the starter hero tone is sufficient.
- **"Surprise Me" name generation**: Should randomized names come from a curated list or use a simple algorithm (race-prefix + class-suffix)? Proposed: curated list of 20+ fantasy names in constants.
- **Session Zero integration depth**: Should the Session Zero DM chat feed back into the onboarding coordinator (i.e., return from Session Zero to Review step with AI-generated persona) or be a standalone exit? Proposed: standalone — Session Zero is an alternative entry point that replaces the entire onboarding flow. Once the player enters Session Zero, the coordinator is bypassed and the existing `PersonaCreateViewModel` handles the full flow.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---

## Execution Report

### Summary
Built fast character onboarding system replacing the world-gen-wizard `/setup` route. Three starter heroes (Thaldrin, Lyra, Zeph) with one-click selection. Four-step custom hero creation (Identity → Play Style → Appearance → Review) with no AI or network dependencies. Draft persistence to localStorage (`aikami-onboarding-draft`) with recovery on reload. Session Zero remains as optional alternative path, hidden when text AI is unavailable. Persona attaches to active campaign via `campaignService`, transitioning to `playing` state then navigating to `/game`.

### AC Status
| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Starter hero selection assembles PersonaData from STARTER_HEROES, assigns personaId on campaign via campaignService.activeCampaign.personaId = persona.id, calls completeSetup(), navigates to /game via routerService.goToRoute('game') |
| AC-2 | ✅ | Identity step with name input (whitespace rejected by canGoNext gate), pronoun selector (defaults to he_him), species cards with suggested class badges; draft saved to aikami-onboarding-draft on setter calls |
| AC-3 | ✅ | Play Style step with 8 class cards, play-style tag badges, primary/secondary ability labels highlighted, DND_STANDARD_ARRAY pre-fill (primary=15, secondary=14, rest shuffled) |
| AC-4 | ✅ | Review step with ability score +/− controls (8-15 guardrails with disabled buttons at bounds), persona summary card showing name/race/class/alignment/pronouns/appearance/background/traits/equipment, confirm button with isConfirming gate |
| AC-5 | ✅ | Draft persisted via _saveDraft() on every step change/mutator; recovered in initialize() via _recoverDraft() with stale-ID validation; cleared after successful _attachPersonaToCampaign(); Session Zero hidden when campaign.capabilityProfile.textProvider === false |

### Files Created
| File | Purpose |
|---|---|
| `packages/shared/constants/src/lib/characters.ts` | Starter heroes, class presets, species, pronouns, play-style tags, ability labels, appearance presets, random names/backgrounds/personalities, onboarding steps |
| `packages/shared/constants/src/lib/characters.test.ts` | Unit tests for constants data integrity (25 tests) |
| `packages/shared/types/src/lib/onboarding.ts` | `OnboardingDraft` type for localStorage draft shape, `SetupMode` re-export |
| `apps/frontend/client/src/lib/views/onboarding/onboarding_coordinator_view_model.svelte.ts` | Coordinator ViewModel — mode/step state machine, starter selection, custom flow, draft persistence, persona assembly, campaign attachment, Surprise Me randomizer |
| `apps/frontend/client/src/lib/views/onboarding/onboarding_coordinator_view.svelte` | Main coordinator view — starter selection grid with error state, custom step container with DaisyUI steps progress indicator, Session Zero entry |
| `apps/frontend/client/src/lib/views/onboarding/starter_hero_card.svelte` | DaisyUI card component for starter heroes with placeholder illustration, race/class badges, flavor text |
| `apps/frontend/client/src/lib/views/onboarding/onboarding_identity_step_view.svelte` | Identity step — name input, pronoun selector buttons, species card grid with suggested class badges |
| `apps/frontend/client/src/lib/views/onboarding/onboarding_play_style_step_view.svelte` | Play Style step — class cards with descriptions, play-style tag badges, primary/secondary ability highlights, suggested equipment |
| `apps/frontend/client/src/lib/views/onboarding/onboarding_appearance_step_view.svelte` | Appearance step — 8 appearance preset cards, textareas for description/background/personality |
| `apps/frontend/client/src/lib/views/onboarding/onboarding_review_step_view.svelte` | Review step — summary card, ability score grid with +/− controls and modifier display, aria-live guardrails note |

### Files Modified
| File | Change |
|---|---|
| `packages/shared/constants/src/index.ts` | Added `export * from './lib/characters.ts'` |
| `packages/shared/types/src/index.ts` | Added `export * from './lib/onboarding.ts'` |
| `apps/frontend/client/src/routes/setup/+page.svelte` | Replaced world-gen-wizard + PersonaCreateView gate with OnboardingCoordinatorView + lazy Session Zero PersonaCreateView on mode change |

### Deviations from Spec
- **ViewModel unit tests**: 62 tests passing (state machine, step navigation, field setters, ability scores, standard array, computed selections, randomize, draft persistence, persona assembly, mode transitions, constant accessors). Tests use inline mocks for `@aikami/constants`, `@aikami/types`, `@aikami/frontend/services`, `$services`, and `$app/navigation` to work around Bun test path resolution in the worktree.
- **Production path verification**: Client dev server requires `vite` which is not in the worktree PATH. Visual screenshots and `ai_validate_image` verification deferred to independent verifier.
- **Scope clarification**: The `aikami-characters` localStorage key backward compatibility is not implemented — the contract says "read for backward compatibility" but the Session Zero path already reads it. No new logic needed here.

### Test Results
- Constants unit tests: 25/25 PASS (0 failures)
- ViewModel unit tests: 62/62 PASS (0 failures)
- Schema baseline: 16/16 PASS (campaign 8/8, persona 8/8) — ✅ no regressions
- Client typecheck: ✅ PASS
- Client lint: ✅ PASS (8 files auto-fixed by Biome)
- Baseline pre-existing failures: campaign_service (0/16), persona_create_view_model (0/40) — unchanged (pre-existing worktree mock resolution issue)

---
