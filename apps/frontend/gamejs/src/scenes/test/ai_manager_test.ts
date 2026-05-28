// apps/frontend/gamejs/src/scenes/test/ai_manager_test.ts
/**
 * Headless test scene for the AI manager and providers.
 * Runs inside Godot and exercises all Godot-dependent code paths.
 *
 * Run with:
 *   bun run dev:emulator --scene src/scenes/test/ai_manager_test.tscn --headless
 */
import { Node } from 'godot';
import AiManager from '../../core/managers/ai_manager';
import { logger } from '../../utils/logger';
import {
    VoiceType,
    TextProviderId,
    TtsProviderId,
    ImageProviderId,
    SttProviderId,
} from '../../core/api/types';

type TestResult = {
    name: string;
    passed: boolean;
    error?: string;
};

export default class AiManagerTest extends Node {
    private _results: TestResult[] = [];
    private _streamChunks: string[] = [];
    private _audioChunks: ArrayBuffer[] = [];

    _ready(): void {
        logger.debug('AiManagerTest._ready');
        this.runTests().then(() => {
            this._printReport();
            this.get_tree()?.quit();
        }).catch((error) => {
            logger.error('AiManagerTest._ready error', error);
            this.get_tree()?.quit();
        });
    }

    private async runTests(): Promise<void> {
        await this._testSingletonPattern();
        await this._testInitialization();
        await this._testProviderSwitching();
        await this._testVoiceTypeSetting();
        await this._testTextChunkBuffering();
        await this._testStubProviders();
        await this._testDisposeAndReinitialize();
    }

    private _getManager(): AiManager | null {
        return (
            AiManager.instance ??
            ((globalThis as Record<string, unknown>).aiManagerInstance as AiManager | null)
        );
    }

    private async _testSingletonPattern(): Promise<void> {
        const testName = 'singleton_pattern';
        try {
            const instance1 = this._getManager();
            const instance2 = this._getManager();
            if (instance1 !== instance2) {
                throw new Error('AiManager is not a singleton');
            }
            this._pass(testName);
        } catch (error) {
            this._fail(testName, error);
        }
    }

    private async _testInitialization(): Promise<void> {
        const testName = 'initialization';
        try {
            const manager = this._getManager();
            if (!manager) {
                throw new Error('AiManager instance is null');
            }
            manager.initialize({
                parentNode: this,
                textProvider: TextProviderId.OPENAI,
                ttsProvider: TtsProviderId.ELEVENLABS,
                onTextChunk: (chunk: string): void => {
                    this._streamChunks.push(chunk);
                },
                onAudioChunk: (chunk: ArrayBuffer): void => {
                    this._audioChunks.push(chunk);
                },
            });
            this._pass(testName);
        } catch (error) {
            this._fail(testName, error);
        }
    }

    private async _testProviderSwitching(): Promise<void> {
        const testName = 'provider_switching';
        try {
            const manager = this._getManager();
            if (!manager) {
                throw new Error('AiManager instance is null');
            }
            manager.setTextProvider(TextProviderId.OPENAI);
            manager.setTtsProvider(TtsProviderId.ELEVENLABS);
            this._pass(testName);
        } catch (error) {
            this._fail(testName, error);
        }
    }

    private async _testVoiceTypeSetting(): Promise<void> {
        const testName = 'voice_type_setting';
        try {
            const manager = this._getManager();
            if (!manager) {
                throw new Error('AiManager instance is null');
            }
            manager.setVoiceType(VoiceType.FEMALE_DEFAULT);
            manager.setVoiceType(VoiceType.MALE_CHILD);
            this._pass(testName);
        } catch (error) {
            this._fail(testName, error);
        }
    }

    private async _testTextChunkBuffering(): Promise<void> {
        const testName = 'text_chunk_buffering';
        try {
            const manager = this._getManager();
            if (!manager) {
                throw new Error('AiManager instance is null');
            }
            manager.generateVoiceWithTextChunk('Hello');
            manager.generateVoiceWithTextChunk(' world');
            manager.generateVoiceWithTextChunk('');
            this._pass(testName);
        } catch (error) {
            this._fail(testName, error);
        }
    }

    private async _testStubProviders(): Promise<void> {
        const testName = 'stub_providers';
        try {
            const manager = this._getManager();
            if (!manager) {
                throw new Error('AiManager instance is null');
            }
            manager.setTextProvider(TextProviderId.GEMINI);
            manager.setTextProvider(TextProviderId.OLLAMA);
            manager.setTextProvider(TextProviderId.OPENAI);
            manager.setImageProvider(ImageProviderId.DALLE);
            manager.setImageProvider(ImageProviderId.HUGGINGFACE);
            manager.setSttProvider(SttProviderId.HUGGINGFACE);

            const imageResult = await manager.generateImage({ prompt: 'test' });
            if (!imageResult.error) {
                throw new Error('Expected stub image provider to return error');
            }

            const sttResult = await manager.speechToText({ audioData: new ArrayBuffer(0), mimeType: 'audio/wav' });
            if (!sttResult.error) {
                throw new Error('Expected stub STT provider to return error');
            }

            this._pass(testName);
        } catch (error) {
            this._fail(testName, error);
        }
    }

    private async _testDisposeAndReinitialize(): Promise<void> {
        const testName = 'dispose_and_reinitialize';
        try {
            const manager = this._getManager();
            if (!manager) {
                throw new Error('AiManager instance is null');
            }
            manager.dispose();
            manager.initialize({ parentNode: this });
            this._pass(testName);
        } catch (error) {
            this._fail(testName, error);
        }
    }

    private _pass(name: string): void {
        this._results.push({ name, passed: true });
        logger.info('AiManagerTest', `PASS: ${name}`);
    }

    private _fail(name: string, error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        this._results.push({ name, passed: false, error: message });
        logger.error('AiManagerTest', `FAIL: ${name} — ${message}`);
    }

    private _printReport(): void {
        const passed = this._results.filter((r) => r.passed).length;
        const failed = this._results.filter((r) => !r.passed).length;

        logger.info('AiManagerTest._printReport', '========================================');
        logger.info('AiManagerTest._printReport', `Tests: ${this._results.length}`);
        logger.info('AiManagerTest._printReport', `Passed: ${passed}`);
        logger.info('AiManagerTest._printReport', `Failed: ${failed}`);
        logger.info('AiManagerTest._printReport', '========================================');

        for (const result of this._results) {
            const status = result.passed ? 'PASS' : 'FAIL';
            logger.info('AiManagerTest._printReport', `${status}: ${result.name}`);
            if (result.error) {
                logger.error('AiManagerTest._printReport', `  Error: ${result.error}`);
            }
        }

        if (failed > 0) {
            logger.error('AiManagerTest._printReport', `TEST SUITE FAILED (${failed} failures)`);
        } else {
            logger.info('AiManagerTest._printReport', 'TEST SUITE PASSED');
        }
    }
}
