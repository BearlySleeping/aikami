// apps/backend/voice/scripts/voice_service.test.ts
// Integration tests for the sherpa-onnx voice synthesis service (C-392).
// Checks if herdr voice is active; if not, spawns it, waits for readiness,
// runs health/synthesis checks, and stops only if started by us.
//
// Protocol (sherpa-onnx):
//   readiness: GET  /health          — /v1/voices is gone (sherpa does not
//                                      expose it; the pre-C-392 test probed
//                                      it to discover voice names)
//   synthesize: POST /v1/audio/speech
//
// Usage:
//   bun test scripts/voice_service.test.ts

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $ } from 'bun';

// ── Paths ───────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, '..');
const ROOT = resolve(PROJECT_DIR, '../../..');

// ── Constants ───────────────────────────────────────────────

const VOICE_PORT = 8089;
const BASE_URL = `http://127.0.0.1:${VOICE_PORT}`;
const POLL_INTERVAL_MS = 3000;
const STARTUP_TIMEOUT_MS = 180_000;
const DEFAULT_VOICE = 'af_heart';

// ── State ───────────────────────────────────────────────────

let startedByUs = false;

// ── Readiness ───────────────────────────────────────────────

/**
 * Check if sherpa-onnx is reachable and serving.
 * GET /health is the readiness probe (the compose healthcheck uses it).
 */
const isReady = async (): Promise<{ ok: boolean; detail: string }> => {
  try {
    const response = await fetch(`${BASE_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      return { ok: true, detail: '/health OK' };
    }
    return { ok: false, detail: `/health returned ${response.status}` };
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

    if (
      !wasEverReachable &&
      !result.detail.includes('refused') &&
      !result.detail.includes('Unable to connect')
    ) {
      wasEverReachable = true;
    }

    if (result.detail !== lastDetail) {
      if (
        wasEverReachable &&
        (result.detail.includes('refused') || result.detail.includes('Unable to connect'))
      ) {
        throw new Error('sherpa-onnx crashed after becoming reachable — check herdr tab logs');
      }
      console.log(`  ... ${result.detail}`);
      lastDetail = result.detail;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(
    `sherpa-onnx did not become ready within ${timeoutMs / 1000}s (last: ${lastDetail})`,
  );
};

// ── Lifecycle ───────────────────────────────────────────────

beforeAll(async () => {
  // Service startup already handled in top-level await if needed
}, STARTUP_TIMEOUT_MS + 30_000);

afterAll(async () => {
  if (!startedByUs) {
    console.log('○ voice was already running — leaving it alone');
    return;
  }

  console.log('  Stopping voice service...');
  await $`bun run herdr:stop voice`.cwd(ROOT).nothrow();
  console.log('✓ voice stopped');
});

// ── Top-level await: ensure service is ready ────────────────

const ready = await isReady();
if (!ready.ok) {
  console.log('○ voice not running — starting via herdr for prerequisite discovery...');
  console.log(`  Project dir: ${PROJECT_DIR}`);
  console.log(`  Repo root:   ${ROOT}`);

  const startResult = await $`bun run herdr:start voice`.cwd(ROOT).nothrow();

  if (startResult.exitCode !== 0) {
    console.error('herdr start failed:', startResult.stderr.toString());
    throw new Error('Failed to start voice service via herdr');
  }

  startedByUs = true;
  console.log('  Waiting for sherpa-onnx to become ready...');
  await waitForReady(STARTUP_TIMEOUT_MS);
} else {
  console.log(`✓ voice already running (${ready.detail})`);
}

// ── Tests ───────────────────────────────────────────────────

describe('sherpa-onnx voice service', () => {
  test('/health reports readiness', async () => {
    const response = await fetch(`${BASE_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    });

    expect(response.ok).toBe(true);
    console.log(`  /health: ${response.status}`);
  });

  test('/v1/audio/speech synthesizes WAV audio (super lite)', async () => {
    const voice = DEFAULT_VOICE;
    const text = 'OK';

    console.log(`  Voice:   ${voice}`);
    console.log(`  Text:    "${text}"`);

    const t0 = Date.now();
    const response = await fetch(`${BASE_URL}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'tts-1',
        input: text,
        voice,
        response_format: 'wav',
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`Synthesis failed (HTTP ${response.status}):\n${errorBody.slice(0, 300)}`);
    }

    const buffer = await response.arrayBuffer();
    const wallMs = Date.now() - t0;

    expect(buffer.byteLength).toBeGreaterThan(0);

    // WAV header check: "RIFF" at offset 0 and "WAVE" FourCC at bytes 8-11
    const headerRiff = new Uint8Array(buffer.slice(0, 4));
    const riff = new TextDecoder().decode(headerRiff);
    expect(riff).toBe('RIFF');

    const headerWave = new Uint8Array(buffer.slice(8, 12));
    const wave = new TextDecoder().decode(headerWave);
    expect(wave).toBe('WAVE');

    console.log(`  Size:    ${buffer.byteLength} bytes`);
    console.log(`  Format:  ${riff}...${wave} (valid WAV)`);
    console.log(`  Wall:    ${wallMs}ms`);
  }, 60_000);
});
