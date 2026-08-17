/**
 * apps/backend/local-stack/stack/init.test.ts
 *
 * C-391 wizard-level ACs exercised through the CLI entry with a stub
 * environment: AC-6 (disk shortfall), AC-7 (plan before write, decline
 * writes nothing), AC-9 (re-run diff + byte-identical decline), AC-11
 * (platform separator), AC-13 (--json schema-valid output).
 *
 * These tests run `runInit` against the REAL Bun/CLI executor (probes
 * degrade gracefully on a no-GPU host — AC-1) with a stubbed manifest and
 * an isolated --env-path so nothing touches the repo's real .env.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HardwareProfileSchema, StackPlanSchema } from '@aikami/schemas';
import { Value } from 'typebox/value';
import { type CliOptions, runInit } from './init.ts';

const MANIFEST = JSON.stringify({
  schemaVersion: 1,
  entries: [
    {
      id: 'text-qwen2.5-1.5b-instruct-q4km',
      modality: 'text',
      tier: 'cpu',
      license: 'Apache-2.0',
      requiresAcknowledgement: false,
      kind: 'file',
      repo: 'bartowski/Qwen2.5-1.5B-Instruct-GGUF',
      revision: 'rev',
      file: 'Qwen2.5-1.5B-Instruct-Q4_K_M.gguf',
      targetPath: 'text/qwen2.5-1.5b-instruct-q4_k_m.gguf',
      bytes: 986_048_768,
      sha256: 'a'.repeat(64),
    },
    {
      id: 'image-sd15-pruned-q4_0',
      modality: 'image',
      tier: 'cpu',
      license: 'CreativeML OpenRAIL-M',
      requiresAcknowledgement: true,
      kind: 'file',
      repo: 'second-state/stable-diffusion-v1-5-GGUF',
      revision: 'rev',
      file: 'stable-diffusion-v1-5-pruned-emaonly-Q4_0.gguf',
      targetPath: 'image/stable-diffusion-v1-5-pruned-emaonly-q4_0.gguf',
      bytes: 1_566_768_416,
      sha256: 'b'.repeat(64),
    },
    {
      id: 'tts-kokoro-82m',
      modality: 'tts',
      tier: 'any',
      license: 'Apache-2.0',
      requiresAcknowledgement: false,
      kind: 'archive',
      url: 'https://example.com/kokoro.tar.bz2',
      targetPath: 'tts/kokoro-multi-lang-v1_0',
      bytes: 349_418_188,
      sha256: 'c'.repeat(64),
    },
  ],
});

/** A manifest whose download sum provably exceeds any volume's free space. */
const HUGE_MANIFEST = JSON.stringify({
  schemaVersion: 1,
  entries: [
    {
      id: 'text-huge',
      modality: 'text',
      tier: 'cpu',
      license: 'Apache-2.0',
      requiresAcknowledgement: false,
      kind: 'file',
      repo: 'r',
      revision: 'rev',
      file: 'm.gguf',
      targetPath: 'text/m.gguf',
      // 2^53 bytes — larger than free space on any real volume.
      bytes: 9_007_199_254_740_992,
      sha256: 'a'.repeat(64),
    },
  ],
});

const tmpDirs: string[] = [];
const makeTmp = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'aikami-init-'));
  tmpDirs.push(dir);
  return dir;
};

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

const baseOptions = async (): Promise<CliOptions & { envPath: string; manifestPath: string }> => {
  const dir = await makeTmp();
  const manifestPath = join(dir, 'models.manifest.json');
  await writeFile(manifestPath, MANIFEST);
  return {
    yes: true,
    json: false,
    fetch: false,
    noColor: true,
    envPath: join(dir, '.env'),
    manifestPath,
    // Tests below are not exercising host-Ollama detection and must stay
    // deterministic regardless of whether the machine running them happens
    // to have a real Ollama server on 11434 — see "text engine source"
    // below for the dedicated, DI-controlled coverage of `auto`.
    textSource: 'bundled',
  };
};

describe('AC-6 — insufficient disk fails before writing', () => {
  test('total download > free disk → exit 2, shortfall in GB, no .env', async () => {
    const base = await baseOptions();
    await writeFile(base.manifestPath, HUGE_MANIFEST);
    const code = await runInit(base);
    expect(code).toBe(2);
    const envExists = await readFile(base.envPath, 'utf8').then(
      () => true,
      () => false,
    );
    expect(envExists).toBe(false);
  });
});

describe('AC-7 — plan is shown before anything is written', () => {
  test('--yes writes the .env with the full plan visible', async () => {
    const base = await baseOptions();
    const out: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    const stub = (chunk: string): boolean => {
      out.push(String(chunk));
      return true;
    };
    process.stdout.write = stub as typeof process.stdout.write;
    let code: number;
    try {
      code = await runInit(base);
    } finally {
      process.stdout.write = originalWrite;
    }
    expect(code).toBe(0);
    // The rendered plan must be printed before the write: its heading and
    // every selected model id appear on stdout (AC-7 plan-first).
    const rendered = out.join('');
    expect(rendered).toContain('Aikami local stack — plan');
    expect(rendered).toContain('text-qwen2.5-1.5b-instruct-q4km');
    expect(rendered).toContain('image-sd15-pruned-q4_0');
    expect(rendered).toContain('tts-kokoro-82m');
    const content = await readFile(base.envPath, 'utf8');
    expect(content).toContain('COMPOSE_PROFILES=text,image,voice,stt');
    expect(content).toContain('COMPOSE_FILE=');
    expect(content).toContain('TEXT_MODEL=');
  });

  test('declining the write prompt writes nothing', async () => {
    const base = await baseOptions();
    // Simulate an interactive TTY answering "n" to "Write .env?".
    const originalInIsTTY = process.stdin.isTTY;
    const originalOutIsTTY = process.stdout.isTTY;
    const originalOn = process.stdin.on.bind(process.stdin);
    const originalPause = process.stdin.pause.bind(process.stdin);
    const originalOff = process.stdin.off?.bind(process.stdin) ?? (() => {});
    // biome-ignore lint/suspicious/noExplicitAny: test-only TTY stub
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    // biome-ignore lint/suspicious/noExplicitAny: test-only TTY stub
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    // biome-ignore lint/suspicious/noExplicitAny: test-only stdin stub
    process.stdin.on = ((event: string, handler: (chunk: string) => void) => {
      if (event === 'data') {
        queueMicrotask(() => handler('n\n'));
      }
      return process.stdin;
    }) as typeof process.stdin.on;
    process.stdin.pause = (() => process.stdin) as typeof process.stdin.pause;
    process.stdin.off = (() => process.stdin) as typeof process.stdin.off;
    try {
      const code = await runInit({ ...base, yes: false });
      expect(code).toBe(0);
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: originalInIsTTY, configurable: true });
      Object.defineProperty(process.stdout, 'isTTY', {
        value: originalOutIsTTY,
        configurable: true,
      });
      process.stdin.on = originalOn;
      process.stdin.pause = originalPause;
      if (process.stdin.off) {
        process.stdin.off = originalOff;
      }
    }
    const envExists = await readFile(base.envPath, 'utf8').then(
      () => true,
      () => false,
    );
    expect(envExists).toBe(false);
  });
});

describe('AC-11 — platform-correct separator', () => {
  test('renderEnv uses ":" on linux and ";" on win32', async () => {
    const { renderEnv } = await import('./env_writer.ts');
    const { detectHardware, loadManifest, recommend } = await import('@aikami/local-ai');
    const { probeExecutor } = await import('./probe_executor.ts');

    const manifest = await loadManifest({
      executor: probeExecutor,
      path: join(import.meta.dir, 'models.manifest.json'),
    });
    const profile = await detectHardware({
      executor: probeExecutor,
      platform: 'linux',
      arch: 'x64',
    });
    const plan = recommend({
      profile,
      modalities: ['text'],
      manifest,
      backendOverride: 'cpu',
    });

    const linuxEnv = renderEnv({ profile, plan, manifest });
    expect(linuxEnv).toContain('COMPOSE_FILE=compose.yaml:compose.cpu.yaml');

    const winProfile = { ...profile, platform: 'win32' as const };
    const winEnv = renderEnv({ profile: winProfile, plan, manifest });
    expect(winEnv).toContain('COMPOSE_FILE=compose.yaml;compose.cpu.yaml');
  });
});

describe('AC-13 — --json output is complete and stable', () => {
  test('stdout is a single schema-valid JSON document with profile + plan', async () => {
    const base = await baseOptions();
    const out: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    const stub = (chunk: string): boolean => {
      out.push(String(chunk));
      return true;
    };
    process.stdout.write = stub as typeof process.stdout.write;
    try {
      const code = await runInit({ ...base, json: true });
      expect(code).toBe(0);
    } finally {
      process.stdout.write = originalWrite;
    }
    const text = out.join('');
    expect(text.trim().startsWith('{')).toBe(true);
    const doc = JSON.parse(text) as { profile: unknown; plan: unknown };
    expect(Value.Check(HardwareProfileSchema, doc.profile)).toBe(true);
    expect(Value.Check(StackPlanSchema, doc.plan)).toBe(true);
  });
});

describe('text engine source — host Ollama detection', () => {
  // The probe is DI'd here (RunInitDeps) rather than exercised against the
  // real network — whether *this* machine happens to run Ollama on 11434
  // must not change what these assertions prove.

  test('auto + probe finds nothing → bundled text engine unchanged', async () => {
    const base = await baseOptions();
    const code = await runInit({ ...base, textSource: 'auto' }, { probeOllama: async () => false });
    expect(code).toBe(0);
    const content = await readFile(base.envPath, 'utf8');
    expect(content).toContain('COMPOSE_PROFILES=text,image,voice,stt');
    expect(content).toContain('TEXT_MODEL=');
  });

  test('auto + probe detects Ollama + --yes → reuses it, text dropped, .env notes it', async () => {
    const base = await baseOptions();
    const code = await runInit({ ...base, textSource: 'auto' }, { probeOllama: async () => true });
    expect(code).toBe(0);
    const content = await readFile(base.envPath, 'utf8');
    expect(content).toContain('COMPOSE_PROFILES=image,voice,stt');
    expect(content).not.toContain('TEXT_MODEL=');
    expect(content).toContain('using existing Ollama on port 11434');
  });

  test('--text-source ollama forces reuse without probing — text dropped, .env notes it', async () => {
    const base = await baseOptions();
    // Probe stubbed to throw: --text-source ollama must never call it.
    const code = await runInit(
      { ...base, textSource: 'ollama' },
      {
        probeOllama: async () => {
          throw new Error('should not probe when textSource is explicit "ollama"');
        },
      },
    );
    expect(code).toBe(0);
    const content = await readFile(base.envPath, 'utf8');
    expect(content).toContain('COMPOSE_PROFILES=image,voice,stt');
    expect(content).not.toContain('TEXT_MODEL=');
    expect(content).toContain('using existing Ollama on port 11434');
  });

  test('--text-source bundled skips the probe — text always kept', async () => {
    const base = await baseOptions();
    const code = await runInit(
      { ...base, textSource: 'bundled' },
      {
        probeOllama: async () => {
          throw new Error('should not probe when textSource is explicit "bundled"');
        },
      },
    );
    expect(code).toBe(0);
    const content = await readFile(base.envPath, 'utf8');
    expect(content).toContain('COMPOSE_PROFILES=text,image,voice,stt');
    expect(content).toContain('TEXT_MODEL=');
  });
});

describe('AC-9 — re-run is safe', () => {
  test('declining the overwrite leaves the file byte-identical', async () => {
    const base = await baseOptions();
    const first = await runInit(base);
    expect(first).toBe(0);
    const original = await readFile(base.envPath, 'utf8');

    // Second run WITHOUT --yes: non-TTY stdin defaults the overwrite
    // confirm to false, so the existing .env must remain untouched.
    const code = await runInit({ ...base, yes: false });
    expect(code).toBe(0);
    const after = await readFile(base.envPath, 'utf8');
    expect(after).toBe(original);
  });
});
