// apps/frontend/client/src/lib/views/game/dashboard/character_sheet_presentation.svelte.ts
//
// Pure presentation state and projections for the character sheet (C-551).
// Domain reads and mutations stay in CharacterSheetViewModel; this module only
// controls edit disclosure and maps values onto game-scoped roles.

import type {
  AbilityKey,
  AbilityScores,
  CharacterSavingThrow,
  NarrativeTraits,
} from '@aikami/types';
import type { CharacterSheetTab } from './character_sheet_view_model.svelte';

/** Mutable presentation state owned by one character-sheet wrapper. */
type CharacterSheetPresentationStateOptions = {
  /** Standalone developer surfaces may begin in their authorized edit mode. */
  startEditing?: boolean;
};

/** Per-wrapper character-sheet presentation state. */
export type CharacterSheetPresentationState = {
  readonly isEditing: boolean;
  abilityRows(source: {
    abilities: AbilityScores;
    savingThrows: readonly CharacterSavingThrow[];
    abilityLabels: Readonly<Record<AbilityKey, string>>;
  }): readonly CharacterAbilityRow[];
  hasEarnedFeatures(features: readonly { readonly earned: boolean }[]): boolean;
  formatActivationCost(cost: string): string;
  toggleEditing(): void;
};

/** Creates edit disclosure without adding UI-only state to the production VM. */
export const createCharacterSheetPresentationState = (
  options: CharacterSheetPresentationStateOptions = {},
): CharacterSheetPresentationState => {
  const state = $state({ isEditing: options.startEditing ?? false });
  return {
    get isEditing(): boolean {
      return state.isEditing;
    },
    abilityRows(source: {
      abilities: AbilityScores;
      savingThrows: readonly CharacterSavingThrow[];
      abilityLabels: Readonly<Record<AbilityKey, string>>;
    }): readonly CharacterAbilityRow[] {
      return toCharacterAbilityRows(source);
    },
    hasEarnedFeatures(features: readonly { readonly earned: boolean }[]): boolean {
      return hasEarnedFeatures(features);
    },
    formatActivationCost(cost: string): string {
      return formatActivationCost(cost);
    },
    toggleEditing(): void {
      state.isEditing = !state.isEditing;
    },
  };
};

/** One summary/edit row projected from the character sheet. */
export type CharacterAbilityRow = {
  readonly key: AbilityKey;
  readonly label: string;
  readonly score: number;
  readonly modifier: number;
  readonly isSavingThrowProficient: boolean;
};

/** Projects the six abilities together with their saving-throw state. */
export const toCharacterAbilityRows = (options: {
  abilities: AbilityScores;
  savingThrows: readonly CharacterSavingThrow[];
  abilityLabels: Readonly<Record<AbilityKey, string>>;
}): readonly CharacterAbilityRow[] =>
  (Object.keys(options.abilities) as AbilityKey[]).map((key) => ({
    key,
    label: options.abilityLabels[key],
    score: options.abilities[key].value,
    modifier: options.abilities[key].modifier,
    isSavingThrowProficient:
      options.savingThrows.find((savingThrow) => savingThrow.ability === key)?.isProficient ??
      false,
  }));

/** Game numeric role for an ability or skill modifier. */
export const characterModifierTone = (
  modifier: number,
): 'game-numeric--positive' | 'game-numeric--negative' | 'game-numeric--neutral' => {
  if (modifier > 0) {
    return 'game-numeric--positive';
  }
  if (modifier < 0) {
    return 'game-numeric--negative';
  }
  return 'game-numeric--neutral';
};

/** Formats a modifier with an explicit sign. */
export const formatModifier = (modifier: number): string =>
  modifier >= 0 ? `+${modifier}` : `${modifier}`;

/** Selected state for a game-scoped character tab. */
export const characterTabClass = (activeTab: CharacterSheetTab, tab: CharacterSheetTab): string =>
  activeTab === tab ? 'game-tab--selected' : '';

/** Converts an authored activation enum into readable prose. */
export const formatActivationCost = (cost: string): string => {
  const normalized = cost.replaceAll('_', ' ').toLowerCase();
  return normalized.length === 0
    ? normalized
    : `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
};

/** Whether at least one class feature is currently earned. */
export const hasEarnedFeatures = (features: readonly { readonly earned: boolean }[]): boolean =>
  features.some((feature) => feature.earned);

/** Canonical narrative-trait disclosure order. */
export const CHARACTER_NARRATIVE_CATEGORIES = ['likes', 'temptations', 'keys'] as const;

/** Canonical long-form trait fields shown by the sheet. */
export const CHARACTER_TRAIT_FIELDS = ['personalityTraits', 'ideals', 'bonds', 'flaws'] as const;

/** Handles a narrative-trait form without leaking DOM mutation into the View. */
export const submitNarrativeTrait = (
  event: SubmitEvent,
  category: keyof NarrativeTraits,
  target: { addNarrativeTrait(category: keyof NarrativeTraits, value: string): void },
): void => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!(form instanceof HTMLElement)) {
    return;
  }
  const input = form.querySelector('input');
  if (!(input instanceof HTMLInputElement)) {
    return;
  }
  const value = input.value.trim();
  if (value.length === 0) {
    return;
  }
  target.addNarrativeTrait(category, value);
  input.value = '';
};
