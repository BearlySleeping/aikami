// apps/backend/text/scripts/text_service.test.ts
// Integration tests for the Shimmy text inference service.
// Starts the Docker container via herdr if not already running,
// runs health/model/generation checks, and stops only if started by us.
//
// Usage:
//   bun test scripts/text_service.test.ts
//   bun test

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { $ } from 'bun';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Paths ───────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, '..');
const ROOT = resolve(PROJECT_DIR, '../../..');

// ── Constants ───────────────────────────────────────────────

const SHIMMY_PORT = 11435;
// Use 127.0.0.1 instead of localhost — podman port-forward is IPv4-only,
// and localhost can resolve to ::1 (IPv6) on dual-stack hosts.
const BASE_URL = `http://127.0.0.1:${SHIMMY_PORT}`;
const POLL_INTERVAL_MS = 2000;
const STARTUP_TIMEOUT_MS = 180_000;

// ── Types ───────────────────────────────────────────────────

type ModelEntry = {
  id: string;
  object: string;
  created: number;
  owned_by: string;
};

type ModelsResponse = {
  object: string;
  data: ModelEntry[];
};

type ChatCompletionChunk = {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: { role?: string; content?: string };
    finish_reason: string | null;
  }>;
};

// ── State ───────────────────────────────────────────────────

let startedByUs = false;

// ── Readiness ───────────────────────────────────────────────

/**
 * Check if Shimmy is reachable and serving.
 * Tries /health first (cheapest), falls back to /v1/models.
 */
const isReady = async (): Promise<{ ok: boolean; detail: string }> => {
  // Try /health
  try {
    const response = await fetch(`${BASE_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) {
      return { ok: true, detail: '/health OK' };
    }
    return { ok: false, detail: `/health returned ${response.status}` };
  } catch (err) {
    const message = (err as Error).message;
    // Connection-level failures — server not up yet
    if (
      message.includes('refused') ||
      message.includes('ECONNREFUSED') ||
      message.includes('Unable to connect')
    ) {
      return { ok: false, detail: 'connection refused' };
    }
    return { ok: false, detail: message.slice(0, 80) };
  }

  // Fallback: /v1/models
  try {
    const response = await fetch(`${BASE_URL}/v1/models`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      return { ok: false, detail: `/v1/models returned ${response.status}` };
    }
    const data = (await response.json()) as ModelsResponse;
    if (data.object === 'list' && Array.isArray(data.data)) {
      return { ok: true, detail: '/v1/models OK' };
    }
    return { ok: false, detail: '/v1/models unexpected structure' };
  } catch (err) {
    return { ok: false, detail: `/v1/models: ${(err as Error).message}` };
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

    // Track if the port was ever accepting connections (even if not ready)
    if (!wasEverReachable && !result.detail.includes('refused') && !result.detail.includes('Unable to connect')) {
      wasEverReachable = true;
    }

    if (result.detail !== lastDetail) {
      // If we were reachable and now get connection refused, the process crashed
      if (wasEverReachable && (result.detail.includes('refused') || result.detail.includes('Unable to connect'))) {
        throw new Error(
          `Shimmy crashed after becoming reachable — check herdr tab logs for the error`,
        );
      }
      console.log(`  ... ${result.detail}`);
      lastDetail = result.detail;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(
    `Shimmy did not become ready within ${timeoutMs / 1000}s (last: ${lastDetail})`,
  );
};

// ── Lifecycle ───────────────────────────────────────────────

beforeAll(async () => {
  const ready = await isReady();
  if (ready.ok) {
    console.log(`✓ Shimmy already running (${ready.detail})`);
    return;
  }

  console.log('○ Shimmy not running — starting via herdr...');
  console.log(`  Project dir: ${PROJECT_DIR}`);
  console.log(`  Repo root:   ${ROOT}`);

  const versionPath = resolve(PROJECT_DIR, '.shimmy-version');
  if (existsSync(versionPath)) {
    const version = readFileSync(versionPath, 'utf-8').trim();
    console.log(`  Version:     ${version}`);
  }

  const startResult =
    await $`bun run herdr:start text`.cwd(ROOT).nothrow();

  if (startResult.exitCode !== 0) {
    console.error('herdr start failed:', startResult.stderr.toString());
    throw new Error('Failed to start text service via herdr');
  }

  startedByUs = true;
  console.log('  Waiting for Shimmy to become ready...');
  await waitForReady(STARTUP_TIMEOUT_MS);
}, STARTUP_TIMEOUT_MS + 30_000);

afterAll(async () => {
  if (!startedByUs) {
    console.log('○ Shimmy was already running — leaving it alone');
    return;
  }

  console.log('  Stopping text service...');
  await $`bun run herdr:stop text`.cwd(ROOT).nothrow();
  console.log('✓ Shimmy stopped');
});

// ── Tests ───────────────────────────────────────────────────

describe('Shimmy text inference service', () => {
  test('health endpoint responds', async () => {
    const response = await fetch(`${BASE_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    });

    expect(response.ok).toBe(true);
    const body = await response.text();
    expect(body.length).toBeGreaterThan(0);
    console.log('  /health:', body.trim().slice(0, 120));
  });

  test('/v1/models lists available GGUF models', async () => {
    const response = await fetch(`${BASE_URL}/v1/models`, {
      signal: AbortSignal.timeout(5000),
    });

    expect(response.ok).toBe(true);
    const data = (await response.json()) as ModelsResponse;
    expect(data.object).toBe('list');
    expect(Array.isArray(data.data)).toBe(true);

    console.log(`  ${data.data.length} model(s) found`);
    for (const model of data.data) {
      expect(model.id).toBeString();
      expect(model.object).toBe('model');
      console.log(`    • ${model.id}`);
    }
  });

  test('/v1/chat/completions streams a response', async () => {
    const modelsResponse = await fetch(`${BASE_URL}/v1/models`);
    const modelsData = (await modelsResponse.json()) as ModelsResponse;
    const models = modelsData.data ?? [];

    expect(models.length).toBeGreaterThan(0);

    // Prefer models with quant suffixes (real GGUF files) over plain names
    // (Ollama auto-discovered directories). tinyllama-1.1b-chat-v1.0.q4-0 > tinyllama-1.1b
    const isRealGguf = (id: string) => /[qQ]\d[-_]/.test(id);
    const model = models.find((m) => m.id?.startsWith('llama-3.2'))?.id
      ?? models.find((m) => m.id?.startsWith('tinyllama') && isRealGguf(m.id))?.id
      ?? models.find((m) => isRealGguf(m.id))?.id
      ?? models[0]?.id;

    const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Say "hello world"' }],
        stream: true,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    // Fail with the actual error body if model doesn't load
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Model '${model}' failed to load (HTTP ${response.status}):\n${errorBody.slice(0, 300)}`,
      );
    }
    expect(response.body).not.toBeNull();

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let tokenCount = 0;
    let fullText = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.length === 0 || trimmed === 'data: [DONE]') {
            continue;
          }
          if (!trimmed.startsWith('data: ')) {
            continue;
          }

          const json = trimmed.slice(6);
          try {
            const chunk = JSON.parse(json) as ChatCompletionChunk;
            const content = chunk.choices?.[0]?.delta?.content;
            if (content) {
              tokenCount++;
              fullText += content;
            }
          } catch {
            // malformed SSE — skip
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    expect(tokenCount).toBeGreaterThan(0);
    expect(fullText.length).toBeGreaterThan(0);
    console.log(`  Model:  ${model}`);
    console.log(`  Tokens: ${tokenCount}`);
    console.log(`  Output: "${fullText.trim()}"`);
  }, 120_000);

  test('/v1/chat/completions with non-streaming returns complete response', async () => {
    const modelsResponse = await fetch(`${BASE_URL}/v1/models`);
    const modelsData = (await modelsResponse.json()) as ModelsResponse;
    const models = modelsData.data ?? [];

    expect(models.length).toBeGreaterThan(0);

    // Prefer models with quant suffixes (real GGUF files) over plain names
    // (Ollama auto-discovered directories). tinyllama-1.1b-chat-v1.0.q4-0 > tinyllama-1.1b
    const isRealGguf = (id: string) => /[qQ]\d[-_]/.test(id);
    const model = models.find((m) => m.id?.startsWith('llama-3.2'))?.id
      ?? models.find((m) => m.id?.startsWith('tinyllama') && isRealGguf(m.id))?.id
      ?? models.find((m) => isRealGguf(m.id))?.id
      ?? models[0]?.id;

    const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        stream: false,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Model '${model}' failed to load (HTTP ${response.status}):\n${errorBody.slice(0, 300)}`,
      );
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    expect(data.choices).toBeArray();
    expect(data.choices.length).toBeGreaterThan(0);
    expect(data.choices[0].message.content).toBeString();
    expect(data.choices[0].message.content.length).toBeGreaterThan(0);

    console.log(`  Model:   ${model}`);
    console.log(`  Output:  "${data.choices[0].message.content.trim()}"`);
  }, 120_000);
});
