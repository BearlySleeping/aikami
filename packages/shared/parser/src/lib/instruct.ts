// packages/shared/parser/src/lib/instruct.ts
//
// Instruct template formatters that convert a standard Aikami Message[]
// array into correctly formatted strings for each template dialect.
// Templates: ChatML, Alpaca, Vicuna, Llama3, Mistral, DeepSeek.

import type { AIChatMessage } from '@aikami/types';
import { logger } from '$logger';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Joins an array of messages into a single concatenated string,
 * separated by newlines. Skips messages with empty content.
 *
 * @param messages - The messages to join.
 * @returns A single string of all message contents.
 */
const _joinMessages = (messages: AIChatMessage[]): string => {
  return messages
    .map((m) => m.content)
    .filter(Boolean)
    .join('\n');
};

// ---------------------------------------------------------------------------
// Template: ChatML
// ---------------------------------------------------------------------------

/**
 * Formats messages using the ChatML template.
 *
 * @example
 * ```
 * <|im_start|>system
 * You are a helpful assistant.<|im_end|>
 * <|im_start|>user
 * Hello!<|im_end|>
 * <|im_start|>assistant
 * Hi there!<|im_end|>
 * ```
 *
 * @param messages - Array of chat messages.
 * @returns Formatted ChatML string.
 */
export const formatChatML = (messages: AIChatMessage[]): string => {
  logger.debug('formatChatML', { count: messages.length });

  return messages
    .filter((m) => m.content.length > 0)
    .map((m) => `<|im_start|>${m.role}\n${m.content}<|im_end|>`)
    .join('\n');
};

// ---------------------------------------------------------------------------
// Template: Alpaca
// ---------------------------------------------------------------------------

/**
 * Formats messages using the Alpaca instruct template.
 *
 * System messages become the top-level instruction.
 * User/assistant turns are prefixed with `### Instruction:` and
 * `### Response:` respectively.
 *
 * @example
 * ```
 * ### Instruction:
 * You are a helpful assistant.
 *
 * ### Instruction:
 * Hello!
 *
 * ### Response:
 * Hi there!
 * ```
 *
 * @param messages - Array of chat messages.
 * @returns Formatted Alpaca string.
 */
export const formatAlpaca = (messages: AIChatMessage[]): string => {
  logger.debug('formatAlpaca', { count: messages.length });

  const parts: string[] = [];

  for (const msg of messages) {
    if (msg.content.length === 0) {
      continue;
    }
    if (msg.role === 'system') {
      parts.push(`### Instruction:\n${msg.content}`);
    } else if (msg.role === 'user') {
      parts.push(`### Instruction:\n${msg.content}`);
    } else if (msg.role === 'assistant') {
      parts.push(`### Response:\n${msg.content}`);
    }
  }

  return parts.join('\n\n');
};

// ---------------------------------------------------------------------------
// Template: Vicuna
// ---------------------------------------------------------------------------

/**
 * Formats messages using the Vicuna template.
 *
 * System prompt is prepended as a block.
 * User turns use `USER:` prefix, assistant turns use `ASSISTANT:` prefix.
 *
 * @example
 * ```
 * You are a helpful assistant.
 *
 * USER: Hello!
 * ASSISTANT: Hi there!
 * ```
 *
 * @param messages - Array of chat messages.
 * @returns Formatted Vicuna string.
 */
export const formatVicuna = (messages: AIChatMessage[]): string => {
  logger.debug('formatVicuna', { count: messages.length });

  const parts: string[] = [];

  for (const msg of messages) {
    if (msg.content.length === 0) {
      continue;
    }
    if (msg.role === 'system') {
      parts.push(msg.content);
    } else if (msg.role === 'user') {
      parts.push(`USER: ${msg.content}`);
    } else if (msg.role === 'assistant') {
      parts.push(`ASSISTANT: ${msg.content}`);
    }
  }

  return parts.join('\n');
};

// ---------------------------------------------------------------------------
// Template: Llama 3
// ---------------------------------------------------------------------------

/**
 * Formats messages using the Llama 3 instruct template.
 *
 * Uses the `<|begin_of_text|>` opening token followed by
 * `<|start_header_id|>role<|end_header_id|>` header blocks
 * and `<|eot_id|>` end-of-turn tokens.
 *
 * @example
 * ```
 * <|begin_of_text|><|start_header_id|>system<|end_header_id|>
 * You are a helpful assistant.<|eot_id|><|start_header_id|>user<|end_header_id|>
 * Hello!<|eot_id|><|start_header_id|>assistant<|end_header_id|>
 * Hi there!<|eot_id|>
 * ```
 *
 * @param messages - Array of chat messages.
 * @returns Formatted Llama 3 string.
 */
export const formatLlama3 = (messages: AIChatMessage[]): string => {
  logger.debug('formatLlama3', { count: messages.length });

  const body = messages
    .filter((m) => m.content.length > 0)
    .map((m) => `<|start_header_id|>${m.role}<|end_header_id|>\n${m.content}<|eot_id|>`)
    .join('');

  return `<|begin_of_text|>${body}`;
};

// ---------------------------------------------------------------------------
// Template: Mistral
// ---------------------------------------------------------------------------

/**
 * Formats messages using the Mistral instruct template.
 *
 * System message is prepended as plain text.
 * User/assistant turns are wrapped in `[INST]` / `[/INST]` blocks,
 * with assistant responses following outside the block.
 *
 * @example
 * ```
 * You are a helpful assistant.
 *
 * [INST] Hello! [/INST] Hi there!
 * ```
 *
 * @param messages - Array of chat messages.
 * @returns Formatted Mistral string.
 */
export const formatMistral = (messages: AIChatMessage[]): string => {
  logger.debug('formatMistral', { count: messages.length });

  const parts: string[] = [];
  let pendingInstruction: string | undefined;

  for (const msg of messages) {
    if (msg.content.length === 0) {
      continue;
    }
    if (msg.role === 'system') {
      parts.push(msg.content);
    } else if (msg.role === 'user') {
      if (pendingInstruction) {
        // Flush previous instruction without a response.
        parts.push(`[INST] ${pendingInstruction} [/INST]`);
      }
      pendingInstruction = msg.content;
    } else if (msg.role === 'assistant') {
      if (pendingInstruction) {
        parts.push(`[INST] ${pendingInstruction} [/INST] ${msg.content}`);
        pendingInstruction = undefined;
      } else {
        parts.push(msg.content);
      }
    }
  }

  // Flush any remaining unpaired instruction.
  if (pendingInstruction) {
    parts.push(`[INST] ${pendingInstruction} [/INST]`);
  }

  return parts.join('\n\n');
};

// ---------------------------------------------------------------------------
// Template: DeepSeek
// ---------------------------------------------------------------------------

/**
 * Formats messages using the DeepSeek instruct template.
 *
 * DeepSeek uses a ChatML-compatible format with additional
 * `###` markers for separation.
 *
 * @example
 * ```
 * ### System:
 * You are a helpful assistant.
 *
 * ### User:
 * Hello!
 *
 * ### Assistant:
 * Hi there!
 * ```
 *
 * @param messages - Array of chat messages.
 * @returns Formatted DeepSeek string.
 */
export const formatDeepSeek = (messages: AIChatMessage[]): string => {
  logger.debug('formatDeepSeek', { count: messages.length });

  const parts: string[] = [];

  for (const msg of messages) {
    if (msg.content.length === 0) {
      continue;
    }
    const label = msg.role === 'system' ? 'System' : msg.role === 'user' ? 'User' : 'Assistant';
    parts.push(`### ${label}:\n${msg.content}`);
  }

  return parts.join('\n\n');
};

// ---------------------------------------------------------------------------
// Template dictionary
// ---------------------------------------------------------------------------

/**
 * Map of instruct template names to their formatter functions.
 */
export const INSTRUCT_FORMATTERS = {
  alpaca: formatAlpaca,
  chatml: formatChatML,
  deepseek: formatDeepSeek,
  llama3: formatLlama3,
  mistral: formatMistral,
  vicuna: formatVicuna,
} as const;

/** Union of known instruct template names. */
export type InstructTemplateName = keyof typeof INSTRUCT_FORMATTERS;

/**
 * Formats an array of AIChatMessage using the specified instruct template.
 *
 * @param options.template - The template name (e.g. 'chatml', 'alpaca').
 * @param options.messages - The messages to format.
 * @returns The formatted string for the selected template.
 */
export const formatInstruct = (options: {
  messages: AIChatMessage[];
  template: InstructTemplateName;
}): string => {
  const formatter = INSTRUCT_FORMATTERS[options.template];
  return formatter(options.messages);
};
