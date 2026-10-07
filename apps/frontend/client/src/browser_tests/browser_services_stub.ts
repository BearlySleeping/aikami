// apps/frontend/client/src/browser_tests/browser_services_stub.ts
//
// Inert `$services` alias for the Vitest browser lane.
//
// A View that renders before the app boots still imports its production
// composition module (e.g. `quest_overlay.svelte` → `getQuestOverlayViewModel`),
// and that module imports the `$services` singletons. Tests inject their own
// ViewModel, so these bindings are never exercised — they exist only so the
// real View can be mounted and compiled.
//
// Rule: add a binding ONLY for the specific view a browser test mounts, keep it
// inert, and never let it grow into a service inventory. Anything a test
// actually asserts on must arrive through a typed capability, never from here.

/** Hotbar composition import (`hotbar_view.svelte`). */
export const playerStateService = {
  hotbarSlots: [],
  abilityUses: {},
  useAbility: (_featureId: string): void => {},
};

/** Quest-overlay composition import (`quest_overlay.svelte`). */
export const questOverlayService = {
  visible: true,
  setVisible: (_visible: boolean): void => {},
};

export const questStateService = {
  quests: [],
  getEligibleEndings: (_questId: string): never[] => [],
  chooseEnding: (_questId: string, _endingId: string): boolean => false,
};

export const campaignService = {
  activeCampaign: undefined as { sampledTruthId?: string } | undefined,
};
