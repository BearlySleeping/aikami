// apps/frontend/gamejs/tests/unit/openai_parsing.test.ts
/**
 * Unit tests for OpenAI provider parsing logic.
 * Pure functions only — no Godot runtime required.
 */
import { describe, expect, test } from 'bun:test';
import {
    parseOpenAiStreamData,
    buildOpenAiMessages,
    buildOpenAiFunctionTool,
    cleanTextResponse,
} from '../../src/core/ai/openai_parsing';
import type { ChatMessage, TextFunctionRequest } from '../../src/core/ai/types';

describe('OpenAI Parsing', () => {
    describe('parseOpenAiStreamData', () => {
        test('returns_done_for_done_marker', () => {
            const result = parseOpenAiStreamData('[DONE]');
            expect(result.done).toBe(true);
            expect(result.text).toBeUndefined();
        });

        test('extracts_text_content', () => {
            const data = JSON.stringify({
                choices: [{ delta: { content: 'Hello world' } }],
            });
            const result = parseOpenAiStreamData(data);
            expect(result.done).toBe(false);
            expect(result.text).toBe('Hello world');
        });

        test('extracts_function_call', () => {
            const data = JSON.stringify({
                choices: [{ delta: { tool_calls: [{ function: { name: 'test_func', arguments: '{"key": "val"}' } }] } }],
            });
            const result = parseOpenAiStreamData(data);
            expect(result.done).toBe(false);
            expect(result.functionCall?.name).toBe('test_func');
            expect(result.functionCall?.arguments).toBe('{"key": "val"}');
        });

        test('returns_error_for_invalid_json', () => {
            const result = parseOpenAiStreamData('not json');
            expect(result.done).toBe(false);
            expect(result.error).toBeDefined();
        });

        test('returns_error_for_missing_choices', () => {
            const data = JSON.stringify({ id: 'test' });
            const result = parseOpenAiStreamData(data);
            expect(result.error).toBeDefined();
        });

        test('returns_empty_for_empty_delta', () => {
            const data = JSON.stringify({
                choices: [{ delta: {} }],
            });
            const result = parseOpenAiStreamData(data);
            expect(result.done).toBe(false);
            expect(result.text).toBeUndefined();
            expect(result.error).toBeUndefined();
        });
    });

    describe('buildOpenAiMessages', () => {
        test('builds_correct_role_and_content', () => {
            const messages: ChatMessage[] = [
                { role: 'user', content: 'Hello' },
                { role: 'system', content: 'Be helpful' },
                { role: 'assistant', content: 'Hi there' },
            ];
            const result = buildOpenAiMessages(messages);
            expect(result).toEqual([
                { role: 'user', content: 'Hello' },
                { role: 'system', content: 'Be helpful' },
                { role: 'assistant', content: 'Hi there' },
            ]);
        });

        test('returns_empty_array_for_empty_input', () => {
            const result = buildOpenAiMessages([]);
            expect(result).toEqual([]);
        });
    });

    describe('buildOpenAiFunctionTool', () => {
        test('builds_tool_with_required_fields', () => {
            const request: TextFunctionRequest = {
                name: 'get_weather',
                description: 'Get the weather for a location',
                messages: [],
                fields: [
                    { name: 'location', type: 'string', description: 'City name', required: true },
                    { name: 'unit', type: 'string', description: 'Temperature unit', required: false, enumValues: ['celsius', 'fahrenheit'] },
                ],
                useStream: false,
            };
            const result = buildOpenAiFunctionTool(request);
            expect(result.type).toBe('function');
            expect(result.function.name).toBe('get_weather');
            expect(result.function.parameters.required).toEqual(['location']);
            expect(result.function.parameters.properties.location.type).toBe('string');
            expect(result.function.parameters.properties.unit.enum).toEqual(['celsius', 'fahrenheit']);
        });
    });

    describe('cleanTextResponse', () => {
        test('removes_unwanted_characters', () => {
            expect(cleanTextResponse('"Hello {world}"')).toBe('Hello world');
        });

        test('fixes_period_comma', () => {
            expect(cleanTextResponse('Hello., World')).toBe('Hello. World');
        });

        test('trims_whitespace', () => {
            expect(cleanTextResponse('  hello  ')).toBe('hello');
        });
    });
});
