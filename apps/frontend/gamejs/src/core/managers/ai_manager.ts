// apps/frontend/gamejs/src/core/managers/ai_manager.ts
/**
 * Singleton AI manager that routes API calls to the appropriate provider.
 * Supports dynamic provider switching per category (text, TTS, STT, image).
 */
import { Node } from 'godot';
import ConfigManager from './config_manager';
import Env from '../env';
import { OpenAiProvider } from '../api/providers/text/openai_provider';
import { OpenRouterProvider } from '../api/providers/text/openrouter_provider';
import { ElevenLabsProvider } from '../api/providers/tts/elevenlabs_provider';
import { PiperTTSProvider } from '../api/providers/tts/piper_tts_provider';
import { GeminiProvider } from '../api/providers/text/gemini_provider';
import { OllamaProvider } from '../api/providers/text/ollama_provider';
import { DalleProvider } from '../api/providers/image/dalle_provider';
import { HuggingFaceProvider } from '../api/providers/image/huggingface_provider';
import { logger } from '../../utils/logger';
import type {
    TextBasicRequest,
    TextBasicResponse,
    TextFunctionRequest,
    TextFunctionResponse,
    TtsRequest,
    TtsResponse,
    ImageRequest,
    ImageResponse,
    SttRequest,
    SttResponse,
    VoiceType,
    TextChunkCallback,
    AudioChunkCallback,
    TtsProvider,
} from '../api/types';
import {
    ProviderCategory,
    TextProviderId,
    TtsProviderId,
    ImageProviderId,
    SttProviderId,
} from '../api/types';

export type AiManagerOptions = {
    parentNode: Node;
    textProvider?: TextProviderId;
    ttsProvider?: TtsProviderId;
    imageProvider?: ImageProviderId;
    sttProvider?: SttProviderId;
    onTextChunk?: TextChunkCallback;
    onAudioChunk?: AudioChunkCallback;
};

type TextProvider = {
    callBasic(request: TextBasicRequest): Promise<TextBasicResponse>;
    callFunction(request: TextFunctionRequest): Promise<TextFunctionResponse>;
    dispose(): void;
};

type ImageProvider = {
    generateImage(request: ImageRequest): Promise<ImageResponse>;
    dispose(): void;
};

type SttProvider = {
    speechToText(request: SttRequest): Promise<SttResponse>;
    dispose(): void;
};

/**
 * Central manager for all AI provider interactions.
 * Implemented as a singleton so any part of the game can access AI capabilities.
 */
export default class AiManager extends Node {
    private static _instance: AiManager | null = null;

    private _parentNode: Node | null = null;
    private _textProvider: TextProvider | null = null;
    private _ttsProvider: TtsProvider | null = null;
    private _imageProvider: ImageProvider | null = null;
    private _sttProvider: SttProvider | null = null;
    private _onTextChunk?: TextChunkCallback;
    private _onAudioChunk?: AudioChunkCallback;

    static get instance(): AiManager | null {
        return AiManager._instance;
    }

    _ready(): void {
        logger.debug('AiManager._ready');
        AiManager._instance = this;
        (globalThis as Record<string, unknown>).aiManagerInstance = this;
    }

    /**
     * Initialize the manager with a parent node and optional provider selections.
     */
    initialize(options: AiManagerOptions): void {
        logger.debug('AiManager.initialize', {
            textProvider: options.textProvider,
            ttsProvider: options.ttsProvider,
            imageProvider: options.imageProvider,
            sttProvider: options.sttProvider,
        });

        this._parentNode = options.parentNode;
        this._onTextChunk = options.onTextChunk;
        this._onAudioChunk = options.onAudioChunk;

        this._setTextProvider(options.textProvider ?? TextProviderId.OPENAI);
        this._setTtsProvider(options.ttsProvider ?? TtsProviderId.ELEVENLABS);
        this._setImageProvider(options.imageProvider ?? ImageProviderId.DALLE);
        this._setSttProvider(options.sttProvider ?? SttProviderId.HUGGINGFACE);
    }

    /**
     * Change the active text provider at runtime.
     */
    setTextProvider(providerId: TextProviderId): void {
        logger.info('AiManager.setTextProvider', providerId);
        this._textProvider?.dispose();
        this._setTextProvider(providerId);
    }

    /**
     * Change the active TTS provider at runtime.
     */
    setTtsProvider(providerId: TtsProviderId): void {
        logger.info('AiManager.setTtsProvider', providerId);
        this._ttsProvider?.dispose();
        this._setTtsProvider(providerId);
    }

    /**
     * Change the active image provider at runtime.
     */
    setImageProvider(providerId: ImageProviderId): void {
        logger.info('AiManager.setImageProvider', providerId);
        this._imageProvider?.dispose();
        this._setImageProvider(providerId);
    }

    /**
     * Change the active STT provider at runtime.
     */
    setSttProvider(providerId: SttProviderId): void {
        logger.info('AiManager.setSttProvider', providerId);
        this._sttProvider?.dispose();
        this._setSttProvider(providerId);
    }

    // --- TEXT API ---

    async callTextBasic(request: TextBasicRequest): Promise<TextBasicResponse> {
        logger.debug('AiManager.callTextBasic', { useStream: request.useStream });
        const provider = this._textProvider;

        if (!provider) {
            return { text: '', error: 'No text provider initialized' };
        }

        return provider.callBasic(request);
    }

    /**
     * Generate a structured function-call response.
     */
    async callTextFunction(request: TextFunctionRequest): Promise<TextFunctionResponse> {
        logger.debug('AiManager.callTextFunction', { name: request.name, useStream: request.useStream });
        const provider = this._requireProvider(ProviderCategory.TEXT, this._textProvider);
        return provider.callFunction(request);
    }

    // --- TTS API ---

    /**
     * Set the voice type for the active TTS provider.
     */
    setVoiceType(voiceType: VoiceType): void {
        logger.debug('AiManager.setVoiceType', voiceType);
        this._ttsProvider?.setVoiceType(voiceType);
    }

    /**
     * Send a text chunk for real-time streaming TTS.
     * Pass empty string to initialize or close the connection.
     */
    generateVoiceWithTextChunk(chunk: string): void {
        logger.debug('AiManager.generateVoiceWithTextChunk', chunk);
        this._ttsProvider?.handleTextChunk(chunk);
    }

    /**
     * Convert text to speech.
     */
    async textToSpeech(request: TtsRequest): Promise<TtsResponse> {
        logger.debug('AiManager.textToSpeech', { text: request.text });
        const provider = this._requireProvider(ProviderCategory.TEXT_TO_SPEECH, this._ttsProvider);
        return provider.textToSpeech(request);
    }

    /**
     * Stream text generation and pipe each chunk directly into the TTS provider
     * for real-time voice synthesis. Sentence boundaries trigger synthesis
     * immediately so audio starts playing before the full response is received.
     */
    async streamTextToSpeech(request: TextBasicRequest): Promise<TextBasicResponse> {
        logger.debug('AiManager.streamTextToSpeech', { useStream: request.useStream });
        const textProvider = this._textProvider;
        const ttsProvider = this._ttsProvider;

        if (!textProvider) {
            return { text: '', error: 'No text provider initialized' };
        }
        if (!ttsProvider) {
            return { text: '', error: 'No TTS provider initialized' };
        }

        const response = await textProvider.callBasic(request);

        // Signal end-of-stream to the TTS provider (flushes buffered text for Piper,
        // closes WebSocket for ElevenLabs)
        this.generateVoiceWithTextChunk('');

        return response;
    }

    // --- IMAGE API ---

    /**
     * Generate an image from a prompt.
     */
    async generateImage(request: ImageRequest): Promise<ImageResponse> {
        logger.debug('AiManager.generateImage', { prompt: request.prompt });
        const provider = this._requireProvider(ProviderCategory.IMAGE, this._imageProvider);
        return provider.generateImage(request);
    }

    // --- STT API ---

    /**
     * Transcribe audio to text.
     */
    async speechToText(request: SttRequest): Promise<SttResponse> {
        logger.debug('AiManager.speechToText', { mimeType: request.mimeType });
        const provider = this._requireProvider(ProviderCategory.SPEECH_TO_TEXT, this._sttProvider);
        return provider.speechToText(request);
    }

    /**
     * Dispose all providers and clean up.
     */
    dispose(): void {
        logger.info('AiManager.dispose', 'Cleaning up all providers');
        this._textProvider?.dispose();
        this._ttsProvider?.dispose();
        this._imageProvider?.dispose();
        this._sttProvider?.dispose();
        this._textProvider = null;
        this._ttsProvider = null;
        this._imageProvider = null;
        this._sttProvider = null;
        this._parentNode = null;
    }

    private _setTextProvider(providerId: TextProviderId): void {
        if (!this._parentNode) {
            logger.warn('AiManager._setTextProvider', 'No parent node set');
            return;
        }
        const config = ConfigManager.instance;
        const apiKey = (config?.get_value(ConfigManager.ConfigKey.API_OPENAI_KEY) as string) ?? 'sk-dummy-openai-key';
        const openrouterKey = (config?.get_value(ConfigManager.ConfigKey.API_OPENROUTER_KEY) as string) ?? 'dummy-openrouter-key';
        const geminiKey = (config?.get_value(ConfigManager.ConfigKey.API_GEMINI_KEY) as string) ?? 'dummy-gemini-key';
        const ollamaUrl = (config?.get_value(ConfigManager.ConfigKey.API_OLLAMA_URL) as string) ?? 'http://localhost:11434';

        switch (providerId) {
            case TextProviderId.OPENAI:
                this._textProvider = new OpenAiProvider({
                    apiKey,
                    parentNode: this._parentNode,
                    onTextChunk: this._onTextChunk,
                });
                break;
            case TextProviderId.OPENROUTER:
                this._textProvider = new OpenRouterProvider({
                    apiKey: openrouterKey,
                    parentNode: this._parentNode,
                    onTextChunk: this._onTextChunk,
                });
                break;
            case TextProviderId.GEMINI:
                this._textProvider = new GeminiProvider({
                    apiKey: geminiKey,
                    onTextChunk: this._onTextChunk,
                });
                break;
            case TextProviderId.OLLAMA:
                this._textProvider = new OllamaProvider({
                    baseUrl: ollamaUrl,
                    onTextChunk: this._onTextChunk,
                });
                break;
            default:
                logger.warn('AiManager._setTextProvider', `Provider ${providerId} not yet implemented, falling back to OpenAI`);
                this._textProvider = new OpenAiProvider({
                    apiKey,
                    parentNode: this._parentNode,
                    onTextChunk: this._onTextChunk,
                });
        }
    }

    private _setTtsProvider(providerId: TtsProviderId): void {
        if (!this._parentNode) {
            logger.warn('AiManager._setTtsProvider', 'No parent node set');
            return;
        }
        const config = ConfigManager.instance;
        const apiKey = (config?.get_value(ConfigManager.ConfigKey.API_ELEVENLABS_KEY) as string) ?? 'dummy-elevenlabs-key';
        const piperUrl = (config?.get_value(ConfigManager.ConfigKey.API_PIPER_URL) as string)
            ?? Env.instance?.piper_base_url
            ?? 'http://localhost:5002';

        switch (providerId) {
            case TtsProviderId.ELEVENLABS:
                this._ttsProvider = new ElevenLabsProvider({
                    apiKey,
                    parentNode: this._parentNode,
                    onAudioChunk: this._onAudioChunk,
                });
                break;
            case TtsProviderId.PIPER:
                this._ttsProvider = new PiperTTSProvider({
                    baseUrl: piperUrl,
                    parentNode: this._parentNode,
                    onAudioChunk: this._onAudioChunk,
                });
                break;
            default:
                logger.warn('AiManager._setTtsProvider', `Provider ${providerId} not yet implemented, falling back to ElevenLabs`);
                this._ttsProvider = new ElevenLabsProvider({
                    apiKey,
                    parentNode: this._parentNode,
                    onAudioChunk: this._onAudioChunk,
                });
        }
    }

    private _setImageProvider(providerId: ImageProviderId): void {
        const config = ConfigManager.instance;
        const openaiKey = (config?.get_value(ConfigManager.ConfigKey.API_OPENAI_KEY) as string) ?? 'sk-dummy-openai-key';
        const huggingfaceKey = (config?.get_value(ConfigManager.ConfigKey.API_HUGGINGFACE_KEY) as string) ?? 'dummy-huggingface-key';

        switch (providerId) {
            case ImageProviderId.DALLE:
                this._imageProvider = new DalleProvider({ apiKey: openaiKey });
                break;
            case ImageProviderId.HUGGINGFACE:
                this._imageProvider = new HuggingFaceProvider({ apiKey: huggingfaceKey });
                break;
            default:
                logger.warn('AiManager._setImageProvider', `Provider ${providerId} not yet implemented, falling back to DALLE`);
                this._imageProvider = new DalleProvider({ apiKey: openaiKey });
        }
    }

    private _setSttProvider(providerId: SttProviderId): void {
        const config = ConfigManager.instance;
        const huggingfaceKey = (config?.get_value(ConfigManager.ConfigKey.API_HUGGINGFACE_KEY) as string) ?? 'dummy-huggingface-key';

        switch (providerId) {
            case SttProviderId.HUGGINGFACE:
                this._sttProvider = new HuggingFaceProvider({ apiKey: huggingfaceKey });
                break;
            default:
                logger.warn('AiManager._setSttProvider', `Provider ${providerId} not yet implemented, falling back to HuggingFace`);
                this._sttProvider = new HuggingFaceProvider({ apiKey: huggingfaceKey });
        }
    }

    private _requireProvider<T>(category: ProviderCategory, provider: T | null): T {
        if (!provider) {
            throw new Error(`AI provider not initialized for category: ${category}`);
        }
        return provider;
    }
}
