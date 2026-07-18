// apps/frontend/client/src/lib/services/game/quest_state_service.svelte.ts
//
// Quest state service — owns the quest lifecycle: accept, decline, progress,
// complete, reward delivery, serialize, hydrate.
// Listens to engine bridge trigger events (MAP_ENTERED, NPC_INTERACTED,
// ENCOUNTER_COMPLETED, ITEM_PICKED_UP) to evaluate objective progress.
//
// Contract: C-329 Integrate the Demo Quest from Offer Through Reward

import type {
  ContentPackLoaderInterface,
  QuestData,
  QuestObjectiveData,
} from '@aikami/frontend/engine';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { ActiveQuestState, QuestProgress } from '@aikami/types';
import { inventoryService } from './inventory_service.svelte';
import { playerStateService } from './player_state_service.svelte';
import { registerSerializable } from './serializable_service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** World trigger event that can advance quest objectives. */
export type QuestTriggerEvent =
  | { type: 'MAP_ENTERED'; mapUrl: string }
  | { type: 'NPC_INTERACTED'; npcId: string }
  | { type: 'ENCOUNTER_COMPLETED'; encounterId: string; victory: boolean }
  | { type: 'ITEM_PICKED_UP'; itemId: string };

export type QuestStateServiceInterface = BaseFrontendClassInterface & {
  /** Quest data for UI consumption (quest log, tracker HUD). */
  readonly quests: QuestData[];

  /** World-state flags set by quest endings. */
  readonly worldStateFlags: Record<string, boolean>;

  /**
   * Configures the service with a content pack loader.
   * Must be called before acceptQuest or evaluateTriggers.
   */
  configure(options: { contentPackLoader: ContentPackLoaderInterface }): void;

  /** Accepts a quest from a given NPC. Returns true if accepted. */
  acceptQuest(options: { questId: string; npcId: string }): boolean;

  /** Declines a quest. Persists the decline so it is not re-offered. */
  declineQuest(options: { questId: string }): void;

  /** Checks if a quest can be accepted (not already active/completed/failed/declined). */
  canAcceptQuest(questId: string): boolean;

  /**
   * Evaluates all active quest objectives against a world trigger event.
   * Called from bridge listeners for MAP_ENTERED, NPC_INTERACTED,
   * ENCOUNTER_COMPLETED, and ITEM_PICKED_UP.
   */
  evaluateTriggers(trigger: QuestTriggerEvent): void;

  /** Serializes quest state for save envelope. */
  serialize(): ActiveQuestState;

  /** Hydrates quest state from save envelope. */
  hydrate(state: ActiveQuestState): void;

  /** Starts bridge listeners for quest-trigger events. */
  startListening(): Promise<void>;

  /** Resets all quest state. */
  reset(): void;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class QuestStateService
  extends BaseFrontendClass<BaseFrontendClassOptions>
  implements QuestStateServiceInterface
{
  /** Quest data for UI consumption. */
  quests = $state<QuestData[]>([]);

  /** World-state flags from quest endings. */
  worldStateFlags = $state<Record<string, boolean>>({});

  private _contentPackLoader: ContentPackLoaderInterface | undefined;
  private _progress = $state<QuestProgress[]>([]);
  private _completedQuestIds = $state<string[]>([]);
  private _failedQuestIds = $state<string[]>([]);
  private _declinedQuestIds = $state<string[]>([]);
  private _listening = false;

  // ── Configuration ──

  /** @inheritdoc */
  configure(options: { contentPackLoader: ContentPackLoaderInterface }): void {
    this._contentPackLoader = options.contentPackLoader;
  }

  // ── Quest acceptance ──

  /** @inheritdoc */
  acceptQuest(options: { questId: string; npcId: string }): boolean {
    const { questId } = options;

    if (!this.canAcceptQuest(questId)) {
      this.debug('acceptQuest:blocked', { questId });
      return false;
    }

    const definition = this._getQuestDefinition(questId);
    if (!definition) {
      this.debug('acceptQuest:not-found', { questId });
      return false;
    }

    const progress: QuestProgress = {
      questId,
      status: 'active',
      objectives: definition.objectives.map((_, index) => ({
        objectiveIndex: index,
        current: 0,
      })),
      startedAt: Date.now(),
      rewardsGranted: false,
    };

    this._progress = [...this._progress, progress];
    this._syncQuests();

    // Emit bridge event
    this._emitQuestEvent({
      type: 'QUEST_ACCEPTED',
      questId,
      questName: definition.name,
    });

    this.debug('acceptQuest', { questId, name: definition.name });
    return true;
  }

  /** @inheritdoc */
  declineQuest(options: { questId: string }): void {
    const { questId } = options;
    if (!this._declinedQuestIds.includes(questId)) {
      this._declinedQuestIds = [...this._declinedQuestIds, questId];
      this.debug('declineQuest', { questId });
    }
  }

  /** @inheritdoc */
  canAcceptQuest(questId: string): boolean {
    if (this._declinedQuestIds.includes(questId)) {
      return false;
    }
    if (this._completedQuestIds.includes(questId)) {
      return false;
    }
    if (this._failedQuestIds.includes(questId)) {
      return false;
    }
    if (this._progress.some((p) => p.questId === questId)) {
      return false;
    }
    if (!this._getQuestDefinition(questId)) {
      return false;
    }
    return true;
  }

  // ── Objective triggers ──

  /** @inheritdoc */
  evaluateTriggers(trigger: QuestTriggerEvent): void {
    let changed = false;

    for (const progress of this._progress) {
      if (progress.status !== 'active') {
        continue;
      }

      const definition = this._getQuestDefinition(progress.questId);
      if (!definition) {
        continue;
      }

      for (let i = 0; i < definition.objectives.length; i++) {
        const objectiveDef = definition.objectives[i];
        const progressEntry = progress.objectives.find((o) => o.objectiveIndex === i);
        if (!progressEntry) {
          continue;
        }

        // Already complete — skip
        if (progressEntry.current >= 1) {
          continue;
        }

        // Check if this trigger matches the objective condition
        let matched = false;
        switch (trigger.type) {
          case 'MAP_ENTERED':
            // Resolve the content pack map ID from the map URL.
            // The quest objective defines completeOnMapEnter as the content pack map ID.
            matched =
              this._contentPackLoader?.resolveMapId(trigger.mapUrl) ===
              objectiveDef.completeOnMapEnter;
            break;
          case 'NPC_INTERACTED':
            matched = objectiveDef.completeOnNpcInteract === trigger.npcId;
            break;
          case 'ENCOUNTER_COMPLETED':
            matched = objectiveDef.completeOnEncounterComplete === trigger.encounterId;
            break;
          case 'ITEM_PICKED_UP':
            matched = objectiveDef.completeOnItemPickup === trigger.itemId;
            break;
        }

        if (matched) {
          progressEntry.current = 1;
          changed = true;

          // Emit progress event
          this._emitQuestEvent({
            type: 'QUEST_PROGRESSED',
            questId: progress.questId,
            objectiveIndex: i,
            current: 1,
            max: 1,
          });

          this.debug('evaluateTriggers:objectiveComplete', {
            questId: progress.questId,
            objectiveIndex: i,
            triggerType: trigger.type,
          });
        }
      }

      // Check if all objectives are now complete
      if (changed) {
        this._checkQuestCompletion(progress);
      }
    }

    // Sync quest data after any changes
    if (changed) {
      this._syncQuests();
    }
  }

  // ── Serialization ──

  /** @inheritdoc */
  serialize(): ActiveQuestState {
    return {
      activeQuests: this._progress,
      completedQuestIds: this._completedQuestIds,
      failedQuestIds: this._failedQuestIds,
      declinedQuestIds: this._declinedQuestIds,
      worldStateFlags: this.worldStateFlags,
    };
  }

  /** @inheritdoc */
  hydrate(state: ActiveQuestState): void {
    if (!state) {
      return;
    }
    this._progress = state.activeQuests ?? [];
    this._completedQuestIds = state.completedQuestIds ?? [];
    this._failedQuestIds = state.failedQuestIds ?? [];
    this._declinedQuestIds = state.declinedQuestIds ?? [];
    this.worldStateFlags = state.worldStateFlags ?? {};
    this._syncQuests();
    this.debug('hydrate', {
      activeCount: this._progress.length,
      completedCount: this._completedQuestIds.length,
    });
  }

  /** @inheritdoc */
  reset(): void {
    this._progress = [];
    this._completedQuestIds = [];
    this._failedQuestIds = [];
    this._declinedQuestIds = [];
    this.worldStateFlags = {};
    this.quests = [];
    this._listening = false;
    this.debug('reset:cleared');
  }

  // ── Engine bridge listeners ──

  /** @inheritdoc */
  async startListening(): Promise<void> {
    if (this._listening) {
      return;
    }
    this._listening = true;

    try {
      const { createEngineBridge } = await import('@aikami/frontend/engine');
      const bridge = createEngineBridge();

      bridge.on('MAP_ENTERED', (event) => {
        this.evaluateTriggers({ type: 'MAP_ENTERED', mapUrl: event.mapUrl });
      });

      bridge.on('ENCOUNTER_COMPLETED', (event) => {
        this.evaluateTriggers({
          type: 'ENCOUNTER_COMPLETED',
          encounterId: event.encounterId,
          victory: event.victory,
        });
      });

      bridge.on('ITEM_PICKED_UP', (event) => {
        this.evaluateTriggers({ type: 'ITEM_PICKED_UP', itemId: event.itemId });
      });

      // NPC_INTERACTED is already handled by the dialogue system.
      // We wire it here as a pass-through for quest evaluation.
      bridge.on('NPC_DIALOG_START', (event) => {
        this.evaluateTriggers({ type: 'NPC_INTERACTED', npcId: event.npcId });
      });
    } catch (error) {
      this.debug('startListening:failed', { error: String(error) });
    }
  }

  // ── Private: quest sync ──

  /**
   * Rebuilds the quests array from internal _progress state.
   * Called after any mutation to _progress, _completedQuestIds, or _failedQuestIds.
   */
  private _syncQuests(): void {
    const result: QuestData[] = [];

    for (const progress of this._progress) {
      const definition = this._getQuestDefinition(progress.questId);
      if (!definition) {
        continue;
      }

      const objectives: QuestObjectiveData[] = definition.objectives.map((def, index) => {
        const progressEntry = progress.objectives.find((o) => o.objectiveIndex === index);
        return {
          label: def.text,
          current: progressEntry?.current ?? 0,
          max: 1,
        };
      });

      const questData: QuestData = {
        id: progress.questId,
        title: definition.name,
        description: definition.description,
        status: progress.status,
        objectives,
      };

      // Add ending narration if available
      if (progress.chosenEndingId && definition.endings) {
        const ending = definition.endings[progress.chosenEndingId];
        if (ending) {
          (questData as { endingNarration?: string }).endingNarration = ending.narration;
        }
      }

      // Add reward summary if granted
      if (progress.rewardsGranted && definition.rewards) {
        (questData as { rewards?: Array<{ type: string; label: string }> }).rewards =
          definition.rewards.map((r) => ({
            type: r.type,
            label:
              r.type === 'item' && r.itemId
                ? `Item: ${r.itemId}`
                : r.type === 'gold'
                  ? `Gold: ${r.amount ?? 0}`
                  : `XP: ${r.amount ?? 0}`,
          }));
      }

      result.push(questData);
    }

    // Add completed quests that are no longer in progress
    for (const completedId of this._completedQuestIds) {
      if (!result.some((q) => q.id === completedId)) {
        const definition = this._getQuestDefinition(completedId);
        if (definition) {
          result.push({
            id: completedId,
            title: definition.name,
            description: definition.description,
            status: 'completed',
            objectives: definition.objectives.map((def) => ({
              label: def.text,
              current: 1,
              max: 1,
            })),
          });
        }
      }
    }

    // Add failed quests
    for (const failedId of this._failedQuestIds) {
      if (!result.some((q) => q.id === failedId)) {
        const definition = this._getQuestDefinition(failedId);
        if (definition) {
          result.push({
            id: failedId,
            title: definition.name,
            description: definition.description,
            status: 'failed',
            objectives: definition.objectives.map((def) => ({
              label: def.text,
              current: 0,
              max: 1,
            })),
          });
        }
      }
    }

    this.quests = result;
  }

  // ── Private: quest completion ──

  /**
   * Checks if all objectives of an active quest are complete.
   * If so, transitions to completed status and delivers rewards.
   */
  private _checkQuestCompletion(progress: QuestProgress): void {
    const definition = this._getQuestDefinition(progress.questId);
    if (!definition) {
      return;
    }

    const allComplete = definition.objectives.every((_, index) => {
      const entry = progress.objectives.find((o) => o.objectiveIndex === index);
      return entry && entry.current >= 1;
    });

    if (!allComplete) {
      return;
    }

    progress.status = 'completed';
    progress.completedAt = Date.now();

    // Default ending: first available ending ID, or undefined
    const endingIds = Object.keys(definition.endings ?? {});
    if (endingIds.length > 0 && !progress.chosenEndingId) {
      progress.chosenEndingId = endingIds[0];
    }

    // Deliver rewards (idempotent)
    this._deliverRewards(progress);

    // Move to completed list
    this._completedQuestIds = [...this._completedQuestIds, progress.questId];
    this._progress = this._progress.filter((p) => p.questId !== progress.questId);

    // Emit completion event
    this._emitQuestEvent({
      type: 'QUEST_COMPLETED',
      questId: progress.questId,
      endingId: progress.chosenEndingId,
    });
  }

  // ── Private: reward delivery ──

  /**
   * Delivers quest rewards. Idempotent — only fires once per quest.
   */
  private _deliverRewards(progress: QuestProgress): void {
    if (progress.rewardsGranted) {
      return;
    }

    const definition = this._getQuestDefinition(progress.questId);
    if (!definition) {
      return;
    }

    const rewards: Array<{ type: 'item' | 'gold' | 'xp'; itemId?: string; amount?: number }> = [];

    for (const reward of definition.rewards) {
      try {
        switch (reward.type) {
          case 'item': {
            if (reward.itemId) {
              inventoryService.addItem({ itemId: reward.itemId, quantity: 1 });
              rewards.push({ type: 'item', itemId: reward.itemId });
            }
            break;
          }
          case 'gold': {
            if (reward.amount) {
              inventoryService.addGold({ amount: reward.amount });
              rewards.push({ type: 'gold', amount: reward.amount });
            }
            break;
          }
          case 'xp': {
            if (reward.amount) {
              playerStateService.addXp({ amount: reward.amount });
              rewards.push({ type: 'xp', amount: reward.amount });
            }
            break;
          }
          case 'equipment': {
            // Equipment is a subtype of item in the content pack schema
            if (reward.itemId) {
              inventoryService.addItem({ itemId: reward.itemId, quantity: 1 });
              rewards.push({ type: 'item', itemId: reward.itemId });
            }
            break;
          }
        }
      } catch (error) {
        this.debug('_deliverRewards:error', {
          questId: progress.questId,
          rewardType: reward.type,
          error: String(error),
        });
      }
    }

    // Set world-state flag from ending
    if (progress.chosenEndingId && definition.endings) {
      const ending = definition.endings[progress.chosenEndingId];
      if (ending?.worldStateFlag) {
        this.worldStateFlags = { ...this.worldStateFlags, [ending.worldStateFlag]: true };
        this.debug('_deliverRewards:worldStateFlag', {
          flag: ending.worldStateFlag,
          questId: progress.questId,
        });
      }
    }

    progress.rewardsGranted = true;

    // Emit reward event
    this._emitQuestEvent({
      type: 'QUEST_REWARD_GRANTED',
      questId: progress.questId,
      rewards,
    });
  }

  // ── Private: helpers ──

  /**
   * Returns the content pack quest definition for a quest ID, or undefined.
   */
  private _getQuestDefinition(questId: string) {
    return this._contentPackLoader?.getQuest(questId);
  }

  /**
   * Emits a quest lifecycle event through the engine bridge.
   * Best-effort — failures are logged but do not block quest logic.
   */
  private async _emitQuestEvent(
    event: Extract<
      import('@aikami/frontend/engine').GameEvent,
      { type: 'QUEST_ACCEPTED' | 'QUEST_PROGRESSED' | 'QUEST_COMPLETED' | 'QUEST_REWARD_GRANTED' }
    >,
  ): Promise<void> {
    try {
      const { createEngineBridge } = await import('@aikami/frontend/engine');
      const bridge = createEngineBridge();
      bridge.emit(event);
    } catch (_error) {
      // Bridge may not be available (e.g. during tests or before engine init)
      // Silently ignore — quest state is driven locally, bridge events are
      // informational for other listeners.
    }
  }
}

export const questStateService: QuestStateServiceInterface = QuestStateService.create({
  className: 'QuestStateService',
});

// Register for save/load persistence
registerSerializable(
  'questState',
  questStateService as unknown as import('./serializable_service').SerializableService<unknown>,
);
