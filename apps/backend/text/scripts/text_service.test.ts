// apps/backend/text/scripts/text_service.test.ts
// Integration tests for the Ollama text inference service.
// Checks if herdr text is active; if not, spawns it, waits for readiness,
// runs health/model/generation checks, and stops only if started by us.
//
// Usage:
//   bun test scripts/text_service.test.ts

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { $ } from 'bun';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Paths ───────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, '..');
const ROOT = resolve(PROJECT_DIR, '../../..');

// ── Constants ───────────────────────────────────────────────

const OLLAMA_PORT = 11434;
const BASE_URL = `http://127.0.0.1:${OLLAMA_PORT}`;
const POLL_INTERVAL_MS = 2000;
const STARTUP_TIMEOUT_MS = 120_000;

// ── Types ───────────────────────────────────────────────────

type TagEntry = {
  name: string;
  model: string;
  modified_at: string;
  size: number;
};

type TagsResponse = {
  models: TagEntry[];
};

type GenerateResponse = {
  response: string;
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
};

// ── State ───────────────────────────────────────────────────

let startedByUs = false;
let modelsAvailable: TagEntry[] = [];

// ── Readiness ───────────────────────────────────────────────

/**
 * Check if Ollama is reachable and serving.
 * Ollama responds with "Ollama is running" at GET /.
 */
const isReady = async (): Promise<{ ok: boolean; detail: string }> => {
  try {
    const response = await fetch(BASE_URL, {
      signal: AbortSignal.timeout(3000),
    });
    const text = await response.text();
    if (response.ok && text.includes('Ollama is running')) {
      return { ok: true, detail: '/ OK — Ollama is running' };
    }
    return { ok: false, detail: `/ returned ${response.status}: ${text.slice(0, 80)}` };
  } catch (err) {
    const message = (err as Error).message;
    if (
      message.includes('refused') ||
      message.includes('ECONNREFUSED') ||
      message.includes('Unable to connect')
    ) {
      return { ok: false, detail: 'connection refused' };
    }
    return { ok: false, detail: message.slice(0, 80) };
  }
};

const waitForReady = async (timeoutMs: number): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  let lastDetail = '';
  let wasEverReachable = false;

  while (Date.now() < deadline) {
    const result = await isReady();
    if (result.ok) {
      console.log(`  ✓ Ready (${result.detail})`);
      return;
    }

    if (!wasEverReachable && !result.detail.includes('refused') && !result.detail.includes('Unable to connect')) {
      wasEverReachable = true;
    }

    if (result.detail !== lastDetail) {
      if (wasEverReachable && (result.detail.includes('refused') || result.detail.includes('Unable to connect'))) {
        throw new Error('Ollama crashed after becoming reachable — check herdr tab logs for the error');
      }
      console.log(`  ... ${result.detail}`);
      lastDetail = result.detail;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`Ollama did not become ready within ${timeoutMs / 1000}s (last: ${lastDetail})`);
};

// ── Lifecycle ───────────────────────────────────────────────

beforeAll(async () => {
  // Service startup already handled in top-level await if needed
  // This hook is now just a placeholder for test framework lifecycle
}, STARTUP_TIMEOUT_MS + 30_000);

afterAll(async () => {
  if (!startedByUs) {
    console.log('○ Ollama was already running — leaving it alone');
    return;
  }

  console.log('  Stopping text service...');
  await $`bun run herdr:stop text`.cwd(ROOT).nothrow();
  console.log('✓ Ollama stopped');
});

// ── Top-level await: Discover models for skip logic ─────────

// Ensure service is ready and discover available models before test registration
const ready = await isReady();
if (!ready.ok) {
  console.log('○ Ollama not running — starting via herdr for prerequisite discovery...');
  console.log(`  Project dir: ${PROJECT_DIR}`);
  console.log(`  Repo root:   ${ROOT}`);

  const startResult = await $`bun run herdr:start text`.cwd(ROOT).nothrow();

  if (startResult.exitCode !== 0) {
    console.error('herdr start failed:', startResult.stderr.toString());
    throw new Error('Failed to start text service via herdr');
  }

  startedByUs = true;
  console.log('  Waiting for Ollama to become ready...');
  await waitForReady(STARTUP_TIMEOUT_MS);
} else {
  console.log(`✓ Ollama already running (${ready.detail})`);
}

// Now discover models
try {
  const tagsResponse = await fetch(`${BASE_URL}/api/tags`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (tagsResponse.ok) {
    const tagsData = (await tagsResponse.json()) as TagsResponse;
    modelsAvailable = tagsData.models ?? [];
  }
} catch (err) {
  console.warn('  ⚠ Failed to discover models:', (err as Error).message);
}

if (modelsAvailable.length === 0) {
  console.warn('  ⚠ No models available — generation test will be skipped');
  console.warn('    Pull a model first: bun run download:model qwen3.5:4b');
}

// ── Tests ───────────────────────────────────────────────────

describe('Ollama text inference service', () => {
  test('health endpoint responds with "Ollama is running"', async () => {
    const response = await fetch(BASE_URL, {
      signal: AbortSignal.timeout(5000),
    });

    expect(response.ok).toBe(true);
    const text = await response.text();
    expect(text).toInclude('Ollama is running');
    console.log('  /:', text.trim());
  });

  test('/api/tags lists available models', async () => {
    const response = await fetch(`${BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });

    expect(response.ok).toBe(true);
    const data = (await response.json()) as TagsResponse;
    expect(data.models).toBeArray();

    console.log(`  ${data.models.length} model(s) found`);
    for (const model of data.models) {
      expect(model.name).toBeString();
      const sizeMb = ((model.size ?? 0) / (1024 * 1024)).toFixed(0);
      console.log(`    • ${model.name} (${sizeMb} MB)`);
    }
  });

  test.skipIf(modelsAvailable.length === 0)('/api/generate returns a response (super lite)', async () => {
    // Prefer smallest model for fast test
    const sorted = [...modelsAvailable].sort((a, b) => (a.size ?? 0) - (b.size ?? 0));
    const model = sorted[0].name;

    console.log(`  Model:   ${model} (${(sorted[0].size / (1024 * 1024)).toFixed(0)} MB)`);

    const t0 = Date.now();
    const response = await fetch(`${BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: 'Say "OK"',
        stream: false,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const wallMs = Date.now() - t0;

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Model '${model}' failed (HTTP ${response.status}):\n${errorBody.slice(0, 300)}`);
    }

    const data = (await response.json()) as GenerateResponse;

    if (data.error) {
      throw new Error(`Model '${model}' error: ${data.error}`);
    }

    expect(data.response).toBeString();
    expect(data.response.length).toBeGreaterThan(0);
    expect(data.done).toBe(true);

    console.log(`  Output:  "${data.response.trim()}"`);
    console.log(`  Wall:    ${wallMs}ms`);
    if (data.total_duration !== undefined) {
      console.log(`  Server:  ${(data.total_duration / 1_000_000).toFixed(0)}ms`);
    }
    if (data.eval_count !== undefined) {
      console.log(`  Tokens:  ${data.eval_count} generated`);
    }
  }, 120_000);
});
