// apps/frontend/gamejs/src/core/api/providers/text/openai_parsing.ts
/**
 * Pure parsing and data-building utilities for the OpenAI provider.
 * No Godot imports — safe for unit testing outside the Godot runtime.
 */
import type { ChatMessage, TextFunctionRequest } from '../../types';

/**
 * Parses a single SSE data line from OpenAI stream responses.
 */
export const parseOpenAiStreamData = (
    data: string,
): { text?: string; functionCall?: { name: string; arguments: string }; done: boolean; error?: string } => {
    const trimmed = data.trim();
    if (trimmed === '[DONE]') {
        return { done: true };
    }

    try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (typeof parsed !== 'object' || parsed === null) {
            return { done: false, error: 'Unexpected response format' };
        }

        const obj = parsed as Record<string, unknown>;
        const choices = obj.choices as Array<Record<string, unknown>> | undefined;
        if (!choices || choices.length === 0) {
            return { done: false, error: "'choices' field not found" };
        }

        const delta = choices[0].delta as Record<string, unknown> | undefined;
        if (!delta || Object.keys(delta).length === 0) {
            return { done: false };
        }

        if ('tool_calls' in delta) {
            const toolCalls = delta.tool_calls as Array<Record<string, unknown>>;
            const func = toolCalls[0]?.function as Record<string, unknown> | undefined;
            if (func) {
                return {
                    done: false,
                    functionCall: {
                        name: (func.name as string) ?? '',
                        arguments: (func.arguments as string) ?? '',
                    },
                };
            }
        }

        if ('content' in delta) {
            const content = delta.content as string | null;
            if (content) {
                return { done: false, text: content };
            }
            return { done: false };
        }

        return { done: false, error: "'content' field not found in delta" };
    } catch {
        return { done: false, error: 'Failed to parse received data' };
    }
};

/**
 * Builds the messages array for OpenAI chat completions.
 */
export const buildOpenAiMessages = (messages: ChatMessage[]): Array<{ role: string; content: string }> => {
    return messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
    }));
};

/**
 * Builds the function tool schema for OpenAI function calling.
 */
export const buildOpenAiFunctionTool = (request: TextFunctionRequest): Record<string, unknown> => {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const field of request.fields) {
        const fieldProps: Record<string, unknown> = {
            type: field.type,
            description: field.description,
        };
        if (field.enumValues && field.enumValues.length > 0) {
            fieldProps.enum = field.enumValues;
        }
        properties[field.name] = fieldProps;
        if (field.required) {
            required.push(field.name);
        }
    }

    return {
        type: 'function',
        function: {
            name: request.name,
            description: request.description,
            parameters: {
                type: 'object',
                properties,
                required,
            },
        },
    };
};

/**
 * Clean up text response by removing unwanted characters.
 */
export const cleanTextResponse = (text: string): string => {
    const unwantedChars = ['"', '{', '}'];
    let result = text.trim();
    for (const char of unwantedChars) {
        result = result.split(char).join('');
    }
    result = result.replace('.,', '.');
    return result;
};

/**
 * Attempt to parse a JSON string as function arguments.
 */
export const tryParseFunctionArgs = (argsString: string): Record<string, unknown> => {
    try {
        return JSON.parse(argsString) as Record<string, unknown>;
    } catch {
        return {};
    }
};

/**
 * Extracts a text response from the raw function arguments string.
 */
export const extractTextResponseFromArgs = (argsString: string): string | undefined => {
    const prefix = '"text_response":"';
    const startIndex = argsString.indexOf(prefix);
    if (startIndex === -1) {
        return undefined;
    }
    const valueStart = startIndex + prefix.length;
    let endIndex = argsString.indexOf('"', valueStart);
    if (endIndex === -1) {
        endIndex = argsString.length;
    }
    return argsString.substring(valueStart, endIndex);
};
