// apps/frontend/client/src/lib/services/capability/capability_service.test.ts
//
// Unit tests for CapabilityService — gateway-backed detection mapping.
// All provider availability decisions come from the mocked AI Provider
// Gateway (C-320); no fetch stubs and no private ping logic remain.
// Contract: C-322 AC-1 (gateway delegation), AC-4 (shared gateway mock)
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json \
//     src/lib/services/capability/capability_service.test.ts

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { AiCapability, AiDetectionResult, AiModeResolution } from '@aikami/types';

// $state is polyfilled globally via test_preload.ts

// ── Shared gateway mock ────────────────────────────────────────────────
// The CapabilityService imports aiGatewayService from $services. Mock the
// barrel with a mutable gateway surface so each test controls detection
// results without stubbing globalThis.fetch.

/** Builds a default per-capability detection result. */
const _availableResult = (capability: AiCapability): AiDetectionResult => {
  const provider = capability === 'text' ? 'ollama' : capability === 'image' ? 'comfyui' : 'kokoro';
  return {
    capability,
    available: true,
    mode: 'offline',
    provider,
    detail: `${provider} reachable`,
    checkedAt: new Date().toISOString(),
  };
};

/** Builds an unavailable detection result for a capability. */
const _unavailableResult = (capability: AiCapability): AiDetectionResult => ({
  capability,
  available: false,
  detail: 'No provider reachable or configured',
  checkedAt: new Date().toISOString(),
});

let _detectImpl: (capability: AiCapability) => Promise<AiDetectionResult>;
let _resolveModeImpl: (capability: AiCapability) => AiModeResolution;

const _resetGateway = (): void => {
  _detectImpl = async (capability) => _availableResult(capability);
  _resolveModeImpl = (capability) => ({
    capability,
    mode: 'offline',
    provider: 'ollama',
    model: 'llama3.2',
    endpoint: 'http://localhost:11434/v1',
  });
};
_resetGateway();

const _createSvcStub = () => {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(target, prop) {
      if (!(prop in target)) {
        (target as Record<string, unknown>)[prop] = mock(() => {});
      }
      return (target as Record<string, unknown>)[prop];
    },
  };
  return new Proxy({} as Record<string, unknown>, handler) as Record<string, unknown>;
};

mock.module('$services', () => ({
  ..._createSvcStub(),
  aiGatewayService: {
    detect: (capability: AiCapability) => _detectImpl(capability),
    resolveMode: (capability: AiCapability) => _resolveModeImpl(capability),
  },
}));

// ── Import module under test ──────────────────────────────────────────

const { capabilityService } = await import('./capability_service.svelte');

// ── Tests ─────────────────────────────────────────────────────────────

describe('CapabilityService', () => {
  beforeEach(() => {
    _resetGateway();
  });

  // ── AC-1: text detection maps gateway results ───────────────────────

  test('detectText returns detected when gateway reports offline availability', async () => {
    const result = await capabilityService.detectText();
    expect(result).toBe('detected');
  });

  test('detectText returns configured when gateway reports byok availability', async () => {
    _detectImpl = async () => ({
      capability: 'text',
      available: true,
      mode: 'byok',
      provider: 'cloud',
      detail: 'Cloud text provider configured',
      checkedAt: new Date().toISOString(),
    });
    const result = await capabilityService.detectText();
    expect(result).toBe('configured');
  });

  test('detectText returns not_found when gateway reports unavailable', async () => {
    _detectImpl = async (capability) => _unavailableResult(capability);
    const result = await capabilityService.detectText();
    expect(result).toBe('not_found');
  });

  test('detectText returns error when gateway detection throws', async () => {
    _detectImpl = async () => {
      throw new Error('gateway exploded');
    };
    const result = await capabilityService.detectText();
    expect(result).toBe('error');
  });

  // ── AC-1: image detection maps gateway results ──────────────────────

  test('detectImage returns detected when gateway reports offline availability', async () => {
    const result = await capabilityService.detectImage();
    expect(result).toBe('detected');
  });

  test('detectImage returns configured when gateway reports byok availability', async () => {
    _detectImpl = async () => ({
      capability: 'image',
      available: true,
      mode: 'byok',
      provider: 'custom',
      detail: 'Image provider configured',
      checkedAt: new Date().toISOString(),
    });
    const result = await capabilityService.detectImage();
    expect(result).toBe('configured');
  });

  test('detectImage returns not_found when gateway reports unavailable', async () => {
    _detectImpl = async (capability) => _unavailableResult(capability);
    const result = await capabilityService.detectImage();
    expect(result).toBe('not_found');
  });

  test('detectImage returns error when gateway detection throws', async () => {
    _detectImpl = async () => {
      throw new Error('gateway exploded');
    };
    const result = await capabilityService.detectImage();
    expect(result).toBe('error');
  });

  // ── AC-1: full detect() snapshot ────────────────────────────────────

  test('detect returns complete snapshot with all fields from gateway results', async () => {
    const snapshot = await capabilityService.detect();

    expect(snapshot.isComplete).toBe(true);
    expect(snapshot.textStatus).toBe('detected');
    expect(snapshot.imageStatus).toBe('detected');
    expect(snapshot.voiceStatus).toBe('detected');
    expect(snapshot.textProviderId).toBe('ollama');
    expect(snapshot.textModelName).toBe('llama3.2');
    expect(snapshot.detectedAt).toBeDefined();
    expect(snapshot.summary).toInclude('Local AI detected');
  });

  test('detect returns not_found across all providers when gateway reports unavailable', async () => {
    _detectImpl = async (capability) => _unavailableResult(capability);
    const snapshot = await capabilityService.detect();

    expect(snapshot.isComplete).toBe(true);
    expect(snapshot.textStatus).toBe('not_found');
    expect(snapshot.imageStatus).toBe('not_found');
    expect(snapshot.voiceStatus).toBe('not_found');
    expect(snapshot.textProviderId).toBeUndefined();
    expect(snapshot.textModelName).toBeUndefined();
    expect(snapshot.summary).toInclude('offline demo');
  });

  test('detect returns positive summary when text unavailable but image/voice available', async () => {
    _detectImpl = async (capability) => {
      if (capability === 'text') {
        return _unavailableResult('text');
      }
      return _availableResult(capability);
    };
    const snapshot = await capabilityService.detect();

    expect(snapshot.isComplete).toBe(true);
    expect(snapshot.textStatus).toBe('not_found');
    expect(snapshot.imageStatus).toBe('detected');
    expect(snapshot.voiceStatus).toBe('detected');
    expect(snapshot.summary).toInclude('image/voice available');
  });

  test('detect reports cloud summary when gateway text mode is byok', async () => {
    _detectImpl = async (capability) => {
      if (capability === 'text') {
        return {
          capability: 'text',
          available: true,
          mode: 'byok',
          provider: 'cloud',
          detail: 'Cloud text provider configured',
          checkedAt: new Date().toISOString(),
        };
      }
      return _unavailableResult(capability);
    };
    const snapshot = await capabilityService.detect();

    expect(snapshot.textStatus).toBe('configured');
    expect(snapshot.summary).toBe('Cloud AI provider configured');
  });

  test('detect degrades to error status when gateway throws, snapshot stays complete', async () => {
    _detectImpl = async () => {
      throw new Error('gateway exploded');
    };
    const snapshot = await capabilityService.detect();

    expect(snapshot.isComplete).toBe(true);
    expect(snapshot.textStatus).toBe('error');
    expect(snapshot.imageStatus).toBe('error');
    expect(snapshot.voiceStatus).toBe('error');
    expect(snapshot.summary).toInclude('error');
  });

  test('detect leaves textModelName undefined when mode resolution throws (nothing configured)', async () => {
    _resolveModeImpl = () => {
      throw new Error('No text generation provider configured.');
    };
    const snapshot = await capabilityService.detect();

    expect(snapshot.textStatus).toBe('detected');
    expect(snapshot.textProviderId).toBe('ollama');
    expect(snapshot.textModelName).toBeUndefined();
  });

  test('detect keeps voice failures from blocking completion', async () => {
    _detectImpl = async (capability) => {
      if (capability === 'voice') {
        return _unavailableResult('voice');
      }
      return _availableResult(capability);
    };
    const snapshot = await capabilityService.detect();

    expect(snapshot.voiceStatus).toBe('not_found');
    expect(snapshot.isComplete).toBe(true);
  });

  test('detect runs the three capability checks concurrently', async () => {
    const started: AiCapability[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    _detectImpl = async (capability) => {
      started.push(capability);
      await gate;
      return _availableResult(capability);
    };

    const pending = capabilityService.detect();
    // All three checks must have started before any resolves.
    await Promise.resolve();
    expect(started.sort()).toEqual(['image', 'text', 'voice']);
    release();
    const snapshot = await pending;
    expect(snapshot.isComplete).toBe(true);
  });
});
