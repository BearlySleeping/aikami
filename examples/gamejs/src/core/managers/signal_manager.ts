// apps/frontend/gamejs/src/core/managers/signal_manager.ts
/**
 * Global event bus for cross-system game communication.
 * Replaces Godot signals for systems that need to communicate
 * without direct node references.
 *
 * Runs with PROCESS_MODE_ALWAYS so signals continue when paused.
 */
import { Node } from 'godot';
import { logger } from '../../utils/logger';

export type TextChunkListener = (text: string) => void;
export type SpeechToTextChunkListener = (text: string) => void;
export type VoiceChunkListener = (audioBytes: ArrayBuffer) => void;
export type ProcessedListener = (delta: number) => void;
export type AddChildListener = (child: Node) => void;

/**
 * Central signal hub for game-wide events.
 * Implemented as a singleton autoload.
 */
export default class SignalManager extends Node {
    private static _instance: SignalManager | null = null;

    private _textChunkListeners: TextChunkListener[] = [];
    private _speechToTextChunkListeners: SpeechToTextChunkListener[] = [];
    private _voiceChunkListeners: VoiceChunkListener[] = [];
    private _processedListeners: ProcessedListener[] = [];
    private _addChildListeners: AddChildListener[] = [];

    static get instance(): SignalManager | null {
        return SignalManager._instance;
    }

    _ready(): void {
        logger.debug('SignalManager._ready');
        SignalManager._instance = this;
        (globalThis as Record<string, unknown>).signalManagerInstance = this;
    }

    _process(delta: number): void {
        this._emitProcessed(delta);
    }

    // --- TEXT STREAM ---

    connectTextChunk(listener: TextChunkListener): void {
        logger.debug('SignalManager.connectTextChunk');
        this._textChunkListeners.push(listener);
    }

    disconnectTextChunk(listener: TextChunkListener): void {
        logger.debug('SignalManager.disconnectTextChunk');
        this._textChunkListeners = this._textChunkListeners.filter((l) => l !== listener);
    }

    emitTextChunk(text: string): void {
        logger.debug('SignalManager.emitTextChunk', text.length);
        for (const listener of this._textChunkListeners) {
            listener(text);
        }
    }

    // --- SPEECH TO TEXT STREAM ---

    connectSpeechToTextChunk(listener: SpeechToTextChunkListener): void {
        logger.debug('SignalManager.connectSpeechToTextChunk');
        this._speechToTextChunkListeners.push(listener);
    }

    disconnectSpeechToTextChunk(listener: SpeechToTextChunkListener): void {
        logger.debug('SignalManager.disconnectSpeechToTextChunk');
        this._speechToTextChunkListeners = this._speechToTextChunkListeners.filter(
            (l) => l !== listener,
        );
    }

    emitSpeechToTextChunk(text: string): void {
        logger.debug('SignalManager.emitSpeechToTextChunk', text.length);
        for (const listener of this._speechToTextChunkListeners) {
            listener(text);
        }
    }

    // --- VOICE STREAM ---

    connectVoiceChunk(listener: VoiceChunkListener): void {
        logger.debug('SignalManager.connectVoiceChunk');
        this._voiceChunkListeners.push(listener);
    }

    disconnectVoiceChunk(listener: VoiceChunkListener): void {
        logger.debug('SignalManager.disconnectVoiceChunk');
        this._voiceChunkListeners = this._voiceChunkListeners.filter((l) => l !== listener);
    }

    emitVoiceChunk(audioBytes: ArrayBuffer): void {
        logger.debug('SignalManager.emitVoiceChunk', audioBytes.byteLength);
        for (const listener of this._voiceChunkListeners) {
            listener(audioBytes);
        }
    }

    // --- PROCESS TICK ---

    connectProcessed(listener: ProcessedListener): void {
        logger.debug('SignalManager.connectProcessed');
        this._processedListeners.push(listener);
    }

    disconnectProcessed(listener: ProcessedListener): void {
        logger.debug('SignalManager.disconnectProcessed');
        this._processedListeners = this._processedListeners.filter((l) => l !== listener);
    }

    private _emitProcessed(delta: number): void {
        for (const listener of this._processedListeners) {
            listener(delta);
        }
    }

    // --- ADD CHILD TO SCENE ---

    connectAddChild(listener: AddChildListener): void {
        logger.debug('SignalManager.connectAddChild');
        this._addChildListeners.push(listener);
    }

    disconnectAddChild(listener: AddChildListener): void {
        logger.debug('SignalManager.disconnectAddChild');
        this._addChildListeners = this._addChildListeners.filter((l) => l !== listener);
    }

    emitAddChild(child: Node): void {
        logger.debug('SignalManager.emitAddChild', 'child node');
        for (const listener of this._addChildListeners) {
            listener(child);
        }
    }

    addChildToScene(child: Node): void {
        this.emitAddChild(child);
    }
}

export { SignalManager };
