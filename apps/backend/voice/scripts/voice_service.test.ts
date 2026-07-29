// apps/backend/voice/scripts/voice_service.test.ts
// Integration tests for the Kokoro TTS voice synthesis service.
// Checks if herdr voice is active; if not, spawns it, waits for readiness,
// runs health/model/synthesis checks, and stops only if started by us.
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

const KOKORO_PORT = 8089;
const BASE_URL = `http://127.0.0.1:${KOKORO_PORT}`;
const POLL_INTERVAL_MS = 3000;
const STARTUP_TIMEOUT_MS = 180_000;

// ── Types ───────────────────────────────────────────────────

type VoiceEntry = {
  id: string;
};

// ── State ───────────────────────────────────────────────────

let startedByUs = false;
let voicesAvailable: VoiceEntry[] = [];

// ── Readiness ───────────────────────────────────────────────

/**
 * Check if Kokoro is reachable and serving.
 * Tries /v1/voices (lists actual Kokoro voice names like af_heart).
 */
const isReady = async (): Promise<{ ok: boolean; detail: string }> => {
  try {
    const response = await fetch(`${BASE_URL}/v1/voices`, {
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      const data = (await response.json()) as { voices?: VoiceEntry[] };
      if (Array.isArray(data.voices)) {
        const voiceCount = data.voices.length;
        return { ok: true, detail: `/v1/voices OK — ${voiceCount} voice(s)` };
      }
    }
    return { ok: false, detail: `/v1/voices returned ${response.status}` };
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
        throw new Error('Kokoro crashed after becoming reachable — check herdr tab logs');
      }
      console.log(`  ... ${result.detail}`);
      lastDetail = result.detail;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`Kokoro did not become ready within ${timeoutMs / 1000}s (last: ${lastDetail})`);
};

// ── Lifecycle ───────────────────────────────────────────────

beforeAll(async () => {
  // Service startup already handled in top-level await if needed
  // This hook is now just a placeholder for test framework lifecycle
}, STARTUP_TIMEOUT_MS + 30_000);

afterAll(async () => {
  if (!startedByUs) {
    console.log('○ Kokoro was already running — leaving it alone');
    return;
  }

  console.log('  Stopping voice service...');
  await $`bun run herdr:stop voice`.cwd(ROOT).nothrow();
  console.log('✓ Kokoro stopped');
});

// ── Top-level await: Discover voices for skip logic ─────────

// Ensure service is ready and discover available voices before test registration
const ready = await isReady();
if (!ready.ok) {
  console.log('○ Kokoro not running — starting via herdr for prerequisite discovery...');
  console.log(`  Project dir: ${PROJECT_DIR}`);
  console.log(`  Repo root:   ${ROOT}`);

  const startResult = await $`bun run herdr:start voice`.cwd(ROOT).nothrow();

  if (startResult.exitCode !== 0) {
    console.error('herdr start failed:', startResult.stderr.toString());
    throw new Error('Failed to start voice service via herdr');
  }

  startedByUs = true;
  console.log('  Waiting for Kokoro to become ready...');
  await waitForReady(STARTUP_TIMEOUT_MS);
} else {
  console.log(`✓ Kokoro already running (${ready.detail})`);
}

// Now discover voices
try {
  const voicesResponse = await fetch(`${BASE_URL}/v1/voices`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (voicesResponse.ok) {
    const voicesData = (await voicesResponse.json()) as { voices?: VoiceEntry[] };
    voicesAvailable = voicesData.voices ?? [];
  }
} catch (err) {
  console.warn('  ⚠ Failed to discover voices:', (err as Error).message);
}

if (voicesAvailable.length === 0) {
  console.warn('  ⚠ No voices available — synthesis test will be skipped');
}

// ── Tests ───────────────────────────────────────────────────

describe('Kokoro TTS voice service', () => {
  test('/v1/voices lists available Kokoro voices', async () => {
    const response = await fetch(`${BASE_URL}/v1/voices`, {
      signal: AbortSignal.timeout(5000),
    });

    expect(response.ok).toBe(true);
    const data = (await response.json()) as { voices?: VoiceEntry[] };
    expect(data.voices).toBeArray();
    const voices = data.voices ?? [];

    console.log(`  ${voices.length} voice(s) available`);
    for (const voice of voices.slice(0, 8)) {
      console.log(`    • ${voice.id}`);
    }
    if (voices.length > 8) {
      console.log(`    … and ${voices.length - 8} more`);
    }
  });

  test.skipIf(voicesAvailable.length === 0)(
    '/v1/audio/speech synthesizes WAV audio (super lite)',
    async () => {
      const voice = voicesAvailable[0].id;
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
    },
    60_000,
  );
});
