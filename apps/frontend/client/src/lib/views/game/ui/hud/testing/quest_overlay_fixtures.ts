// apps/frontend/client/src/lib/views/game/ui/hud/testing/quest_overlay_fixtures.ts
//
// Feature-owned test doubles for the quest-overlay ViewModel. Each factory
// returns a fresh object typed against the narrow capability contracts the
// ViewModel consumes. Operations are not defaulted to success: an unconfigured
// call throws, so a test cannot pass by accident on a silent no-op.

import type { QuestData } from '@aikami/frontend/engine/sim';
import type {
  QuestOverlayCampaignCapabilities,
  QuestOverlayQuestStateCapabilities,
  QuestOverlayVisibilityCapabilities,
} from '../quest_overlay_view_model.svelte';

const unconfigured = (operation: string): never => {
  throw new Error(`Unexpected ${operation} call; configure this fixture explicitly.`);
};

/** Overlay visibility capabilities, visible by default. */
export const createQuestOverlayVisibility = (
  overrides: Partial<QuestOverlayVisibilityCapabilities> = {},
): QuestOverlayVisibilityCapabilities => ({
  visible: true,
  setVisible: () => unconfigured('setVisible'),
  ...overrides,
});

/** Quest-state capability with an empty quest list until overridden. */
export const createQuestStateCapabilities = (
  quests: QuestData[] = [],
  overrides: Partial<QuestOverlayQuestStateCapabilities> = {},
): QuestOverlayQuestStateCapabilities => ({
  quests,
  ...overrides,
});

/** Campaign capability with no active campaign until overridden. */
export const createQuestCampaignCapabilities = (
  overrides: Partial<QuestOverlayCampaignCapabilities> = {},
): QuestOverlayCampaignCapabilities => ({
  activeCampaign: undefined,
  ...overrides,
});
