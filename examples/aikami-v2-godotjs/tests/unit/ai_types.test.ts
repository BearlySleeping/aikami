// apps/frontend/gamejs/tests/unit/ai_types.test.ts
/**
 * Unit tests for AI type utilities and pure functions.
 * These do NOT import from 'godot' and can run with bun test.
 */
import { describe, expect, test } from 'bun:test';
import {
    VoiceType,
    ProviderCategory,
    TextProviderId,
    TtsProviderId,
    ImageProviderId,
    SttProviderId,
} from '../../src/core/ai/types';

describe('AI Types', () => {
    describe('VoiceType enum', () => {
        test('has_expected_values', () => {
            expect(VoiceType.MALE_OLD).toBe('male_old');
            expect(VoiceType.MALE_DEFAULT).toBe('male_default');
            expect(VoiceType.MALE_CHILD).toBe('male_child');
            expect(VoiceType.FEMALE_OLD).toBe('female_old');
            expect(VoiceType.FEMALE_DEFAULT).toBe('female_default');
            expect(VoiceType.FEMALE_CHILD).toBe('female_child');
        });
    });

    describe('ProviderCategory enum', () => {
        test('has_expected_values', () => {
            expect(ProviderCategory.TEXT).toBe('text');
            expect(ProviderCategory.TEXT_TO_SPEECH).toBe('text_to_speech');
            expect(ProviderCategory.SPEECH_TO_TEXT).toBe('speech_to_text');
            expect(ProviderCategory.IMAGE).toBe('image');
        });
    });

    describe('TextProviderId enum', () => {
        test('has_expected_values', () => {
            expect(TextProviderId.OPENAI).toBe('openai');
            expect(TextProviderId.OLLAMA).toBe('ollama');
            expect(TextProviderId.GEMINI).toBe('gemini');
            expect(TextProviderId.OPENROUTER).toBe('openrouter');
        });
    });

    describe('TtsProviderId enum', () => {
        test('has_expected_values', () => {
            expect(TtsProviderId.ELEVENLABS).toBe('elevenlabs');
        });
    });

    describe('ImageProviderId enum', () => {
        test('has_expected_values', () => {
            expect(ImageProviderId.DALLE).toBe('dalle');
            expect(ImageProviderId.HUGGINGFACE).toBe('huggingface');
        });
    });

    describe('SttProviderId enum', () => {
        test('has_expected_values', () => {
            expect(SttProviderId.HUGGINGFACE).toBe('huggingface');
        });
    });
});
