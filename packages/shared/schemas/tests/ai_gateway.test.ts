// packages/shared/schemas/tests/ai_gateway.test.ts
//
// AC-1 (C-320): AI Gateway contract schemas accept valid payloads and
// reject invalid ones via schemaCheck.

import { describe, expect, test } from 'bun:test';
import {
  AiCapabilitySchema,
  AiChatMessageSchema,
  AiDetectionResultSchema,
  AiGatewayCapabilityConfigSchema,
  AiGatewayErrorCodeSchema,
  AiGatewayErrorSchema,
  AiGatewayModeConfigSchema,
  AiModeResolutionSchema,
  AiModeSchema,
  schemaCheck,
} from '../src/index.ts';

describe('AiModeSchema', () => {
  test('accepts the three modes', () => {
    for (const mode of ['offline', 'byok', 'service']) {
      expect(schemaCheck(AiModeSchema, mode)).toBe(true);
    }
  });

  test('rejects unknown modes', () => {
    expect(schemaCheck(AiModeSchema, 'cloud')).toBe(false);
    expect(schemaCheck(AiModeSchema, '')).toBe(false);
    expect(schemaCheck(AiModeSchema, 42)).toBe(false);
  });
});

describe('AiCapabilitySchema', () => {
  test('accepts the three capabilities', () => {
    for (const capability of ['text', 'image', 'voice']) {
      expect(schemaCheck(AiCapabilitySchema, capability)).toBe(true);
    }
  });

  test('rejects unknown capabilities', () => {
    expect(schemaCheck(AiCapabilitySchema, 'video')).toBe(false);
    expect(schemaCheck(AiCapabilitySchema, undefined)).toBe(false);
  });
});

describe('AiGatewayErrorCodeSchema', () => {
  test('accepts every normalized error code', () => {
    const codes = [
      'provider_unreachable',
      'not_configured',
      'auth_failed',
      'rate_limited',
      'cancelled',
      'timeout',
      'invalid_response',
      'mode_unavailable',
    ];
    for (const code of codes) {
      expect(schemaCheck(AiGatewayErrorCodeSchema, code)).toBe(true);
    }
  });

  test('rejects unknown codes', () => {
    expect(schemaCheck(AiGatewayErrorCodeSchema, 'unknown_error')).toBe(false);
  });
});

describe('AiGatewayErrorSchema', () => {
  test('accepts a fully-populated error', () => {
    const error = {
      code: 'provider_unreachable',
      capability: 'text',
      mode: 'offline',
      provider: 'ollama',
      message: 'Connection refused',
      retryable: true,
    };
    expect(schemaCheck(AiGatewayErrorSchema, error)).toBe(true);
  });

  test('accepts an error without optional provider', () => {
    const error = {
      code: 'mode_unavailable',
      capability: 'voice',
      mode: 'service',
      message: 'Service mode is not activated',
      retryable: false,
    };
    expect(schemaCheck(AiGatewayErrorSchema, error)).toBe(true);
  });

  test('rejects an error missing required fields', () => {
    expect(schemaCheck(AiGatewayErrorSchema, { code: 'timeout' })).toBe(false);
    expect(
      schemaCheck(AiGatewayErrorSchema, {
        code: 'bogus',
        capability: 'text',
        mode: 'offline',
        message: 'x',
        retryable: false,
      }),
    ).toBe(false);
  });
});

describe('AiModeResolutionSchema', () => {
  test('accepts a full resolution', () => {
    const resolution = {
      capability: 'text',
      mode: 'byok',
      provider: 'openrouter',
      endpoint: 'https://openrouter.ai/api/v1',
      model: 'llama-3-70b',
    };
    expect(schemaCheck(AiModeResolutionSchema, resolution)).toBe(true);
  });

  test('accepts a resolution without optional endpoint/model', () => {
    const resolution = { capability: 'image', mode: 'offline', provider: 'comfyui' };
    expect(schemaCheck(AiModeResolutionSchema, resolution)).toBe(true);
  });

  test('rejects a resolution with invalid mode', () => {
    const resolution = { capability: 'text', mode: 'remote', provider: 'ollama' };
    expect(schemaCheck(AiModeResolutionSchema, resolution)).toBe(false);
  });
});

describe('AiDetectionResultSchema', () => {
  test('accepts an available detection result', () => {
    const result = {
      capability: 'text',
      available: true,
      mode: 'offline',
      provider: 'ollama',
      detail: 'proxy ping ok',
      checkedAt: new Date().toISOString(),
    };
    expect(schemaCheck(AiDetectionResultSchema, result)).toBe(true);
  });

  test('accepts an unavailable result with only required fields', () => {
    const result = {
      capability: 'image',
      available: false,
      checkedAt: new Date().toISOString(),
    };
    expect(schemaCheck(AiDetectionResultSchema, result)).toBe(true);
  });

  test('rejects a result missing checkedAt', () => {
    expect(schemaCheck(AiDetectionResultSchema, { capability: 'text', available: true })).toBe(
      false,
    );
  });
});

describe('AiChatMessageSchema', () => {
  test('accepts valid chat messages', () => {
    expect(schemaCheck(AiChatMessageSchema, { role: 'user', content: 'Hi' })).toBe(true);
    expect(schemaCheck(AiChatMessageSchema, { role: 'system', content: '' })).toBe(true);
    expect(schemaCheck(AiChatMessageSchema, { role: 'assistant', content: 'Hello' })).toBe(true);
  });

  test('rejects invalid roles', () => {
    expect(schemaCheck(AiChatMessageSchema, { role: 'bot', content: 'Hi' })).toBe(false);
  });
});

describe('AiGatewayCapabilityConfigSchema / AiGatewayModeConfigSchema', () => {
  test('accepts a per-capability config', () => {
    const config = {
      mode: 'offline',
      provider: 'ollama',
      endpoint: 'http://localhost:11434/v1',
      model: 'llama3',
    };
    expect(schemaCheck(AiGatewayCapabilityConfigSchema, config)).toBe(true);
  });

  test('accepts a mixed-mode gateway config (text offline + image byok)', () => {
    const config = {
      text: { mode: 'offline', provider: 'ollama' },
      image: { mode: 'byok', provider: 'comfyui', endpoint: 'https://example.com' },
      serviceActivated: false,
    };
    expect(schemaCheck(AiGatewayModeConfigSchema, config)).toBe(true);
  });

  test('accepts an empty gateway config', () => {
    expect(schemaCheck(AiGatewayModeConfigSchema, {})).toBe(true);
  });

  test('rejects config with invalid capability entry', () => {
    const config = { text: { mode: 'nope', provider: 'x' } };
    expect(schemaCheck(AiGatewayModeConfigSchema, config)).toBe(false);
  });
});
