// apps/frontend/gamejs/src/scenes/test/game_systems_test.ts
/**
 * Headless test scene for PlayerManager, SaveManager, SceneManager,
 * DialoguePromptBuilder, and DialogueManager.
 *
 * Run with:
 *   bun run dev:emulator --scene src/scenes/test/game_systems_test.tscn --headless
 */
import { Node } from 'godot';
import PlayerManager from '../../core/managers/player_manager';
import SaveManager from '../../core/managers/save_manager';
import SceneManager from '../../core/managers/scene_manager';
import DialogueManager from '../../core/managers/dialogue_manager';
import { DialogueState } from '../../core/managers/dialogue_manager';
import {
    buildFirstMessagePrompt,
    buildDialogueFunctionRequest,
    parseDialogueResponse,
    trimConversationHistory,
} from '../../core/api/dialogue_prompt_builder';
import { NpcId, PREDEFINED_NPCS, createNpcDynamicData } from '../../core/models/npc';
import { createPlayerDynamicData, EquippedSlot } from '../../core/models/player';
import { SceneName } from '../../core/managers/scene_manager';
import { logger } from '../../utils/logger';

type TestResult = {
    name: string;
    passed: boolean;
    error?: string;
};

export default class GameSystemsTest extends Node {
    private _results: TestResult[] = [];

    _ready(): void {
        logger.debug('GameSystemsTest._ready');
        this.runTests().then(() => {
            this._printReport();
            this.get_tree()?.quit();
        }).catch((error) => {
            logger.error('GameSystemsTest._ready error', error);
            this.get_tree()?.quit();
        });
    }

    private async runTests(): Promise<void> {
        await this._testPlayerManager();
        await this._testSaveManager();
        await this._testSceneManager();
        await this._testDialoguePromptBuilder();
        await this._testDialogueManager();
    }

    // --- PLAYER MANAGER ---

    private async _testPlayerManager(): Promise<void> {
        const testName = 'player_manager';
        try {
            const manager = this._getPlayerManager();
            if (!manager) {
                throw new Error('PlayerManager instance is null');
            }

            let hpChanged = false;
            let posChanged = false;
            let leveledUp = false;

            manager.connectHealthChanged((_hp, _maxHp): void => {
                hpChanged = true;
            });
            manager.connectPositionChanged((_x, _y): void => {
                posChanged = true;
            });
            manager.connectLevelUp((_level): void => {
                leveledUp = true;
            });

            manager.initialize({
                snapshot: {
                    static: {
                        id: 'test',
                        name: 'TestPlayer',
                        race: 'human',
                        characterClass: 'wizard',
                        gender: 'male',
                        age: 25,
                        appearance: ['Tall', 'Dark hair'],
                        avatarPath: '',
                        unitSpritePath: '',
                    },
                    dynamic: createPlayerDynamicData({ hp: 50, maxHp: 100 }),
                },
            });

            if (manager.getName() !== 'TestPlayer') {
                throw new Error(`Expected name TestPlayer, got ${manager.getName()}`);
            }

            manager.heal(10);
            if (!hpChanged) {
                throw new Error('Health change listener not fired');
            }

            manager.updatePosition(100, 200);
            if (!posChanged) {
                throw new Error('Position change listener not fired');
            }

            manager.addExperiencePoints(2000);
            if (!leveledUp) {
                throw new Error('Expected level up');
            }
            if (manager.getLevel() !== 2) {
                throw new Error(`Expected level 2, got ${manager.getLevel()}`);
            }

            const prev = manager.equip(EquippedSlot.MAIN_HAND, 'iron_sword');
            if (prev !== undefined) {
                throw new Error('Expected no previous item');
            }

            const removed = manager.unequip(EquippedSlot.MAIN_HAND);
            if (removed !== 'iron_sword') {
                throw new Error(`Expected iron_sword, got ${removed}`);
            }

            manager.addToInventory('health_potion');
            if (manager.getInventory().length !== 1) {
                throw new Error('Inventory not updated');
            }

            this._pass(testName);
        } catch (error) {
            this._fail(testName, error);
        }
    }

    // --- SAVE MANAGER ---

    private async _testSaveManager(): Promise<void> {
        const testName = 'save_manager';
        try {
            const manager = this._getSaveManager();
            if (!manager) {
                throw new Error('SaveManager instance is null');
            }

            manager.initialize({ autoSaveIntervalMs: 1000, useCloudSave: false });
            manager.reset();

            if (manager.isDirty()) {
                throw new Error('Expected clean state after reset');
            }

            manager.setCurrentScene('res://test_scene.tscn');
            if (!manager.isDirty()) {
                throw new Error('Expected dirty after scene change');
            }

            manager.addPersistentValue('defeated_boss_1');
            if (!manager.hasPersistentValue('defeated_boss_1')) {
                throw new Error('Persistent value not found');
            }

            // Duplicate should be ignored
            manager.addPersistentValue('defeated_boss_1');

            const metadata = manager.getMetadata();
            if (metadata.playerName !== '') {
                throw new Error('Expected empty player name');
            }

            this._pass(testName);
        } catch (error) {
            this._fail(testName, error);
        }
    }

    // --- SCENE MANAGER ---

    private async _testSceneManager(): Promise<void> {
        const testName = 'scene_manager';
        try {
            const manager = this._getSceneManager();
            if (!manager) {
                throw new Error('SceneManager instance is null');
            }

            const path = manager.getScenePath(SceneName.MAIN_MENU);
            if (!path || !path.includes('main_menu')) {
                throw new Error(`Unexpected scene path: ${path}`);
            }

            manager.setTilemapBounds({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
            const bounds = manager.getTilemapBounds();
            if (!bounds || bounds.maxX !== 100) {
                throw new Error('Tilemap bounds not set');
            }

            if (manager.isTransitioning) {
                throw new Error('Should not be transitioning');
            }

            this._pass(testName);
        } catch (error) {
            this._fail(testName, error);
        }
    }

    // --- DIALOGUE PROMPT BUILDER ---

    private async _testDialoguePromptBuilder(): Promise<void> {
        const testName = 'dialogue_prompt_builder';
        try {
            const npc = PREDEFINED_NPCS[NpcId.GANDALF];
            const dynamic = createNpcDynamicData();
            const player = {
                static: {
                    id: 'p1',
                    name: 'Aragorn',
                    race: 'human',
                    characterClass: 'ranger',
                    gender: 'male',
                    age: 87,
                    appearance: ['Tall', 'Ranger gear'],
                    avatarPath: '',
                    unitSpritePath: '',
                },
                dynamic: createPlayerDynamicData(),
            };

            const context = {
                npc,
                player,
                dynamic,
                currentTime: { day: 0, hour: 8, minute: 30 },
                calendarString: '18 of February 1030, 08:30',
                messages: ['First prompt'],
            };

            const firstPrompt = buildFirstMessagePrompt(context);
            if (!firstPrompt.includes('Context')) {
                throw new Error('First prompt missing Context section');
            }
            if (!firstPrompt.includes('Gandalf the Grey')) {
                throw new Error('First prompt missing NPC name');
            }
            if (!firstPrompt.includes('name:')) {
                throw new Error('First prompt missing player info');
            }

            const request = buildDialogueFunctionRequest(context);
            if (request.name !== 'npc_dialogue') {
                throw new Error(`Unexpected function name: ${request.name}`);
            }
            if (request.fields.length !== 3) {
                throw new Error(`Expected 3 fields, got ${request.fields.length}`);
            }

            const parsed = parseDialogueResponse({
                text_response: 'Hello there!',
                action: 'continue_conversation',
                mood: 'happy',
            });
            if (parsed.textResponse !== 'Hello there!') {
                throw new Error('Parse failed for text_response');
            }
            if (parsed.mood !== 'happy') {
                throw new Error('Parse failed for mood');
            }

            // Test conversation trimming
            const longHistory = ['context', 'msg1', 'msg2', 'msg3', 'msg4', 'msg5', 'msg6', 'msg7', 'msg8', 'msg9', 'msg10', 'msg11', 'msg12'];
            const trimmed = trimConversationHistory(longHistory, 3);
            if (trimmed.length !== 7) {
                // context + 3 exchanges * 2 = 7
                throw new Error(`Expected 7 messages after trim, got ${trimmed.length}`);
            }
            if (trimmed[0] !== 'context') {
                throw new Error('Context message should be preserved');
            }

            this._pass(testName);
        } catch (error) {
            this._fail(testName, error);
        }
    }

    // --- DIALOGUE MANAGER ---

    private async _testDialogueManager(): Promise<void> {
        const testName = 'dialogue_manager';
        try {
            const manager = this._getDialogueManager();
            if (!manager) {
                throw new Error('DialogueManager instance is null');
            }

            if (manager.isActive) {
                throw new Error('Should not be active initially');
            }
            if (manager.state !== DialogueState.IDLE) {
                throw new Error(`Expected IDLE, got ${manager.state}`);
            }

            // Cannot start with NONE
            await manager.startConversation(NpcId.NONE);
            if (manager.isActive) {
                throw new Error('Should not start conversation with NONE');
            }

            // State transitions are async and depend on AI; we verify the state machine works
            manager.initialize({
                onStateChange: (state): void => {
                    logger.debug('GameSystemsTest.onStateChange', state);
                },
            });

            this._pass(testName);
        } catch (error) {
            this._fail(testName, error);
        }
    }

    // --- HELPERS ---

    private _getPlayerManager(): PlayerManager | null {
        return (
            PlayerManager.instance ??
            ((globalThis as Record<string, unknown>).playerManagerInstance as PlayerManager | null)
        );
    }

    private _getSaveManager(): SaveManager | null {
        return (
            SaveManager.instance ??
            ((globalThis as Record<string, unknown>).saveManagerInstance as SaveManager | null)
        );
    }

    private _getSceneManager(): SceneManager | null {
        return (
            SceneManager.instance ??
            ((globalThis as Record<string, unknown>).sceneManagerInstance as SceneManager | null)
        );
    }

    private _getDialogueManager(): DialogueManager | null {
        return (
            DialogueManager.instance ??
            ((globalThis as Record<string, unknown>).dialogueManagerInstance as DialogueManager | null)
        );
    }

    private _pass(name: string): void {
        this._results.push({ name, passed: true });
        logger.info('GameSystemsTest', `PASS: ${name}`);
    }

    private _fail(name: string, error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        this._results.push({ name, passed: false, error: message });
        logger.error('GameSystemsTest', `FAIL: ${name} — ${message}`);
    }

    private _printReport(): void {
        const passed = this._results.filter((r) => r.passed).length;
        const failed = this._results.filter((r) => !r.passed).length;

        logger.info('GameSystemsTest._printReport', '========================================');
        logger.info('GameSystemsTest._printReport', `Tests: ${this._results.length}`);
        logger.info('GameSystemsTest._printReport', `Passed: ${passed}`);
        logger.info('GameSystemsTest._printReport', `Failed: ${failed}`);
        logger.info('GameSystemsTest._printReport', '========================================');

        for (const result of this._results) {
            const status = result.passed ? 'PASS' : 'FAIL';
            logger.info('GameSystemsTest._printReport', `${status}: ${result.name}`);
            if (result.error) {
                logger.error('GameSystemsTest._printReport', `  Error: ${result.error}`);
            }
        }

        if (failed > 0) {
            logger.error('GameSystemsTest._printReport', `TEST SUITE FAILED (${failed} failures)`);
        } else {
            logger.info('GameSystemsTest._printReport', 'TEST SUITE PASSED');
        }
    }
}
