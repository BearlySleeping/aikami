// apps/frontend/client/src/lib/services/game/quest_state_service.svelte.ts
//
// Quest state service — owns the quest lifecycle: accept, decline, progress,
// complete, reward delivery, serialize, hydrate.
// Listens to engine bridge trigger events (MAP_ENTERED, NPC_INTERACTED,
// ENCOUNTER_COMPLETED, ITEM_PICKED_UP) to evaluate objective progress.
//
// Contract: C-329 Integrate the Demo Quest from Offer Through Reward
// Contract: C-339 Complete Quest Graph, Journal, Objectives, and Reward Pipelines

import type {
  ContentPackLoaderInterface,
  QuestData,
  QuestJournalEntry,
  QuestObjectiveData,
} from '@aikami/frontend/engine';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type {
  ActiveQuestState,
  ContentPackQuestEntry,
  QuestObjectiveFailureCondition,
  QuestProgress,
} from '@aikami/types';
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

  /** Journal entries for completed and failed quests (C-339). */
  readonly journalEntries: readonly QuestJournalEntry[];

  /**
   * Configures the service with a content pack loader.
   * Must be called before acceptQuest or evaluateTriggers.
   */
  configure(options: { contentPackLoader: ContentPackLoaderInterface }): void;

  /** Accepts a quest from a given NPC. Returns true if accepted. */
  acceptQuest(options: { questId: string; npcId: string }): boolean;

  /** Declines a quest. Persists the decline so it is not re-offered. */
  declineQuest(options: { questId: string }): void;

  /** Checks if a quest can be accepted (not already active/completed/failed/declined, chain prerequisites met, cooldown expired). */
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

  /** Journal entries for completed/failed quests (C-339). */
  journalEntries = $state<QuestJournalEntry[]>([]);

  private _contentPackLoader: ContentPackLoaderInterface | undefined;
  private _progress = $state<QuestProgress[]>([]);
  private _completedQuestIds = $state<string[]>([]);
  private _completedProgress = $state<QuestProgress[]>([]);
  private _failedQuestIds = $state<string[]>([]);
  private _declinedQuestIds = $state<string[]>([]);
  /** Last completion timestamps for repeatable quests (C-339). */
  private _repeatableCompletions = $state<Record<string, number>>({});
  private _listening = false;
  private _unsubscribers: Array<() => void> = [];

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

    const now = Date.now();

    // Create v1 objective progress (C-339)
    const objectives = definition.objectives.map((objDef, index) => {
      // Determine initial status: locked if has prerequisites, otherwise active
      const hasPrerequisites = objDef.prerequisiteIndices && objDef.prerequisiteIndices.length > 0;
      const status: 'locked' | 'active' = hasPrerequisites ? 'locked' : 'active';
      const isHidden = objDef.hidden === true;

      return {
        objectiveIndex: index,
        current: 0,
        status,
        hiddenRevealed: !isHidden, // Visible by default unless hidden
        activeSince: status === 'active' ? now : undefined,
      };
    });

    const progress: QuestProgress = {
      questId,
      status: 'active',
      objectives,
      startedAt: now,
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
      // If repeatable, check cooldown
      const definition = this._getQuestDefinition(questId);
      if (definition?.repeatable) {
        const lastCompleted = this._repeatableCompletions[questId];
        if (lastCompleted && definition.repeatCooldownDays) {
          const cooldownMs = definition.repeatCooldownDays * 24 * 60 * 60 * 1000;
          if (Date.now() - lastCompleted < cooldownMs) {
            return false;
          }
        }
        // Cooldown expired or no cooldown — re-offerable
        return true;
      }
      return false;
    }
    if (this._failedQuestIds.includes(questId)) {
      return false;
    }
    if (this._progress.some((p) => p.questId === questId)) {
      return false;
    }
    const definition = this._getQuestDefinition(questId);
    if (!definition) {
      return false;
    }
    // Check chain prerequisites (C-339)
    if (definition.prerequisiteQuestIds && definition.prerequisiteQuestIds.length > 0) {
      for (const prereqId of definition.prerequisiteQuestIds) {
        if (
          !this._completedQuestIds.includes(prereqId) &&
          !this._completedProgress.some((p) => p.questId === prereqId)
        ) {
          return false;
        }
      }
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

      // First pass: check timed expiry for all active objectives (C-339)
      if (this._checkTimedExpiry(progress, definition)) {
        changed = true;
      }

      // Second pass: evaluate trigger against active objectives
      for (let i = 0; i < definition.objectives.length; i++) {
        const objectiveDef = definition.objectives[i];
        const progressEntry = progress.objectives.find((o) => o.objectiveIndex === i);
        if (!progressEntry) {
          continue;
        }

        // Skip objectives that aren't active (locked, completed, failed, skipped, expired)
        if (progressEntry.status !== 'active') {
          continue;
        }

        // Already at max — skip
        if (progressEntry.current >= (objectiveDef.maxCount ?? 1)) {
          continue;
        }

        // Check reveal trigger for hidden objectives (C-339)
        if (objectiveDef.hidden && !progressEntry.hiddenRevealed && objectiveDef.revealOn) {
          if (this._matchesRevealTrigger(trigger, objectiveDef.revealOn)) {
            this._revealObjective(progress, i, progressEntry);
            changed = true;
          }
        }

        // Check failure conditions (C-339)
        if (objectiveDef.failureConditions && objectiveDef.failureConditions.length > 0) {
          for (const failureCond of objectiveDef.failureConditions) {
            if (this._matchesFailureCondition(trigger, failureCond)) {
              this._failObjective(progress, i, progressEntry, definition);
              changed = true;
              break; // Don't check more failure conditions after failing
            }
          }
          // If just failed, skip completion check for this objective
          if ((progressEntry.status as string) === 'failed') {
            continue;
          }
        }

        // Check if this trigger matches the objective completion condition
        let matched = false;
        switch (trigger.type) {
          case 'MAP_ENTERED':
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
          progressEntry.current = Math.min(progressEntry.current + 1, objectiveDef.maxCount ?? 1);
          changed = true;

          // Check if objective reached required count
          const required = objectiveDef.requiredCount ?? objectiveDef.maxCount ?? 1;
          if (progressEntry.current >= required) {
            progressEntry.status = 'completed';
          }

          // Emit progress event
          this._emitQuestEvent({
            type: 'QUEST_PROGRESSED',
            questId: progress.questId,
            objectiveIndex: i,
            current: progressEntry.current,
            max: objectiveDef.maxCount ?? 1,
          });

          this.debug('evaluateTriggers:objectiveAdvanced', {
            questId: progress.questId,
            objectiveIndex: i,
            current: progressEntry.current,
            triggerType: trigger.type,
          });
        }
      }

      // Third pass: activate newly-unlocked objectives after trigger evaluation (C-339)
      this._activateReadyObjectives(progress, definition);

      // Fourth pass: check if any completed terminal objective completes the quest (branching)
      this._checkTerminalCompletion(progress, definition);

      // Check if quest is complete or should fail (C-339)
      if (changed) {
        this._checkQuestCompletion(progress, definition);
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
      schemaVersion: 1,
      activeQuests: this._progress,
      completedQuestIds: this._completedQuestIds,
      completedQuests: this._completedProgress,
      failedQuestIds: this._failedQuestIds,
      declinedQuestIds: this._declinedQuestIds,
      worldStateFlags: this.worldStateFlags,
      repeatableCompletions: this._repeatableCompletions,
      journalEntries: this.journalEntries,
    };
  }

  /** @inheritdoc */
  hydrate(state: ActiveQuestState): void {
    if (!state) {
      return;
    }

    // Detect and migrate v0 state (C-339)
    const version = state.schemaVersion ?? 0;
    if (version === 0) {
      this.debug('hydrate:migrating-v0');
      state = this._migrateV0ToV1(state);
    }

    this._progress = state.activeQuests ?? [];
    this._completedQuestIds = state.completedQuestIds ?? [];
    this._completedProgress = state.completedQuests ?? [];
    this._failedQuestIds = state.failedQuestIds ?? [];
    this._declinedQuestIds = state.declinedQuestIds ?? [];
    this.worldStateFlags = state.worldStateFlags ?? {};
    this._repeatableCompletions = state.repeatableCompletions ?? {};
    this.journalEntries = state.journalEntries ?? [];
    this._syncQuests();
    this.debug('hydrate', {
      schemaVersion: state.schemaVersion ?? 1,
      activeCount: this._progress.length,
      completedCount: this._completedQuestIds.length,
      journalCount: this.journalEntries.length,
    });
  }

  /** @inheritdoc */
  reset(): void {
    // Unsubscribe all bridge listeners
    for (const unsubscribe of this._unsubscribers) {
      try {
        unsubscribe();
      } catch (_error) {
        // Best-effort cleanup
      }
    }
    this._unsubscribers = [];

    this._progress = [];
    this._completedQuestIds = [];
    this._completedProgress = [];
    this._failedQuestIds = [];
    this._declinedQuestIds = [];
    this._repeatableCompletions = {};
    this.journalEntries = [];
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

      this._unsubscribers.push(
        bridge.on('MAP_ENTERED', (event) => {
          this.evaluateTriggers({ type: 'MAP_ENTERED', mapUrl: event.mapUrl });
        }),
      );

      this._unsubscribers.push(
        bridge.on('ENCOUNTER_COMPLETED', (event) => {
          this.evaluateTriggers({
            type: 'ENCOUNTER_COMPLETED',
            encounterId: event.encounterId,
            victory: event.victory,
          });
        }),
      );

      this._unsubscribers.push(
        bridge.on('ITEM_PICKED_UP', (event) => {
          this.evaluateTriggers({ type: 'ITEM_PICKED_UP', itemId: event.itemId });
        }),
      );

      // NPC_INTERACTED is already handled by the dialogue system.
      // We wire it here as a pass-through for quest evaluation.
      this._unsubscribers.push(
        bridge.on('NPC_DIALOG_START', (event) => {
          this.evaluateTriggers({ type: 'NPC_INTERACTED', npcId: event.npcId });
        }),
      );
    } catch (error) {
      // Bridge unavailable; reset listening flag so retry is possible
      this._listening = false;
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
        const maxCount = def.maxCount ?? 1;
        return {
          label: def.text,
          current: progressEntry?.current ?? 0,
          max: maxCount,
          status: (progressEntry?.status as QuestObjectiveData['status']) ?? 'active',
          hidden: def.hidden,
          hiddenRevealed: progressEntry?.hiddenRevealed ?? true,
          optional: def.optional,
          activeSince: progressEntry?.activeSince,
          timeLimitSeconds: def.timeLimitSeconds,
        };
      });

      const questData: QuestData = {
        id: progress.questId,
        title: definition.name,
        description: definition.description,
        status: progress.status,
        objectives,
        repeatable: definition.repeatable,
        questChainId: definition.questChainId,
        chainOrder: definition.chainOrder,
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
              current: def.maxCount ?? 1,
              max: def.maxCount ?? 1,
              status: 'completed' as const,
              hidden: def.hidden,
              hiddenRevealed: true,
              optional: def.optional,
            })),
            repeatable: definition.repeatable,
            questChainId: definition.questChainId,
            chainOrder: definition.chainOrder,
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
              max: def.maxCount ?? 1,
              status: 'failed' as const,
              hidden: def.hidden,
              hiddenRevealed: true,
              optional: def.optional,
            })),
            repeatable: definition.repeatable,
            questChainId: definition.questChainId,
            chainOrder: definition.chainOrder,
          });
        }
      }
    }

    this.quests = result;

    // Emit QUESTS_UPDATED so the engine bridge (and any listeners like
    // worldStateService) receive the updated quest state.
    this._emitQuestEvent({
      type: 'QUESTS_UPDATED',
      quests: result,
    });
  }

  // ── Private: quest completion (C-339) ──

  /**
   * Checks if a quest is complete or has failed.
   * Only required (non-optional, non-failed, non-expired) objectives count toward completion.
   * If all required paths are exhausted, quest fails.
   */
  private _checkQuestCompletion(progress: QuestProgress, definition: ContentPackQuestEntry): void {
    // Check if all required objectives are completed
    let allRequiredComplete = true;
    let anyRequiredFailed = false;

    for (let i = 0; i < definition.objectives.length; i++) {
      const objectiveDef = definition.objectives[i];
      const progressEntry = progress.objectives.find((o) => o.objectiveIndex === i);
      if (!progressEntry) {
        continue;
      }

      const isOptional = objectiveDef.optional === true;

      if (progressEntry.status === 'failed' || progressEntry.status === 'expired') {
        if (!isOptional) {
          anyRequiredFailed = true;
        }
      } else if (progressEntry.status !== 'completed' && progressEntry.status !== 'skipped') {
        if (!isOptional) {
          allRequiredComplete = false;
        }
      }
    }

    // If a required objective failed, the quest fails
    if (anyRequiredFailed) {
      this._failQuest(progress);
      return;
    }

    if (!allRequiredComplete) {
      return;
    }

    // Mark remaining optional/locked objectives as skipped
    for (const entry of progress.objectives) {
      if (entry.status === 'locked' || entry.status === 'active') {
        entry.status = 'skipped';
      }
    }

    this._completeQuest(progress, definition);
  }

  /**
   * Checks if a completed terminal objective triggers quest completion.
   * A terminal objective is one that no other objective depends on.
   * Only applies to branching quests (at least one objective has prerequisites).
   * When a terminal completes, other incomplete path objectives are skipped.
   */
  private _checkTerminalCompletion(
    progress: QuestProgress,
    definition: ContentPackQuestEntry,
  ): void {
    // Only apply to branching quests (at least one objective has prerequisites)
    const hasAnyPrerequisites = definition.objectives.some(
      (o) => o.prerequisiteIndices && o.prerequisiteIndices.length > 0,
    );
    if (!hasAnyPrerequisites) {
      return;
    }

    // Quest already completed — don't double-complete
    if (progress.status !== 'active') {
      return;
    }
    const hasDependents = new Set<number>();
    for (let i = 0; i < definition.objectives.length; i++) {
      const prereqs = definition.objectives[i].prerequisiteIndices;
      if (prereqs) {
        for (const prereqIndex of prereqs) {
          hasDependents.add(prereqIndex);
        }
      }
    }

    // Find terminal objectives (no one depends on them)
    for (let i = 0; i < definition.objectives.length; i++) {
      if (hasDependents.has(i)) {
        continue; // Has dependents — not terminal
      }

      const progressEntry = progress.objectives.find((o) => o.objectiveIndex === i);
      if (progressEntry?.status !== 'completed') {
        continue;
      }

      // A terminal objective completed — this path is complete
      // Skip all other non-completed, non-failed active/locked objectives
      for (const entry of progress.objectives) {
        if (entry.status === 'locked' || entry.status === 'active') {
          entry.status = 'skipped';
        }
      }

      this._completeQuest(progress, definition);
      return;
    }
  }

  /**
   * Marks a quest as completed and delivers rewards.
   * Idempotent — only processes active quests.
   */
  private _completeQuest(progress: QuestProgress, definition: ContentPackQuestEntry): void {
    if (progress.status !== 'active') {
      return; // Already completed or failed — idempotent guard
    }
    progress.status = 'completed';
    progress.completedAt = Date.now();

    // Default ending: first available ending ID, or undefined
    const endingIds = Object.keys(definition.endings ?? {});
    if (endingIds.length > 0 && !progress.chosenEndingId) {
      progress.chosenEndingId = endingIds[0];
    }

    // Deliver rewards (idempotent)
    this._deliverRewards(progress, definition);

    // Create journal entry (C-339)
    this._createJournalEntry(progress, definition);

    // Track repeatable completion timestamp (C-339)
    if (definition.repeatable) {
      this._repeatableCompletions = {
        ...this._repeatableCompletions,
        [progress.questId]: Date.now(),
      };
    }

    // Move to completed list (preserve full progress record)
    this._completedQuestIds = [...this._completedQuestIds, progress.questId];
    this._completedProgress = [...this._completedProgress, { ...progress }];
    this._progress = this._progress.filter((p) => p.questId !== progress.questId);

    // Emit completion event
    this._emitQuestEvent({
      type: 'QUEST_COMPLETED',
      questId: progress.questId,
      endingId: progress.chosenEndingId,
    });
  }

  /**
   * Marks a quest as failed.
   */
  private _failQuest(progress: QuestProgress): void {
    progress.status = 'failed';
    progress.completedAt = Date.now();

    const definition = this._getQuestDefinition(progress.questId);

    // Mark remaining active/locked objectives as skipped
    for (const entry of progress.objectives) {
      if (entry.status === 'locked' || entry.status === 'active') {
        entry.status = 'skipped';
      }
    }

    // Create journal entry for failed quest (C-339)
    if (definition) {
      this._createJournalEntry(progress, definition);
    }

    this._failedQuestIds = [...this._failedQuestIds, progress.questId];
    this._progress = this._progress.filter((p) => p.questId !== progress.questId);

    this.debug('_failQuest', { questId: progress.questId });
  }

  // ── Private: reward delivery ──

  /**
   * Delivers quest rewards. Idempotent — only fires once per quest.
   */
  private _deliverRewards(progress: QuestProgress, definition: ContentPackQuestEntry): void {
    if (progress.rewardsGranted) {
      return;
    }

    const rewards: Array<{ type: 'item' | 'gold' | 'xp'; itemId?: string; amount?: number }> = [];
    let anyRewardFailed = false;

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
        anyRewardFailed = true;
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

    // Only mark rewardsGranted if every reward was delivered successfully
    if (!anyRewardFailed) {
      progress.rewardsGranted = true;
    }

    // Emit reward event
    this._emitQuestEvent({
      type: 'QUEST_REWARD_GRANTED',
      questId: progress.questId,
      rewards,
    });
  }

  // ── Private: graph engine helpers (C-339) ──

  /**
   * Checks for timed objectives that have expired and transitions them to 'expired'.
   * Returns true if any objective was expired.
   */
  private _checkTimedExpiry(progress: QuestProgress, definition: ContentPackQuestEntry): boolean {
    const now = Date.now();
    let expired = false;

    for (let i = 0; i < definition.objectives.length; i++) {
      const objectiveDef = definition.objectives[i];
      const progressEntry = progress.objectives.find((o) => o.objectiveIndex === i);
      if (!progressEntry || !objectiveDef.timeLimitSeconds) {
        continue;
      }

      // Only check active objectives with timers
      if (progressEntry.status !== 'active' || !progressEntry.activeSince) {
        continue;
      }

      const elapsedMs = now - progressEntry.activeSince;
      if (elapsedMs >= objectiveDef.timeLimitSeconds * 1000) {
        progressEntry.status = 'expired';
        expired = true;
        this.debug('_checkTimedExpiry:expired', {
          questId: progress.questId,
          objectiveIndex: i,
          elapsedMs,
          timeLimitSeconds: objectiveDef.timeLimitSeconds,
        });
      }
    }

    return expired;
  }

  /**
   * Activates objectives whose prerequisites have been met.
   */
  private _activateReadyObjectives(
    progress: QuestProgress,
    definition: ContentPackQuestEntry,
  ): void {
    const now = Date.now();

    for (let i = 0; i < definition.objectives.length; i++) {
      const objectiveDef = definition.objectives[i];
      const progressEntry = progress.objectives.find((o) => o.objectiveIndex === i);
      if (!progressEntry) {
        continue;
      }

      // Only activate locked objectives
      if (progressEntry.status !== 'locked') {
        continue;
      }

      // Check prerequisites
      if (!this._arePrerequisitesMet(i, progress, definition)) {
        continue;
      }

      // Activate
      progressEntry.status = 'active';
      progressEntry.activeSince = now;

      // If not hidden, reveal immediately
      if (!objectiveDef.hidden) {
        progressEntry.hiddenRevealed = true;
      }

      this.debug('_activateReadyObjectives:activated', {
        questId: progress.questId,
        objectiveIndex: i,
      });
    }
  }

  /**
   * Checks if all prerequisites for an objective are met.
   */
  private _arePrerequisitesMet(
    objectiveIndex: number,
    progress: QuestProgress,
    definition: ContentPackQuestEntry,
  ): boolean {
    const objectiveDef = definition.objectives[objectiveIndex];
    if (!objectiveDef?.prerequisiteIndices || objectiveDef.prerequisiteIndices.length === 0) {
      return true; // No prerequisites — always active from start
    }

    for (const prereqIndex of objectiveDef.prerequisiteIndices) {
      if (prereqIndex < 0 || prereqIndex >= definition.objectives.length) {
        this.warn('_arePrerequisitesMet:invalidIndex', {
          objectiveIndex,
          prereqIndex,
          questId: progress.questId,
        });
        return false;
      }

      const prereqEntry = progress.objectives.find((o) => o.objectiveIndex === prereqIndex);
      if (!prereqEntry) {
        return false;
      }

      // Prerequisite is met if completed or skipped (but not failed/expired)
      if (prereqEntry.status !== 'completed' && prereqEntry.status !== 'skipped') {
        return false;
      }
    }

    return true;
  }

  /**
   * Reveals a hidden objective.
   */
  private _revealObjective(
    progress: QuestProgress,
    objectiveIndex: number,
    progressEntry: QuestProgress['objectives'][number],
  ): void {
    if (progressEntry.hiddenRevealed) {
      return;
    }
    progressEntry.hiddenRevealed = true;
    progressEntry.revealedAt = Date.now();
    this.debug('_revealObjective', {
      questId: progress.questId,
      objectiveIndex,
    });
  }

  /**
   * Fails an objective and cascades to dependent objectives.
   */
  private _failObjective(
    progress: QuestProgress,
    objectiveIndex: number,
    progressEntry: QuestProgress['objectives'][number],
    definition: ContentPackQuestEntry,
  ): void {
    if (progressEntry.status === 'failed' || progressEntry.status === 'expired') {
      return;
    }
    progressEntry.status = 'failed';

    // Cascade: skip all objectives that depend on this one
    for (const entry of progress.objectives) {
      if (entry.status !== 'locked') {
        continue;
      }
      const entryDef = definition.objectives[entry.objectiveIndex];
      if (entryDef?.prerequisiteIndices?.includes(objectiveIndex)) {
        entry.status = 'skipped';
        this.debug('_failObjective:cascadeSkipped', {
          questId: progress.questId,
          failedIndex: objectiveIndex,
          skippedIndex: entry.objectiveIndex,
        });
      }
    }

    this.debug('_failObjective', {
      questId: progress.questId,
      objectiveIndex,
    });
  }

  /**
   * Checks if a trigger matches a hidden objective's reveal condition.
   */
  private _matchesRevealTrigger(
    trigger: QuestTriggerEvent,
    revealOn: { type: string; id: string },
  ): boolean {
    switch (trigger.type) {
      case 'MAP_ENTERED':
        return (
          revealOn.type === 'MAP_ENTERED' &&
          this._contentPackLoader?.resolveMapId(trigger.mapUrl) === revealOn.id
        );
      case 'NPC_INTERACTED':
        return revealOn.type === 'NPC_INTERACTED' && trigger.npcId === revealOn.id;
      case 'ENCOUNTER_COMPLETED':
        return revealOn.type === 'ENCOUNTER_COMPLETED' && trigger.encounterId === revealOn.id;
      case 'ITEM_PICKED_UP':
        return revealOn.type === 'ITEM_PICKED_UP' && trigger.itemId === revealOn.id;
      default:
        return false;
    }
  }

  /**
   * Checks if a trigger matches a failure condition.
   * Only onTrigger failure conditions are supported.
   */
  private _matchesFailureCondition(
    trigger: QuestTriggerEvent,
    failureCondition: QuestObjectiveFailureCondition,
  ): boolean {
    if (failureCondition.kind === 'onTrigger') {
      switch (trigger.type) {
        case 'MAP_ENTERED':
          return (
            failureCondition.triggerType === 'MAP_ENTERED' &&
            this._contentPackLoader?.resolveMapId(trigger.mapUrl) === failureCondition.triggerId
          );
        case 'NPC_INTERACTED':
          return (
            failureCondition.triggerType === 'NPC_INTERACTED' &&
            trigger.npcId === failureCondition.triggerId
          );
        case 'ENCOUNTER_COMPLETED':
          return (
            failureCondition.triggerType === 'ENCOUNTER_COMPLETED' &&
            trigger.encounterId === failureCondition.triggerId
          );
        default:
          return false;
      }
    }
    return false;
  }

  // ── Private: journal (C-339) ──

  /**
   * Creates a journal entry for a completed or failed quest.
   */
  private _createJournalEntry(progress: QuestProgress, definition: ContentPackQuestEntry): void {
    const ending = progress.chosenEndingId
      ? definition.endings?.[progress.chosenEndingId]
      : undefined;

    const objectiveResults = definition.objectives.map((def, index) => {
      const entry = progress.objectives.find((o) => o.objectiveIndex === index);
      return {
        label: def.text,
        status: entry?.status ?? 'skipped',
        revealedAt: entry?.hiddenRevealed && def.hidden ? entry.revealedAt : undefined,
      };
    });

    const rewardEntries = definition.rewards.map((r) => ({
      type: r.type,
      label:
        r.type === 'item' && r.itemId
          ? `Item: ${r.itemId}`
          : r.type === 'gold'
            ? `Gold: ${r.amount ?? 0}`
            : `XP: ${r.amount ?? 0}`,
    }));

    const worldFlags: string[] = [];
    if (ending?.worldStateFlag) {
      worldFlags.push(ending.worldStateFlag);
    }

    const entry: QuestJournalEntry = {
      questId: progress.questId,
      title: definition.name,
      status: progress.status === 'completed' ? 'completed' : 'failed',
      timestamp: progress.completedAt ?? Date.now(),
      endingId: progress.chosenEndingId,
      endingTitle: ending?.title,
      narration: ending?.narration ?? definition.description,
      objectiveResults,
      rewards: rewardEntries,
      worldStateFlags: worldFlags,
    };

    this.journalEntries = [...this.journalEntries, entry];
    this.debug('_createJournalEntry', {
      questId: progress.questId,
      status: entry.status,
      journalCount: this.journalEntries.length,
    });
  }

  // ── Private: migration (C-339) ──

  /**
   * Migrates a v0 quest state (C-329 format) to v1 (C-339 format).
   * Non-destructive — returns a new state object.
   */
  private _migrateV0ToV1(state: ActiveQuestState): ActiveQuestState {
    const now = Date.now();

    const migrateObjectives = (
      objectives: QuestProgress['objectives'],
      startedAt: number,
    ): QuestProgress['objectives'] => {
      return objectives.map((obj) => ({
        objectiveIndex: obj.objectiveIndex,
        current: obj.current,
        status: obj.current >= 1 ? 'completed' : 'active',
        hiddenRevealed: true, // v0 had no hidden concept — all were visible
        activeSince: startedAt,
      })) as QuestProgress['objectives'];
    };

    const migrateProgress = (p: QuestProgress): QuestProgress => ({
      ...p,
      objectives: migrateObjectives(p.objectives, p.startedAt),
    });

    // Create journal entries for completed quests that have full progress records
    const migratedJournalEntries: QuestJournalEntry[] = [];
    const definition = this._contentPackLoader;
    for (const completedProgress of state.completedQuests ?? []) {
      const questDef = definition?.getQuest(completedProgress.questId);
      if (questDef) {
        const ending = completedProgress.chosenEndingId
          ? questDef.endings?.[completedProgress.chosenEndingId]
          : undefined;

        migratedJournalEntries.push({
          questId: completedProgress.questId,
          title: questDef.name,
          status: 'completed',
          timestamp: completedProgress.completedAt ?? now,
          endingId: completedProgress.chosenEndingId,
          endingTitle: ending?.title,
          narration: ending?.narration ?? questDef.description,
          objectiveResults: questDef.objectives.map((objDef, _index) => ({
            label: objDef.text,
            status: 'completed' as const,
          })),
          rewards: questDef.rewards.map((r) => ({
            type: r.type,
            label:
              r.type === 'item' && r.itemId
                ? `Item: ${r.itemId}`
                : r.type === 'gold'
                  ? `Gold: ${r.amount ?? 0}`
                  : `XP: ${r.amount ?? 0}`,
          })),
          worldStateFlags: ending?.worldStateFlag ? [ending.worldStateFlag] : [],
        });
      }
    }

    // Create journal entries for failed quests (basic entries without full progress)
    for (const failedId of state.failedQuestIds ?? []) {
      const questDef = definition?.getQuest(failedId);
      if (questDef) {
        migratedJournalEntries.push({
          questId: failedId,
          title: questDef.name,
          status: 'failed',
          timestamp: now,
          narration: questDef.description,
          objectiveResults: questDef.objectives.map((objDef) => ({
            label: objDef.text,
            status: 'failed' as const,
          })),
          rewards: [],
          worldStateFlags: [],
        });
      }
    }

    return {
      schemaVersion: 1,
      activeQuests: (state.activeQuests ?? []).map(migrateProgress),
      completedQuestIds: state.completedQuestIds ?? [],
      completedQuests: (state.completedQuests ?? []).map(migrateProgress),
      failedQuestIds: state.failedQuestIds ?? [],
      declinedQuestIds: state.declinedQuestIds ?? [],
      worldStateFlags: state.worldStateFlags ?? {},
      repeatableCompletions: {},
      journalEntries: migratedJournalEntries,
    };
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
      {
        type:
          | 'QUEST_ACCEPTED'
          | 'QUEST_PROGRESSED'
          | 'QUEST_COMPLETED'
          | 'QUEST_REWARD_GRANTED'
          | 'QUESTS_UPDATED';
      }
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
