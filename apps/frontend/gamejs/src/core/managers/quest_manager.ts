// apps/frontend/gamejs/src/core/managers/quest_manager.ts
/**
 * Quest system manager.
 * Tracks predefined quest templates, active quest states, and completions.
 * Supports rewards, notifications, and sorting.
 */
import { Node } from 'godot';
import { logger } from '../../utils/logger';
import {
    PREDEFINED_QUESTS,
    createQuestState,
    questStateToJson,
    questStateFromJson,
} from '../models/quest';
import type { QuestDefinition, QuestState, QuestRewardItem } from '../models/quest';

export type QuestUpdateListener = (quest: QuestState) => void;

export type QuestManagerOptions = {
    onQuestStarted?: QuestUpdateListener;
    onQuestUpdated?: QuestUpdateListener;
    onQuestCompleted?: QuestUpdateListener;
    onQuestRewards?: (options: { title: string; xp: number; items: QuestRewardItem[] }) => void;
};

/**
 * Central manager for the game's quest system.
 * Implemented as a singleton autoload.
 */
export default class QuestManager extends Node {
    private static _instance: QuestManager | null = null;

    private _questDefinitions: Map<string, QuestDefinition> = new Map();
    private _currentQuests: QuestState[] = [];
    private _onQuestStarted?: QuestUpdateListener;
    private _onQuestUpdated?: QuestUpdateListener;
    private _onQuestCompleted?: QuestUpdateListener;
    private _onQuestRewards?: (options: { title: string; xp: number; items: QuestRewardItem[] }) => void;

    static get instance(): QuestManager | null {
        return QuestManager._instance;
    }

    _ready(): void {
        logger.debug('QuestManager._ready');
        QuestManager._instance = this;
        (globalThis as Record<string, unknown>).questManagerInstance = this;
        this._gatherQuestData();
    }

    /**
     * Initialize the manager with optional event listeners.
     */
    initialize(options: QuestManagerOptions): void {
        logger.debug('QuestManager.initialize');
        this._onQuestStarted = options.onQuestStarted;
        this._onQuestUpdated = options.onQuestUpdated;
        this._onQuestCompleted = options.onQuestCompleted;
        this._onQuestRewards = options.onQuestRewards;
    }

    // --- QUEST DATA ---

    private _gatherQuestData(): void {
        logger.debug('QuestManager._gatherQuestData');
        this._questDefinitions.clear();
        for (const [id, definition] of Object.entries(PREDEFINED_QUESTS)) {
            this._questDefinitions.set(id, definition);
        }
    }

    /**
     * Get a quest definition by its ID.
     */
    getQuestDefinition(questId: string): QuestDefinition | undefined {
        logger.debug('QuestManager.getQuestDefinition', questId);
        return this._questDefinitions.get(questId);
    }

    /**
     * Get all quest definitions.
     */
    getAllQuestDefinitions(): QuestDefinition[] {
        logger.debug('QuestManager.getAllQuestDefinitions');
        return Array.from(this._questDefinitions.values());
    }

    // --- QUEST STATE ---

    /**
     * Get all current quest states (active + completed).
     */
    getCurrentQuests(): QuestState[] {
        logger.debug('QuestManager.getCurrentQuests');
        return [...this._currentQuests];
    }

    /**
     * Get only active (incomplete) quests.
     */
    getActiveQuests(): QuestState[] {
        logger.debug('QuestManager.getActiveQuests');
        return this._currentQuests.filter((q) => !q.isComplete);
    }

    /**
     * Get only completed quests.
     */
    getCompletedQuests(): QuestState[] {
        logger.debug('QuestManager.getCompletedQuests');
        return this._currentQuests.filter((q) => q.isComplete);
    }

    /**
     * Find a quest state by title (case-insensitive).
     */
    findQuestStateByTitle(title: string): QuestState | undefined {
        logger.debug('QuestManager.findQuestStateByTitle', title);
        const lowerTitle = title.toLowerCase();
        return this._currentQuests.find((q) => q.title.toLowerCase() === lowerTitle);
    }

    /**
     * Update a quest's progress. Creates the quest if not yet active.
     */
    updateQuest(options: {
        title: string;
        completedStep?: string;
        isComplete?: boolean;
    }): void {
        logger.debug('QuestManager.updateQuest', { title: options.title, isComplete: options.isComplete });

        const existingIndex = this._getQuestIndexByTitle(options.title);

        if (existingIndex === -1) {
            this._startNewQuest(options);
            return;
        }

        this._updateExistingQuest(existingIndex, options);
    }

    private _startNewQuest(options: { title: string; completedStep?: string; isComplete?: boolean }): void {
        const definition = this._findDefinitionByTitle(options.title);
        if (!definition) {
            logger.warn('QuestManager._startNewQuest', `No definition found for "${options.title}"`);
            return;
        }

        const newQuest = createQuestState(definition);
        if (options.completedStep) {
            newQuest.completedSteps.push(options.completedStep.toLowerCase());
        }
        if (options.isComplete) {
            newQuest.isComplete = true;
        }

        this._currentQuests.push(newQuest);
        this._onQuestStarted?.(newQuest);
        logger.info('QuestManager._startNewQuest', `Quest started: ${newQuest.title}`);
    }

    private _updateExistingQuest(
        index: number,
        options: { title: string; completedStep?: string; isComplete?: boolean },
    ): void {
        const quest = this._currentQuests[index];

        if (options.completedStep) {
            const lowerStep = options.completedStep.toLowerCase();
            if (!quest.completedSteps.includes(lowerStep)) {
                quest.completedSteps.push(lowerStep);
            }
        }

        if (options.isComplete !== undefined) {
            quest.isComplete = options.isComplete;
        }

        this._onQuestUpdated?.(quest);

        if (quest.isComplete) {
            this._onQuestCompleted?.(quest);
            logger.info('QuestManager._updateExistingQuest', `Quest completed: ${quest.title}`);
            this._disperseQuestRewards(quest);
        }
    }

    private _disperseQuestRewards(quest: QuestState): void {
        const definition = this._questDefinitions.get(quest.id);
        if (!definition) {
            return;
        }

        logger.info('QuestManager._disperseQuestRewards', {
            title: quest.title,
            xp: definition.rewardXp,
        });

        this._onQuestRewards?.({
            title: quest.title,
            xp: definition.rewardXp,
            items: definition.rewardItems,
        });
    }

    private _getQuestIndexByTitle(title: string): number {
        const lowerTitle = title.toLowerCase();
        return this._currentQuests.findIndex((q) => q.title.toLowerCase() === lowerTitle);
    }

    private _findDefinitionByTitle(title: string): QuestDefinition | undefined {
        const lowerTitle = title.toLowerCase();
        for (const definition of this._questDefinitions.values()) {
            if (definition.title.toLowerCase() === lowerTitle) {
                return definition;
            }
        }
        return undefined;
    }

    // --- SERIALIZATION ---

    /**
     * Serialize all current quest states to JSON.
     */
    toJson(): Record<string, unknown>[] {
        logger.debug('QuestManager.toJson');
        return this._currentQuests.map((q) => questStateToJson(q));
    }

    /**
     * Restore quest states from saved JSON.
     */
    fromJson(data: Record<string, unknown>[]): void {
        logger.debug('QuestManager.fromJson');
        this._currentQuests = data.map((d) => questStateFromJson(d));
    }

    // --- SORTING ---

    /**
     * Sort quests: active first (alphabetical), then completed (alphabetical).
     */
    sortQuests(): void {
        logger.debug('QuestManager.sortQuests');
        const active = this._currentQuests.filter((q) => !q.isComplete);
        const completed = this._currentQuests.filter((q) => q.isComplete);

        active.sort((a, b) => a.title.localeCompare(b.title));
        completed.sort((a, b) => a.title.localeCompare(b.title));

        this._currentQuests = [...active, ...completed];
    }

    /**
     * Reset all quest progress.
     */
    reset(): void {
        logger.info('QuestManager.reset', 'Clearing all quest progress');
        this._currentQuests = [];
    }
}

export { QuestManager };
