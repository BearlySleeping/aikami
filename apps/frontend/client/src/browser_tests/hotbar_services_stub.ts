// Narrow `$services` test alias for HotbarView's optional production composition.
// Browser component tests inject their own ViewModel, so this fallback is never activated.
export const playerStateService = {
  hotbarSlots: [],
  abilityUses: {},
  useAbility: (_featureId: string): void => {},
};
