// apps/frontend/gamejs/src/core/api/types.ts
/**
 * Shared type definitions for all AI/API providers.
 */

export enum VoiceType {
    MALE_OLD = 'male_old',
    MALE_DEFAULT = 'male_default',
    MALE_CHILD = 'male_child',
    FEMALE_OLD = 'female_old',
    FEMALE_DEFAULT = 'female_default',
    FEMALE_CHILD = 'female_child',
}

export enum ProviderCategory {
    TEXT = 'text',
    TEXT_TO_SPEECH = 'text_to_speech',
    SPEECH_TO_TEXT = 'speech_to_text',
    IMAGE = 'image',
}

export enum TextProviderId {
    OPENAI = 'openai',
    OLLAMA = 'ollama',
    GEMINI = 'gemini',
    OPENROUTER = 'openrouter',
}

export enum TtsProviderId {
    ELEVENLABS = 'elevenlabs',
    PIPER = 'piper',
}

/**
 * Common interface for all TTS providers.
 */
export type TtsProvider = {
    setVoiceType(voiceType: VoiceType): void;
    textToSpeech(request: TtsRequest): Promise<TtsResponse>;
    handleTextChunk(chunk: string): void;
    flush?(): void;
    dispose(): void;
};

export enum SttProviderId {
    HUGGINGFACE = 'huggingface',
}

export enum ImageProviderId {
    DALLE = 'dalle',
    HUGGINGFACE = 'huggingface',
}

export type ChatMessage = {
    role: string;
    content: string;
};

export type TextBasicRequest = {
    messages: ChatMessage[];
    useStream?: boolean;
};

export type TextBasicResponse = {
    text?: string;
    error?: string;
};

export interface OpenRouterProviderInterface {
    callBasic(request: TextBasicRequest): Promise<TextBasicResponse>;
    dispose(): void;
}

export type TextFunctionField = {
    name: string;
    type: string;
    description: string;
    required?: boolean;
    enumValues?: string[];
};

export type TextFunctionRequest = {
    name: string;
    description: string;
    messages: ChatMessage[];
    fields: TextFunctionField[];
    useStream?: boolean;
};

export type TextFunctionResponse = {
    data?: Record<string, unknown>;
    error?: string;
};

export type TtsRequest = {
    text: string;
    voiceType?: string;
};

export type TtsResponse = {
    audioData?: ArrayBuffer;
    error?: string;
};

export type ImageRequest = {
    prompt: string;
};

export type ImageResponse = {
    imageData?: ArrayBuffer;
    error?: string;
};

export type SttRequest = {
    audioData: ArrayBuffer;
    mimeType: string;
};

export type SttResponse = {
    text?: string;
    error?: string;
};

export type TextChunkCallback = (chunk: string) => void;
export type AudioChunkCallback = (chunk: ArrayBuffer) => void;
