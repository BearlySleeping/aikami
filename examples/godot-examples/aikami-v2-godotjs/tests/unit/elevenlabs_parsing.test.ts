// apps/frontend/gamejs/tests/unit/elevenlabs_parsing.test.ts
/**
 * Unit tests for ElevenLabs provider parsing logic.
 * Pure functions only — no Godot runtime required.
 */
import { describe, expect, test } from 'bun:test';
import {
    parseElevenLabsWebSocketMessage,
    buildElevenLabsOptions,
} from '../../src/core/ai/elevenlabs_parsing';

describe('ElevenLabs Parsing', () => {
    describe('parseElevenLabsWebSocketMessage', () => {
        test('extracts_audio_from_base64', () => {
            const base64 = btoa('fake audio data');
            const message = JSON.stringify({ audio: base64 });
            const result = parseElevenLabsWebSocketMessage(message);
            expect(result.audio).toBeDefined();
            expect(result.error).toBeUndefined();
        });

        test('returns_empty_for_no_audio', () => {
            const message = JSON.stringify({ isFinal: true });
            const result = parseElevenLabsWebSocketMessage(message);
            expect(result.audio).toBeUndefined();
            expect(result.error).toBeUndefined();
        });

        test('returns_error_for_error_code', () => {
            const message = JSON.stringify({ code: 1008, message: 'Unusual activity detected' });
            const result = parseElevenLabsWebSocketMessage(message);
            expect(result.error).toContain('1008');
            expect(result.error).toContain('Unusual activity detected');
        });

        test('returns_error_for_invalid_json', () => {
            const result = parseElevenLabsWebSocketMessage('not json');
            expect(result.error).toBe('Failed to parse WebSocket message');
        });
    });

    describe('buildElevenLabsOptions', () => {
        test('includes_model_id_and_text', () => {
            const result = buildElevenLabsOptions('Hello world');
            expect(result.model_id).toBe('eleven_monolingual_v1');
            expect(result.text).toBe('Hello world');
        });

        test('includes_voice_settings', () => {
            const result = buildElevenLabsOptions('Test');
            expect(result.voice_settings).toEqual({
                stability: 0.5,
                similarity_boost: 0.8,
                style: 0,
                use_speaker_boost: true,
            });
        });
    });
});
