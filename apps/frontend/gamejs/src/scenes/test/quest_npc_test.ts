// apps/frontend/gamejs/src/scenes/test/quest_npc_test.ts
/**
 * Headless test scene for QuestManager and NPCManager.
 *
 * Run with:
 *   bun run dev:emulator --scene src/scenes/test/quest_npc_test.tscn --headless
 */
import { Node } from 'godot';
import QuestManager from '../../core/managers/quest_manager';
import NpcManager from '../../core/managers/npc_manager';
import { NpcId } from '../../core/models/npc';
import { logger } from '../../utils/logger';

type TestResult = {
    name: string;
    passed: boolean;
    error?: string;
};

export default class QuestNpcTest extends Node {
    private _results: TestResult[] = [];

    _ready(): void {
        logger.debug('QuestNpcTest._ready');
        this.runTests().then(() => {
            this._printReport();
            this.get_tree()?.quit();
        }).catch((error) => {
            logger.error('QuestNpcTest._ready error', error);
            this.get_tree()?.quit();
        });
    }

    private async runTests(): Promise<void> {
        await this._testQuestManagerSingleton();
        await this._testQuestStart();
        await this._testQuestUpdate();
        await this._testQuestCompletion();
        await this._testQuestSorting();
        await this._testNpcManagerSingleton();
        await this._testNpcGet();
        await this._testNpcDynamicData();
        await this._testNpcPortrait();
        await this._testNpcRecollections();
    }

    // --- QUEST MANAGER TESTS ---

    private async _testQuestManagerSingleton(): Promise<void> {
        const testName = 'quest_manager_singleton';
        try {
            const instance1 = this._getQuestManager();
            const instance2 = this._getQuestManager();
            if (instance1 !== instance2) {
                throw new Error('QuestManager is not a singleton');
            }
            this._pass(testName);
        } catch (error) {
            this._fail(testName, error);
        }
    }

    private async _testQuestStart(): Promise<void> {
        const testName = 'quest_start';
        try {
            const manager = this._getQuestManager();
            if (!manager) {
                throw new Error('QuestManager instance is null');
            }

            let startedQuestTitle = '';
            manager.initialize({
                onQuestStarted: (quest): void => {
                    startedQuestTitle = quest.title;
                },
            });

            manager.updateQuest({ title: 'Recover Lost Magical Flute' });

            if (startedQuestTitle !== 'Recover Lost Magical Flute') {
                throw new Error(`Expected quest start event, got "${startedQuestTitle}"`);
            }

            const active = manager.getActiveQuests();
            if (active.length !== 1) {
                throw new Error(`Expected 1 active quest, got ${active.length}`);
            }

            this._pass(testName);
        } catch (error) {
            this._fail(testName, error);
        }
    }

    private async _testQuestUpdate(): Promise<void> {
        const testName = 'quest_update';
        try {
            const manager = this._getQuestManager();
            if (!manager) {
                throw new Error('QuestManager instance is null');
            }

            let updatedTitle = '';
            manager.initialize({
                onQuestUpdated: (quest): void => {
                    updatedTitle = quest.title;
                },
            });

            manager.updateQuest({
                title: 'Recover Lost Magical Flute',
                completedStep: 'Find the flute',
            });

            if (updatedTitle !== 'Recover Lost Magical Flute') {
                throw new Error(`Expected update event, got "${updatedTitle}"`);
            }

            const quest = manager.findQuestStateByTitle('Recover Lost Magical Flute');
            if (!quest?.completedSteps.includes('find the flute')) {
                throw new Error('Completed step not recorded');
            }

            this._pass(testName);
        } catch (error) {
            this._fail(testName, error);
        }
    }

    private async _testQuestCompletion(): Promise<void> {
        const testName = 'quest_completion';
        try {
            const manager = this._getQuestManager();
            if (!manager) {
                throw new Error('QuestManager instance is null');
            }

            let completedTitle = '';
            let rewardsReceived = false;
            manager.initialize({
                onQuestCompleted: (quest): void => {
                    completedTitle = quest.title;
                },
                onQuestRewards: (options): void => {
                    rewardsReceived = options.xp > 0;
                },
            });

            manager.updateQuest({
                title: 'Recover Lost Magical Flute',
                isComplete: true,
            });

            if (completedTitle !== 'Recover Lost Magical Flute') {
                throw new Error(`Expected completion event, got "${completedTitle}"`);
            }
            if (!rewardsReceived) {
                throw new Error('Expected rewards to be disbursed');
            }

            const completed = manager.getCompletedQuests();
            if (completed.length !== 1) {
                throw new Error(`Expected 1 completed quest, got ${completed.length}`);
            }

            this._pass(testName);
        } catch (error) {
            this._fail(testName, error);
        }
    }

    private async _testQuestSorting(): Promise<void> {
        const testName = 'quest_sorting';
        try {
            const manager = this._getQuestManager();
            if (!manager) {
                throw new Error('QuestManager instance is null');
            }

            manager.reset();
            manager.updateQuest({ title: 'Recover Lost Magical Flute', completedStep: 'Find the flute' });
            manager.updateQuest({ title: 'Recover Lost Magical Flute', isComplete: true });

            // Only one quest exists, sorting should keep it in place
            manager.sortQuests();
            const quests = manager.getCurrentQuests();
            if (quests.length !== 1) {
                throw new Error(`Expected 1 quest, got ${quests.length}`);
            }

            this._pass(testName);
        } catch (error) {
            this._fail(testName, error);
        }
    }

    // --- NPC MANAGER TESTS ---

    private async _testNpcManagerSingleton(): Promise<void> {
        const testName = 'npc_manager_singleton';
        try {
            const instance1 = this._getNpcManager();
            const instance2 = this._getNpcManager();
            if (instance1 !== instance2) {
                throw new Error('NpcManager is not a singleton');
            }
            this._pass(testName);
        } catch (error) {
            this._fail(testName, error);
        }
    }

    private async _testNpcGet(): Promise<void> {
        const testName = 'npc_get';
        try {
            const manager = this._getNpcManager();
            if (!manager) {
                throw new Error('NpcManager instance is null');
            }

            const gandalf = manager.getNpc(NpcId.GANDALF);
            if (!gandalf) {
                throw new Error('Gandalf not found');
            }
            if (gandalf.template.name !== 'Gandalf the Grey') {
                throw new Error(`Unexpected name: ${gandalf.template.name}`);
            }
            if (gandalf.template.age !== 900) {
                throw new Error(`Unexpected age: ${gandalf.template.age}`);
            }

            const aragorn = manager.getNpc(NpcId.ARAGORN);
            if (!aragorn) {
                throw new Error('Aragorn not found');
            }
            if (aragorn.template.race !== 'human') {
                throw new Error(`Unexpected race: ${aragorn.template.race}`);
            }

            this._pass(testName);
        } catch (error) {
            this._fail(testName, error);
        }
    }

    private async _testNpcDynamicData(): Promise<void> {
        const testName = 'npc_dynamic_data';
        try {
            const manager = this._getNpcManager();
            if (!manager) {
                throw new Error('NpcManager instance is null');
            }

            const dynamic = manager.getDynamicData(NpcId.GANDALF);
            if (!dynamic) {
                throw new Error('Dynamic data not found');
            }
            if (dynamic.lastTimeSpokeAt !== -1) {
                throw new Error(`Expected lastTimeSpokeAt=-1, got ${dynamic.lastTimeSpokeAt}`);
            }
            if (dynamic.relationshipLevelWithPlayer !== 50) {
                throw new Error(`Expected relationship=50, got ${dynamic.relationshipLevelWithPlayer}`);
            }

            manager.updateLastSpokeAt(NpcId.GANDALF, 1440);
            const dynamicAfterTime = manager.getDynamicData(NpcId.GANDALF);
            if (!dynamicAfterTime || dynamicAfterTime.lastTimeSpokeAt !== 1440) {
                throw new Error(
                    `Expected lastTimeSpokeAt=1440, got ${dynamicAfterTime?.lastTimeSpokeAt}`,
                );
            }

            manager.adjustRelationship(NpcId.GANDALF, 10);
            const dynamicAfterRel = manager.getDynamicData(NpcId.GANDALF);
            if (!dynamicAfterRel || dynamicAfterRel.relationshipLevelWithPlayer !== 60) {
                throw new Error(
                    `Expected relationship=60, got ${dynamicAfterRel?.relationshipLevelWithPlayer}`,
                );
            }

            this._pass(testName);
        } catch (error) {
            this._fail(testName, error);
        }
    }

    private async _testNpcPortrait(): Promise<void> {
        const testName = 'npc_portrait';
        try {
            const manager = this._getNpcManager();
            if (!manager) {
                throw new Error('NpcManager instance is null');
            }

            const neutralPath = manager.getPortraitPath(NpcId.GANDALF, 'neutral');
            if (!neutralPath.includes('neutral')) {
                throw new Error(`Expected neutral portrait, got ${neutralPath}`);
            }

            const happyPath = manager.getPortraitPath(NpcId.GANDALF, 'happy');
            if (!happyPath.includes('happy')) {
                throw new Error(`Expected happy portrait, got ${happyPath}`);
            }

            // Test fallback to neutral for missing mood
            const missingPath = manager.getPortraitPath(NpcId.GANDALF, 'nonexistent');
            if (!missingPath.includes('neutral')) {
                throw new Error(`Expected fallback to neutral, got ${missingPath}`);
            }

            const moods = manager.getAvailableMoods(NpcId.GANDALF);
            if (moods.length !== 4) {
                throw new Error(`Expected 4 moods, got ${moods.length}`);
            }

            this._pass(testName);
        } catch (error) {
            this._fail(testName, error);
        }
    }

    private async _testNpcRecollections(): Promise<void> {
        const testName = 'npc_recollections';
        try {
            const manager = this._getNpcManager();
            if (!manager) {
                throw new Error('NpcManager instance is null');
            }

            manager.addRecollection(NpcId.GANDALF, "Player's name is Sonny");
            manager.addRecollection(NpcId.GANDALF, "Player likes pie");
            // Duplicate should be ignored
            manager.addRecollection(NpcId.GANDALF, "Player's name is Sonny");

            const dynamic = manager.getDynamicData(NpcId.GANDALF);
            if (!dynamic) {
                throw new Error('Dynamic data not found');
            }
            if (dynamic.recollections.length !== 2) {
                throw new Error(`Expected 2 recollections, got ${dynamic.recollections.length}`);
            }

            this._pass(testName);
        } catch (error) {
            this._fail(testName, error);
        }
    }

    // --- HELPERS ---

    private _getQuestManager(): QuestManager | null {
        return (
            QuestManager.instance ??
            ((globalThis as Record<string, unknown>).questManagerInstance as QuestManager | null)
        );
    }

    private _getNpcManager(): NpcManager | null {
        return (
            NpcManager.instance ??
            ((globalThis as Record<string, unknown>).npcManagerInstance as NpcManager | null)
        );
    }

    private _pass(name: string): void {
        this._results.push({ name, passed: true });
        logger.info('QuestNpcTest', `PASS: ${name}`);
    }

    private _fail(name: string, error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        this._results.push({ name, passed: false, error: message });
        logger.error('QuestNpcTest', `FAIL: ${name} — ${message}`);
    }

    private _printReport(): void {
        const passed = this._results.filter((r) => r.passed).length;
        const failed = this._results.filter((r) => !r.passed).length;

        logger.info('QuestNpcTest._printReport', '========================================');
        logger.info('QuestNpcTest._printReport', `Tests: ${this._results.length}`);
        logger.info('QuestNpcTest._printReport', `Passed: ${passed}`);
        logger.info('QuestNpcTest._printReport', `Failed: ${failed}`);
        logger.info('QuestNpcTest._printReport', '========================================');

        for (const result of this._results) {
            const status = result.passed ? 'PASS' : 'FAIL';
            logger.info('QuestNpcTest._printReport', `${status}: ${result.name}`);
            if (result.error) {
                logger.error('QuestNpcTest._printReport', `  Error: ${result.error}`);
            }
        }

        if (failed > 0) {
            logger.error('QuestNpcTest._printReport', `TEST SUITE FAILED (${failed} failures)`);
        } else {
            logger.info('QuestNpcTest._printReport', 'TEST SUITE PASSED');
        }
    }
}
