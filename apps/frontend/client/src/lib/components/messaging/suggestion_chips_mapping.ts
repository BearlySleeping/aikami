// apps/frontend/client/src/lib/components/messaging/suggestion_chips_mapping.ts
//
// Single source of truth for the SuggestionChips intent → daisyUI class and
// icon-glyph mappings (C-420). Extracted from the component so the unit tests
// exercise the SAME logic the component renders — assertions cannot pass
// independently of the component implementation.
//
// Contract: C-420 One Choice Affordance

/** daisyUI intent colour for a chip. */
export const chipClassFor = (intentType: string): string => {
  if (intentType === 'combat') {
    return 'btn-outline btn-error';
  }
  if (intentType === 'skill_check') {
    return 'btn-outline btn-accent';
  }
  if (intentType === 'trade') {
    return 'btn-outline btn-warning';
  }
  if (intentType === 'quest') {
    return 'btn-outline btn-info';
  }
  return 'btn-outline';
};

/** Intent icon glyph for a chip. */
export const chipIconFor = (intentType: string): string => {
  if (intentType === 'skill_check') {
    return '🎲';
  }
  if (intentType === 'combat') {
    return '⚔️';
  }
  if (intentType === 'trade') {
    return '💰';
  }
  if (intentType === 'quest') {
    return '📋';
  }
  return '💬';
};
