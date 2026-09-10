// apps/frontend/client/src/lib/views/game/ui/hud/testing/quest_overlay_reactive_fixtures.svelte.ts
//
// Reactive quest-overlay double for the real-Svelte (Vitest Browser Mode) lane.
// `visible` and `quests` are real `$state`, so a test can mutate them and
// observe the ViewModel's derived getters update through the real runtime.

import type { QuestData } from '@aikami/frontend/engine/sim';
import type {
  QuestOverlayQuestStateCapabilities,
  QuestOverlayVisibilityCapabilities,
} from '../quest_overlay_view_model.svelte';

export type ReactiveQuestOverlayHarness = {
  /** Overlay visibility capability (reactive). */
  overlay: QuestOverlayVisibilityCapabilities;
  /** Quest-state capability (reactive). */
  questState: QuestOverlayQuestStateCapabilities;
  /** Replace the reactive quest list. */
  setQuests(quests: QuestData[]): void;
  /** Set the reactive overlay visibility. */
  setVisible(visible: boolean): void;
};

/**
 * Creates a quest-overlay double whose `visible` / `quests` are real Svelte
 * `$state`, plus harness methods to mutate them.
 */
export const createReactiveQuestOverlayHarness = (): ReactiveQuestOverlayHarness => {
  let visible = $state(true);
  let quests = $state<QuestData[]>([]);

  const overlay: QuestOverlayVisibilityCapabilities = {
    get visible() {
      return visible;
    },
    setVisible: (next) => {
      visible = next;
    },
  };
  const questState: QuestOverlayQuestStateCapabilities = {
    get quests() {
      return quests;
    },
  };

  return {
    overlay,
    questState,
    setQuests: (next) => {
      quests = next;
    },
    setVisible: (next) => {
      visible = next;
    },
  };
};
