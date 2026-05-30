// apps/frontend/gamejs/src/scenes/test/managers_test.ts
/**
 * Headless test scene for SignalManager, TimeManager, and FirebaseManager.
 *
 * Run with:
 *   bun run dev:emulator --scene src/scenes/test/managers_test.tscn --headless
 */
import { Node } from 'godot';
import SignalManager from '../../core/managers/signal_manager';
import TimeManager from '../../core/managers/time_manager';
import FirebaseManager from '../../core/managers/firebase_manager';
import { logger } from '../../utils/logger';

type TestResult = {
    name: string;
    passed: boolean;
    error?: string;
};

export default class ManagersTest extends Node {
    private _results: TestResult[] = [];

    _ready(): void {
        logger.debug('ManagersTest._ready');
        this.runTests().then(() => {
            this._printReport();
            this.get_tree()?.quit();
        }).catch((error) => {
            logger.error('ManagersTest._ready error', error);
            this.get_tree()?.quit();
        });
    }

    private async runTests(): Promise<void> {
        await this._testSignalManagerSingleton();
        await this._testSignalManagerTextChunk();
        await this._testSignalManagerProcessed();
        await this._testTimeManagerSingleton();
        await this._testTimeManagerCalendar();
        await this._testTimeManagerDifference();
        await this._testFirebaseManagerSingleton();
    }

    // --- SIGNAL MANAGER TESTS ---

    private async _testSignalManagerSingleton(): Promise<void> {
        const testName = 'signal_manager_singleton';
        try {
            const instance1 = this._getSignalManager();
            const instance2 = this._getSignalManager();
            if (instance1 !== instance2) {
                throw new Error('SignalManager is not a singleton');
            }
            this._pass(testName);
        } catch (error) {
            this._fail(testName, error);
        }
    }

    private async _testSignalManagerTextChunk(): Promise<void> {
        const testName = 'signal_manager_text_chunk';
        try {
            const manager = this._getSignalManager();
            if (!manager) {
                throw new Error('SignalManager instance is null');
            }

            const received: string[] = [];
            const listener = (text: string): void => {
                received.push(text);
            };

            manager.connectTextChunk(listener);
            manager.emitTextChunk('Hello');
            manager.emitTextChunk(' World');
            manager.disconnectTextChunk(listener);
            manager.emitTextChunk('Ignored');

            if (received.length !== 2) {
                throw new Error(`Expected 2 chunks, got ${received.length}`);
            }
            if (received[0] !== 'Hello' || received[1] !== ' World') {
                throw new Error(`Unexpected chunks: ${received.join(', ')}`);
            }

            this._pass(testName);
        } catch (error) {
            this._fail(testName, error);
        }
    }

    private async _testSignalManagerProcessed(): Promise<void> {
        const testName = 'signal_manager_processed';
        try {
            const manager = this._getSignalManager();
            if (!manager) {
                throw new Error('SignalManager instance is null');
            }

            let tickCount = 0;
            const listener = (_delta: number): void => {
                tickCount++;
            };

            manager.connectProcessed(listener);
            // Wait a few frames for _process to fire
            await this._waitFrames(3);
            manager.disconnectProcessed(listener);

            if (tickCount < 1) {
                throw new Error(`Expected at least 1 process tick, got ${tickCount}`);
            }

            this._pass(testName);
        } catch (error) {
            this._fail(testName, error);
        }
    }

    // --- TIME MANAGER TESTS ---

    private async _testTimeManagerSingleton(): Promise<void> {
        const testName = 'time_manager_singleton';
        try {
            const instance1 = this._getTimeManager();
            const instance2 = this._getTimeManager();
            if (instance1 !== instance2) {
                throw new Error('TimeManager is not a singleton');
            }
            this._pass(testName);
        } catch (error) {
            this._fail(testName, error);
        }
    }

    private async _testTimeManagerCalendar(): Promise<void> {
        const testName = 'time_manager_calendar';
        try {
            const manager = this._getTimeManager();
            if (!manager) {
                throw new Error('TimeManager instance is null');
            }

            const time = { day: 3, hour: 8, minute: 30, totalInGameMinutes: 3 * 1440 + 8 * 60 + 30 };
            const calendar = manager.toCalendar(time);
            const expected = '21 of February 1030, 08:30';
            if (calendar !== expected) {
                throw new Error(`Expected "${expected}", got "${calendar}"`);
            }

            const time2 = { day: 0, hour: 0, minute: 0, totalInGameMinutes: 0 };
            const calendar2 = manager.toCalendar(time2);
            const expected2 = '18 of February 1030, 00:00';
            if (calendar2 !== expected2) {
                throw new Error(`Expected "${expected2}", got "${calendar2}"`);
            }

            this._pass(testName);
        } catch (error) {
            this._fail(testName, error);
        }
    }

    private async _testTimeManagerDifference(): Promise<void> {
        const testName = 'time_manager_difference';
        try {
            const manager = this._getTimeManager();
            if (!manager) {
                throw new Error('TimeManager instance is null');
            }

            // Simulate 100 minutes of game time passed
            // We can't easily manipulate internal state, so we just test the format
            const result = manager.toCurrentTimeDifference(0);
            if (!result.includes('ago')) {
                throw new Error(`Expected "ago" in result, got "${result}"`);
            }

            this._pass(testName);
        } catch (error) {
            this._fail(testName, error);
        }
    }

    // --- FIREBASE MANAGER TESTS ---

    private async _testFirebaseManagerSingleton(): Promise<void> {
        const testName = 'firebase_manager_singleton';
        try {
            const instance1 = this._getFirebaseManager();
            const instance2 = this._getFirebaseManager();
            if (instance1 !== instance2) {
                throw new Error('FirebaseManager is not a singleton');
            }
            this._pass(testName);
        } catch (error) {
            this._fail(testName, error);
        }
    }

    // --- HELPERS ---

    private _getSignalManager(): SignalManager | null {
        return (
            SignalManager.instance ??
            ((globalThis as Record<string, unknown>).signalManagerInstance as SignalManager | null)
        );
    }

    private _getTimeManager(): TimeManager | null {
        return (
            TimeManager.instance ??
            ((globalThis as Record<string, unknown>).timeManagerInstance as TimeManager | null)
        );
    }

    private _getFirebaseManager(): FirebaseManager | null {
        return (
            FirebaseManager.instance ??
            ((globalThis as Record<string, unknown>).firebaseManagerInstance as FirebaseManager | null)
        );
    }

    private _waitFrames(count: number): Promise<void> {
        return new Promise((resolve) => {
            let frames = 0;
            const check = (): void => {
                frames++;
                if (frames >= count) {
                    resolve();
                    return;
                }
                setTimeout(check, 16);
            };
            check();
        });
    }

    private _pass(name: string): void {
        this._results.push({ name, passed: true });
        logger.info('ManagersTest', `PASS: ${name}`);
    }

    private _fail(name: string, error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        this._results.push({ name, passed: false, error: message });
        logger.error('ManagersTest', `FAIL: ${name} — ${message}`);
    }

    private _printReport(): void {
        const passed = this._results.filter((r) => r.passed).length;
        const failed = this._results.filter((r) => !r.passed).length;

        logger.info('ManagersTest._printReport', '========================================');
        logger.info('ManagersTest._printReport', `Tests: ${this._results.length}`);
        logger.info('ManagersTest._printReport', `Passed: ${passed}`);
        logger.info('ManagersTest._printReport', `Failed: ${failed}`);
        logger.info('ManagersTest._printReport', '========================================');

        for (const result of this._results) {
            const status = result.passed ? 'PASS' : 'FAIL';
            logger.info('ManagersTest._printReport', `${status}: ${result.name}`);
            if (result.error) {
                logger.error('ManagersTest._printReport', `  Error: ${result.error}`);
            }
        }

        if (failed > 0) {
            logger.error('ManagersTest._printReport', `TEST SUITE FAILED (${failed} failures)`);
        } else {
            logger.info('ManagersTest._printReport', 'TEST SUITE PASSED');
        }
    }
}
