// apps/frontend/gamejs/src/core/ai/elevenlabs_parsing.ts
/**
 * Pure parsing and data-building utilities for the ElevenLabs provider.
 * No Godot imports — safe for unit testing outside the Godot runtime.
 */

/**
 * Parse a WebSocket message from ElevenLabs.
 * Returns base64-decoded audio data or undefined if no audio.
 */
export const parseElevenLabsWebSocketMessage = (message: string): { audio?: ArrayBuffer; error?: string } => {
    try {
        const parsed = JSON.parse(message) as Record<string, unknown>;
        if (parsed.audio && typeof parsed.audio === 'string') {
            const binaryString = atob(parsed.audio);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            return { audio: bytes.buffer };
        }
        if (parsed.code) {
            return { error: `Error ${parsed.code}: ${parsed.message ?? 'Unknown error'}` };
        }
        return {};
    } catch {
        return { error: 'Failed to parse WebSocket message' };
    }
};

/**
 * Build ElevenLabs request options.
 */
export const buildElevenLabsOptions = (text: string): Record<string, unknown> => {
    return {
        model_id: 'eleven_monolingual_v1',
        text,
        voice_settings: {
            stability: 0.5,
            similarity_boost: 0.8,
            style: 0,
            use_speaker_boost: true,
        },
    };
};
