// apps/frontend/client/src/lib/services/capability/capability_service.test.ts
//
// Unit tests for CapabilityService — provider detection logic.
// Contract: C-318 AC-1 (detection completes within 3s), AC-3 (local AI detection)
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json \
//     src/lib/services/capability/capability_service.test.ts

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// $state is polyfilled globally via test_preload.ts

// ── Mocks ──────────────────────────────────────────────────────────────

// Mock the aiSettingsService and capabilityService barrel paths to avoid
// the full $services import chain. The CapabilityService module imports
// aiSettingsService from $services.

const _AI_SETTINGS_PATH =
  '/home/sonny/Development/Projects/passion/aikami/.pi/workspaces/run-mrkquinj-c-318/apps/frontend/client/src/lib/services/settings/ai_settings.svelte.ts';

let _mockTextConfig = { apiKey: '', endpoint: '', model: '' };
let _mockImageConfig = { apiKey: '', endpoint: '', model: '' };

mock.module(_AI_SETTINGS_PATH, () => ({
  aiSettingsService: {
    get textProvider() {
      return { ..._mockTextConfig };
    },
    get imageProvider() {
      return { ..._mockImageConfig };
    },
  },
}));

// ── Mock $services comprehensively to avoid clobbering preload stubs ──
// Include all exports the preload provides, overriding only aiSettingsService

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
  aiSettingsService: {
    get textProvider() {
      return { ..._mockTextConfig };
    },
    get imageProvider() {
      return { ..._mockImageConfig };
    },
  },
}));

// ── Fetch mock ─────────────────────────────────────────────────────────

type MockFetchResponse = { ok: boolean; status: number; json?: () => Promise<unknown> };

let _fetchImpl:
  | ((input: string | URL | Request, init?: RequestInit) => Promise<MockFetchResponse>)
  | null = null;

globalThis.fetch = ((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  if (_fetchImpl) {
    return _fetchImpl(input, init) as Promise<Response>;
  }
  return Promise.reject(new Error('No fetch mock configured'));
}) as typeof globalThis.fetch;

/** Sets the mock fetch implementation for a test. */
const mockFetch = (impl: (url: string) => MockFetchResponse | Error) => {
  _fetchImpl = async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    const result = impl(url);
    if (result instanceof Error) {
      throw result;
    }
    return result;
  };
};

/** Default: all endpoints return success. */
const mockFetchOnline = () => {
  mockFetch((url) => {
    if (
      url.includes('/api/text/') ||
      url.includes('/api/image/object_info') ||
      url.includes('localhost:11434')
    ) {
      return { ok: true, status: 200 };
    }
    return { ok: true, status: 200 };
  });
};

/** All endpoints return error. */
const mockFetchOffline = () => {
  mockFetch(() => new Error('Connection refused'));
};

// ── Import module under test ──────────────────────────────────────────

const { capabilityService } = await import('./capability_service.svelte');

// ── Tests ─────────────────────────────────────────────────────────────

describe('CapabilityService', () => {
  beforeEach(() => {
    _mockTextConfig = { apiKey: '', endpoint: '', model: '' };
    _mockImageConfig = { apiKey: '', endpoint: '', model: '' };
    mockFetchOnline();
  });

  afterEach(() => {
    _fetchImpl = null;
  });

  // ── AC-1: Detection resolves within expected values ─────────────────

  test('detectText returns not_found when no providers configured and Ollama unreachable', async () => {
    mockFetchOffline();
    const result = await capabilityService.detectText();
    expect(result).toBe('not_found');
  });

  test('detectText returns detected when Ollama proxy responds', async () => {
    mockFetchOnline();
    const result = await capabilityService.detectText();
    expect(result).toBe('detected');
  });

  test('detectText returns configured when cloud provider has API key', async () => {
    _mockTextConfig = { apiKey: 'sk-test', endpoint: '', model: '' };
    const result = await capabilityService.detectText();
    expect(result).toBe('configured');
  });

  test('detectText returns configured when cloud provider has endpoint+model', async () => {
    _mockTextConfig = { apiKey: '', endpoint: 'https://api.openai.com', model: 'gpt-4' };
    const result = await capabilityService.detectText();
    expect(result).toBe('configured');
  });

  // ── AC-1: Image detection ───────────────────────────────────────────

  test('detectImage returns detected when ComfyUI proxy responds', async () => {
    mockFetchOnline();
    const result = await capabilityService.detectImage();
    expect(result).toBe('detected');
  });

  test('detectImage returns not_found when ComfyUI is unreachable', async () => {
    mockFetchOffline();
    const result = await capabilityService.detectImage();
    expect(result).toBe('not_found');
  });

  test('detectImage returns configured when image provider has endpoint', async () => {
    _mockImageConfig = { apiKey: '', endpoint: 'http://localhost:8188', model: '' };
    const result = await capabilityService.detectImage();
    expect(result).toBe('configured');
  });

  // ── AC-3: Local AI detection via Ollama ─────────────────────────────

  test('Ollama proxy ping returns detected on HTTP 200', async () => {
    mockFetch((url) => {
      if (url.includes('/api/text/')) {
        return { ok: true, status: 200 };
      }
      return new Error('refused');
    });
    const result = await capabilityService.detectText();
    expect(result).toBe('detected');
  });

  test('Ollama native fetch works as fallback when proxy fails', async () => {
    mockFetch((url) => {
      if (url.includes('/api/text/')) {
        return new Error('refused'); // proxy down
      }
      if (url.includes('localhost:11434/api/tags')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ models: [{ name: 'llama3' }, { name: 'mistral' }] }),
        };
      }
      return new Error('refused');
    });
    const result = await capabilityService.detectText();
    expect(result).toBe('detected');
  });

  test('CORS error on native fetch treated as not_found', async () => {
    mockFetch((url) => {
      if (url.includes('/api/text/')) {
        return new Error('refused');
      }
      if (url.includes('localhost:11434')) {
        return new Error('CORS blocked');
      }
      return new Error('refused');
    });
    const result = await capabilityService.detectText();
    expect(result).toBe('not_found');
  });

  // ── AC-1: Full detect() snapshot ────────────────────────────────────

  test('detect returns complete snapshot with all fields', async () => {
    mockFetchOnline();
    const snapshot = await capabilityService.detect();

    expect(snapshot.isComplete).toBe(true);
    expect(snapshot.textStatus).toBe('detected');
    expect(snapshot.imageStatus).toBe('detected');
    expect(snapshot.voiceStatus).toBe('detected');
    expect(snapshot.detectedAt).toBeDefined();
    expect(snapshot.summary).toBeString();
  });

  test('detect returns not_found across all providers when offline', async () => {
    mockFetchOffline();
    const snapshot = await capabilityService.detect();

    expect(snapshot.isComplete).toBe(true);
    expect(snapshot.textStatus).toBe('not_found');
    expect(snapshot.imageStatus).toBe('not_found');
    expect(snapshot.summary).toInclude('offline demo');
  });

  // ── checkCloudTextConfig ────────────────────────────────────────────

  test('checkCloudTextConfig returns configured when API key exists', () => {
    _mockTextConfig = { apiKey: 'sk-test', endpoint: '', model: '' };
    expect(capabilityService.checkCloudTextConfig()).toBe('configured');
  });

  test('checkCloudTextConfig returns not_found when no config', () => {
    _mockTextConfig = { apiKey: '', endpoint: '', model: '' };
    expect(capabilityService.checkCloudTextConfig()).toBe('not_found');
  });

  test('detectText handles fetch timeout gracefully', async () => {
    // Simulate a fetch that aborts (like a timeout)
    mockFetch(() => {
      throw new DOMException('The operation was aborted', 'AbortError');
    });
    const result = await capabilityService.detectText();
    expect(result).toBe('not_found');
  });
});
