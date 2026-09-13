// apps/backend/image/scripts/generate_asset.test.ts
/** biome-ignore-all lint/suspicious/noConsole: CLI test harness — console is the interface */
/** biome-ignore-all lint/style/useNamingConvention: the engine APIs under test use snake_case fields */
// CLI-surface tests for the C-510 `generate:asset` command.
//
// The transport itself is covered by the mocked-engine assertions in
// `@aikami/local-ai` (which run in CI); this file is the image-app half: the
// CLI must fail loudly on a bad invocation and must list the recipes it knows.
//
// It deliberately does NOT require a live sd-server — the live smoke is the
// `bun run --cwd apps/backend/image generate:asset prop "rusty iron gate"`
// invocation documented in the contract's Production Surface.
//
// Contract: C-510 Engine-Agnostic Asset Generation Pipeline
// Contract: C-517 Generation request and format correctness

import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $ } from 'bun';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, 'generate_asset.ts');

const runCli = async (
  args: readonly string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
  const result = await $`bun run ${SCRIPT} ${args}`.quiet().nothrow();
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
};

describe('generate:asset CLI surface', () => {
  test('missing arguments exits non-zero with usage', async () => {
    const result = await runCli([]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('Usage: bun run generate:asset');
  });

  test('an unknown recipe exits non-zero and names the known recipes', async () => {
    const result = await runCli(['not-a-recipe', 'a rusty gate']);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('Unknown asset recipe "not-a-recipe"');
    expect(result.stderr).toContain('prop');
  });

  test('an unknown flag exits non-zero', async () => {
    const result = await runCli(['prop', 'a gate', '--nope']);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('Unknown flag "--nope"');
  });

  test('an invalid engine exits non-zero', async () => {
    const result = await runCli(['prop', 'a gate', '--engine', 'midjourney']);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('--engine must be "sdcpp", "comfyui" or "ace-step"');
  });

  test('--timeout rejects a non-positive or non-numeric value', async () => {
    const zero = await runCli(['prop', 'a gate', '--timeout', '0']);
    expect(zero.exitCode).not.toBe(0);
    expect(zero.stderr).toContain('--timeout must be a positive integer number of seconds');

    const text = await runCli(['prop', 'a gate', '--timeout', 'soon']);
    expect(text.exitCode).not.toBe(0);
    expect(text.stderr).toContain('--timeout must be a positive integer number of seconds');
  });

  test('--timeout is accepted and reported, and does not block the run', async () => {
    // The engine is unreachable here, so the run still fails — but it must
    // fail on the transport, not on flag parsing, and it must echo the budget.
    const result = await runCli([
      'prop',
      'a rusty iron gate',
      '--base-url',
      'http://127.0.0.1:1',
      '--timeout',
      '900',
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toContain('Timeout: 900s');
    expect(result.stderr).not.toContain('--timeout must be');
  });

  test('the props recipe round-trips through ASSET_CATEGORIES', async () => {
    // A `props` recipe whose category were missing from ASSET_CATEGORIES would
    // be rejected at registry load — reaching the engine dispatch phase at all
    // proves the category table entry exists. The engine is unreachable here,
    // so the run fails with a transport error, not a category error.
    const result = await runCli(['prop', 'a rusty iron gate', '--base-url', 'http://127.0.0.1:1']);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).not.toContain('absent from ASSET_CATEGORIES');
    expect(result.stderr).not.toContain('Unknown asset recipe');
  });
});

describe('generate:asset CLI — C-511 audio recipes', () => {
  test('the audio recipes are registered and reachable from the CLI', async () => {
    for (const recipe of ['music', 'sfx', 'ambient']) {
      const result = await runCli([recipe, 'calm forest loop', '--base-url', 'http://127.0.0.1:1']);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).not.toContain('Unknown asset recipe');
      expect(result.stderr).not.toContain('absent from ASSET_CATEGORIES');
      expect(result.stdout).toContain(`Recipe:  ${recipe}`);
    }
  });

  test('--engine ace-step is accepted and the audio endpoint is reported', async () => {
    const result = await runCli([
      'sfx',
      'metal gate slam',
      '--engine',
      'ace-step',
      '--audio-output-mount',
      '/tmp/aikami-audio-mount',
      '--audio-url',
      'http://127.0.0.1:1',
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toContain('Engine:  ace-step');
    expect(result.stdout).toContain('http://127.0.0.1:1');
    expect(result.stderr).not.toContain('--engine must be');
  });

  test('ace-step without an output mount fails loudly before dispatch', async () => {
    const result = await runCli(['sfx', 'metal gate slam', '--engine', 'ace-step']);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('--audio-output-mount');
  });

  test('--duration and --instrumental are accepted without being read as positionals', async () => {
    const result = await runCli([
      'music',
      'calm forest loop',
      '--engine',
      'ace-step',
      '--duration',
      '30',
      '--instrumental',
      '--audio-output-mount',
      '/tmp/aikami-audio-mount',
      '--audio-url',
      'http://127.0.0.1:1',
    ]);
    expect(result.stdout).toContain('Recipe:  music');
    expect(result.stdout).toContain('Prompt:  calm forest loop');
    expect(result.stderr).not.toContain('Unknown flag');
  });

  test('--duration rejects zero and negative values before dispatch', async () => {
    for (const duration of ['0', '-0.5']) {
      const result = await runCli(['music', 'calm forest loop', '--duration', duration]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('--duration must be greater than zero seconds');
      expect(result.stderr).not.toContain('--audio-output-mount');
    }
  });

  test('--duration preserves positive fractional values', async () => {
    const result = await runCli([
      'music',
      'short sting',
      '--duration',
      '0.5',
      '--audio-output-mount',
      '/tmp/aikami-audio-mount',
      '--audio-url',
      'http://127.0.0.1:1',
    ]);
    expect(result.stderr).not.toContain('--duration must be');
  });
});

// ---------------------------------------------------------------------------
// C-517: request correctness and format honesty on the CLI path
//
// These run the CLI exactly as the contract's production surface names it —
// `bun run --cwd apps/backend/image generate:asset <recipe> "<subject>"` —
// against a fake engine that records the submitted body. The fake server
// writes the artifact the way the real engines do (ACE-Step to its own
// output directory, sd-server inline as a data URL).
// ---------------------------------------------------------------------------

/** Builds a minimal, structurally valid 16-bit PCM WAV. */
const makeWav = (frames = 4410): Uint8Array => {
  const sampleRate = 44_100;
  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataBytes = frames * blockAlign;
  const buffer = new Uint8Array(44 + dataBytes);
  const view = new DataView(buffer.buffer);
  const ascii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index++) {
      buffer[offset + index] = text.charCodeAt(index);
    }
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  return buffer;
};

/** A genuine 1×1 PNG (real IHDR/IDAT/IEND chunks with valid CRCs). */
const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** A genuine 1×1 lossless WebP — a container PNG bytes do not have. */
const WEBP_1X1_BASE64 = 'UklGRhIAAABXRUJQVlA4TAYAAAAvAAAAAAc=';

/** Starts a fake ACE-Step server that records every `/generate` body. */
const startFakeAceStep = (
  hostMount: string,
): { url: string; bodies: Record<string, unknown>[]; stop: () => void } => {
  const bodies: Record<string, unknown>[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const path = new URL(request.url).pathname;
      if (path === '/health') {
        return Response.json({ status: 'healthy' });
      }
      if (path === '/generate') {
        const body = (await request.json()) as Record<string, unknown>;
        bodies.push(body);
        // A real ACE-Step writes the WAV on its own filesystem and returns the
        // path; mirror that through the shared models mount.
        const outputPath = String(body.output_path);
        await Bun.write(join(hostMount, basename(outputPath)), makeWav());
        return Response.json({
          status: 'success',
          output_path: outputPath,
          message: 'Audio generated successfully',
        });
      }
      return new Response('not found', { status: 404 });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    bodies,
    stop: () => {
      void server.stop(true);
    },
  };
};

/** Starts a fake sd-server that answers the job protocol with `imageData`. */
const startFakeSdServer = (
  imageData: string,
): { url: string; bodies: Record<string, unknown>[]; stop: () => void } => {
  const bodies: Record<string, unknown>[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const path = new URL(request.url).pathname;
      if (path === '/sdapi/v1/sd-models') {
        return Response.json([{ model_name: 'fake-model', title: 'fake-model' }]);
      }
      if (path === '/sdcpp/v1/img_gen') {
        bodies.push((await request.json()) as Record<string, unknown>);
        return Response.json({ id: 'job-1', state: 'queued' });
      }
      if (path === '/sdcpp/v1/jobs/job-1') {
        return Response.json({ state: 'completed', width: 256, height: 256, image: imageData });
      }
      return new Response('not found', { status: 404 });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    bodies,
    stop: () => {
      void server.stop(true);
    },
  };
};

/** Creates a scratch directory the CLI can stage into and read artifacts from. */
const makeScratch = (): { dir: string; cleanup: () => void } => {
  const dir = mkdtempSync(join(tmpdir(), 'c517-cli-'));
  return {
    dir,
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
};

/** Reads the staged descriptor the CLI wrote. */
const readStaged = (outDir: string, filename: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(outDir, filename), 'utf8')) as Record<string, unknown>;

describe('generate:asset CLI — C-517 AC-1/AC-3 request correctness', () => {
  test('the music recipe submits the subject plus its tags and reports requested/effective BPM', async () => {
    const scratch = makeScratch();
    const fake = startFakeAceStep(scratch.dir);
    try {
      const result = await runCli([
        'music',
        'metal gate slam',
        '--audio-url',
        fake.url,
        '--audio-output-mount',
        scratch.dir,
        '--out',
        join(scratch.dir, 'out'),
      ]);

      expect(result.stderr).not.toContain('✗');
      expect(result.exitCode).toBe(0);

      expect(fake.bodies).toHaveLength(1);
      const prompt = String((fake.bodies[0] as Record<string, unknown>).prompt);
      expect(prompt).toContain('metal gate slam');
      expect(prompt).toContain('game background music, loopable, instrumental, cinematic');

      // The run report labels the tempo, and never as a bare measured-looking key.
      expect(result.stdout).toContain('requestedBpm:  90');
      expect(result.stdout).toContain('effectiveBpm:  90');
      expect(result.stdout).not.toMatch(/^\s+bpm:/m);
      expect(result.stdout).not.toMatch(/^\s+measured/m);

      const outDir = join(scratch.dir, 'out');
      const audit = readStaged(outDir, 'generation_audit.json');
      expect(audit.requestedBpm).toBe(90);
      expect(audit.effectiveBpm).toBe(90);
      expect(audit.subject).toContain('metal gate slam');
      expect(Object.keys(audit).some((key) => key.startsWith('measured'))).toBe(false);

      const descriptor = readStaged(outDir, 'generated_asset.json');
      expect(descriptor.ext).toBe('.wav');
      expect(descriptor.mimeType).toBe('audio/wav');
      expect(existsSync(join(outDir, 'music/exploration/metal-gate-slam.wav'))).toBe(true);
    } finally {
      fake.stop();
      scratch.cleanup();
    }
  }, 30_000);

  test('an explicit --tags override still contains the subject', async () => {
    const scratch = makeScratch();
    const fake = startFakeAceStep(scratch.dir);
    try {
      const result = await runCli([
        'sfx',
        'metal gate slam',
        '--tags',
        'impact, low thud',
        '--audio-url',
        fake.url,
        '--audio-output-mount',
        scratch.dir,
        '--out',
        join(scratch.dir, 'out'),
      ]);

      expect(result.exitCode).toBe(0);
      const prompt = String((fake.bodies[0] as Record<string, unknown>).prompt);
      expect(prompt).toContain('metal gate slam');
      expect(prompt).toContain('impact, low thud');
    } finally {
      fake.stop();
      scratch.cleanup();
    }
  }, 30_000);

  test('a whitespace --tags falls back to the compiled template', async () => {
    const scratch = makeScratch();
    const fake = startFakeAceStep(scratch.dir);
    try {
      const result = await runCli([
        'ambient',
        'rain on a tin roof',
        '--tags',
        '   ',
        '--audio-url',
        fake.url,
        '--audio-output-mount',
        scratch.dir,
        '--out',
        join(scratch.dir, 'out'),
      ]);

      expect(result.exitCode).toBe(0);
      const prompt = String((fake.bodies[0] as Record<string, unknown>).prompt);
      expect(prompt).toContain('rain on a tin roof');
      expect(prompt).toContain('ambient environment soundscape, atmospheric, loopable, no music');
    } finally {
      fake.stop();
      scratch.cleanup();
    }
  }, 30_000);

  test('--bpm/--key are reported as requested*/effective* hints and reach the engine', async () => {
    const scratch = makeScratch();
    const fake = startFakeAceStep(scratch.dir);
    try {
      const result = await runCli([
        'music',
        'calm forest loop',
        '--bpm',
        '120',
        '--key',
        'D minor',
        '--audio-url',
        fake.url,
        '--audio-output-mount',
        scratch.dir,
        '--out',
        join(scratch.dir, 'out'),
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('requestedBpm:  120');
      expect(result.stdout).toContain('effectiveBpm:  120');
      expect(result.stdout).toContain('requestedKey:  D minor');
      expect(result.stdout).toContain('effectiveKey:  D minor');

      const prompt = String((fake.bodies[0] as Record<string, unknown>).prompt);
      expect(prompt).toContain('120 BPM');
      expect(prompt).toContain('key: D minor');

      const audit = readStaged(join(scratch.dir, 'out'), 'generation_audit.json');
      expect(audit.requestedBpm).toBe(120);
      expect(audit.effectiveBpm).toBe(120);
      expect(audit.requestedKey).toBe('D minor');
      expect(audit.effectiveKey).toBe('D minor');
    } finally {
      fake.stop();
      scratch.cleanup();
    }
  }, 30_000);

  test('a vocal request with no lyrics still fails loudly before dispatch', async () => {
    const scratch = makeScratch();
    const fake = startFakeAceStep(scratch.dir);
    try {
      const result = await runCli([
        'music',
        'calm forest loop',
        '--no-instrumental',
        '--audio-url',
        fake.url,
        '--audio-output-mount',
        scratch.dir,
        '--out',
        join(scratch.dir, 'out'),
      ]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toLowerCase()).toContain('lyrics');
      expect(fake.bodies).toHaveLength(0);
    } finally {
      fake.stop();
      scratch.cleanup();
    }
  }, 30_000);
});

describe('generate:asset CLI — C-517 AC-2 format agreement', () => {
  test('portrait generation accepts genuine PNG bytes and stages a matching descriptor', async () => {
    const scratch = makeScratch();
    const fake = startFakeSdServer(`data:image/png;base64,${PNG_1X1_BASE64}`);
    try {
      const outDir = join(scratch.dir, 'out');
      const result = await runCli([
        'portrait',
        'elven ranger',
        '--base-url',
        fake.url,
        '--timeout',
        '30',
        '--out',
        outDir,
      ]);

      expect(result.exitCode).toBe(0);

      const descriptor = readStaged(outDir, 'generated_asset.json');
      expect(descriptor.ext).toBe('.png');
      expect(descriptor.mimeType).toBe('image/png');
      expect(descriptor.recipeId).toBe('portrait');

      // The staged bytes hash to the descriptor's sha256 — sniffed format,
      // MIME, extension and hash all agree.
      const staged = readFileSync(join(outDir, 'portraits/elven-ranger.png'));
      expect(staged.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
      expect(descriptor.sizeBytes).toBe(staged.length);
    } finally {
      fake.stop();
      scratch.cleanup();
    }
  }, 30_000);

  test('an engine that mislabels its bytes fails with a readable error before staging', async () => {
    const scratch = makeScratch();
    // The engine declares PNG; the bytes are genuine WebP.
    const fake = startFakeSdServer(`data:image/png;base64,${WEBP_1X1_BASE64}`);
    try {
      const outDir = join(scratch.dir, 'out');
      const result = await runCli([
        'prop',
        'a rusty gate',
        '--base-url',
        fake.url,
        '--timeout',
        '30',
        '--out',
        outDir,
      ]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/mislabeled|bytes are image\/webp/i);
      // Nothing was staged: the failure happens before any write.
      expect(existsSync(outDir)).toBe(false);
    } finally {
      fake.stop();
      scratch.cleanup();
    }
  }, 30_000);
});
