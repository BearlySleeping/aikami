// packages/frontend/ai-gateway/src/lib/text_adapter_service.ts
//
// `service`-mode text adapters. The real adapter wraps the Aikami-hosted
// callable endpoint (Firebase `ai` function today); the stub adapter is a
// deterministic in-memory implementation for tests and pre-activation
// wiring. No billing/metering — that is a Phase 5 contract.
// Contract: C-320 AC-4

import type { AiChatMessage } from '@aikami/types';
import { createAiGatewayError, toAiGatewayError } from './errors.ts';
import type { AiTextAdapter, AiTextGenerationResult } from './gateway_types.ts';

/** Shape of the hosted AI callable (matches the Firebase `ai` function). */
export type ServiceTextCallable = (data: {
  type: string;
  payload: Record<string, unknown>;
}) => Promise<Record<string, unknown>>;

/** Returns the content of the last user message, or ''. */
const lastUserContent = (messages: AiChatMessage[]): string => {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      return messages[i].content;
    }
  }
  return '';
};

/**
 * Creates the `service`-mode text adapter over the hosted callable.
 *
 * Request mapping (preserves legacy `ai_service` behavior):
 * - schema/schemaName present → `createPersona` callable; the parsed persona
 *   is returned as `structured`.
 * - otherwise → `sendMessage` callable with an empty context (legacy calls
 *   always sent an empty history).
 */
export const createServiceTextAdapter = (options: { call: ServiceTextCallable }): AiTextAdapter => {
  const { call } = options;

  return {
    provider: 'aikami_service',
    async generateText(request): Promise<AiTextGenerationResult> {
      const { resolution, signal, messages, schemaName, onChunk } = request;

      if (signal.aborted) {
        throw createAiGatewayError({
          code: 'cancelled',
          capability: 'text',
          mode: resolution.mode,
          provider: resolution.provider,
          message: 'Aborted',
        });
      }

      try {
        if (schemaName) {
          const response = await call({
            type: 'createPersona',
            payload: { prompt: lastUserContent(messages) },
          });
          return { text: '', structured: response.persona };
        }

        const response = await call({
          type: 'sendMessage',
          payload: {
            text: lastUserContent(messages),
            context: { messages: [] },
          },
        });
        const text = typeof response.text === 'string' ? response.text : '';
        if (text.length > 0) {
          onChunk?.(text);
        }
        return { text };
      } catch (error) {
        throw toAiGatewayError({
          error,
          capability: 'text',
          mode: resolution.mode,
          provider: resolution.provider,
        });
      }
    },
  };
};

/** Options for the deterministic service stub. */
export type ServiceStubTextAdapterOptions = {
  /** Chunks emitted in order via onChunk. */
  chunks?: string[];
  /** Structured object returned when a schema is requested. */
  structured?: unknown;
  /** When set, every call fails with this normalized code. */
  failWith?: 'provider_unreachable' | 'rate_limited' | 'timeout' | 'invalid_response';
};

/**
 * Deterministic `service`-mode stub adapter. Emits fixed chunks in order,
 * honors AbortSignal, and fails with typed gateway errors on demand — used
 * by the shared adapter-contract test suite.
 */
export const createServiceStubTextAdapter = (
  options?: ServiceStubTextAdapterOptions,
): AiTextAdapter => {
  const { chunks = ['Hello', ' from', ' the', ' stub'], structured, failWith } = options ?? {};

  return {
    provider: 'aikami_service_stub',
    async generateText(request): Promise<AiTextGenerationResult> {
      const { resolution, signal, schema, onChunk } = request;

      if (signal.aborted) {
        throw createAiGatewayError({
          code: 'cancelled',
          capability: 'text',
          mode: resolution.mode,
          provider: resolution.provider,
          message: 'Aborted',
        });
      }

      if (failWith) {
        throw createAiGatewayError({
          code: failWith,
          capability: 'text',
          mode: resolution.mode,
          provider: resolution.provider,
          message: `Stub failure: ${failWith}`,
        });
      }

      let accumulated = '';
      for (const chunk of chunks) {
        // Yield between chunks so cancellation can interleave deterministically.
        await Promise.resolve();
        if (signal.aborted) {
          throw createAiGatewayError({
            code: 'cancelled',
            capability: 'text',
            mode: resolution.mode,
            provider: resolution.provider,
            message: 'Aborted',
          });
        }
        accumulated += chunk;
        onChunk?.(chunk);
      }

      if (schema) {
        return { text: accumulated, structured: structured ?? {} };
      }
      return { text: accumulated };
    },
  };
};
