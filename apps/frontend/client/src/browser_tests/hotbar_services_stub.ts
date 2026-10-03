// Narrow `$services` test alias for browser component tests.
//
// Components under test inject their own ViewModel, so these production
// singletons are never exercised — they exist only so the composition module
// (and therefore the real View) can be imported and mounted in Chromium.
// Anything actually exercised by a test arrives through a typed capability.

export const playerStateService = {
  hotbarSlots: [],
  abilityUses: {},
  useAbility: (_featureId: string): void => {},
};

/** Inert quest-overlay visibility singleton (see ./fixtures). */
export const questOverlayService = {
  visible: true,
  setVisible: (_visible: boolean): void => {},
};

/** Inert quest-state singleton; no quests exist in the browser lane. */
export const questStateService = {
  quests: [],
  getEligibleEndings: (_questId: string): never[] => [],
  chooseEnding: (_questId: string, _endingId: string): boolean => false,
};

/** Inert campaign singleton; only sampled hidden truth ids are read. */
export const campaignService = {
  activeCampaign: undefined as { sampledTruthId?: string } | undefined,
};
