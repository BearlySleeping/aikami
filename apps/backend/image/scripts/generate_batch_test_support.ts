// apps/backend/image/scripts/generate_batch_test_support.ts
//
// C-519/C-520: the shared harness for the `generate:batch` production-surface
// tests — the CLI runner, the scratch-dir lifecycle, the fixture brief writer
// and a fake sd-server that records every generation it receives.
//
// Extracted so the C-519 and C-520 suites drive the *same* harness rather than
// two drifting copies, and so neither test module grows past the source-size
// budget on its own.
//
/** biome-ignore-all lint/suspicious/noConsole: test harness — console is the interface */
/** biome-ignore-all lint/style/useNamingConvention: fixture briefs and engine payloads use the brief schema's snake_case keys verbatim */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AssetBrief } from '@aikami/types';
import { $ } from 'bun';

export const __dirname = import.meta.dir;
export const SCRIPT = resolve(__dirname, 'generate_batch.ts');
export const REPO_ROOT = resolve(__dirname, '../../../..');
export const IMAGE_MANIFEST = resolve(__dirname, '../package.json');
export const GENERATING_ASSETS_GUIDE = resolve(
  REPO_ROOT,
  'apps/frontend/docs/src/content/docs/guides/generating-assets.mdx',
);
export const AUTHORED_BRIEF = resolve(REPO_ROOT, 'docs/plans/emberwatch_asset_brief.json');

/** A genuine 1×1 PNG. */
export const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export const scratchDirs: string[] = [];

export const makeScratch = (label: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `c519-cli-${label}-`));
  scratchDirs.push(dir);
  return dir;
};

/** Removes every scratch directory created by a test. */
export const cleanupScratch = (): void => {
  for (const dir of scratchDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
};

export const runCli = async (
  args: readonly string[],
  env: Record<string, string> = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
  const result = await $`bun run ${SCRIPT} ${args}`
    .quiet()
    .nothrow()
    .env({ ...process.env, ...env });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
};

/** Parses the CLI's stdout as JSON, failing loudly when it is not JSON. */
export const parseJson = (stdout: string): Record<string, unknown> => {
  try {
    return JSON.parse(stdout) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`stdout was not JSON: ${(error as Error).message}\n${stdout.slice(0, 400)}`);
  }
};

/** The recorded dispatches of a fake engine. */
export type FakeEngineLog = {
  readonly generations: Record<string, unknown>[];
  readonly maxInFlight: number;
};

/** Starts a fake sd-server that records every generation request. */
export const startFakeSdServer = (options?: {
  delayMs?: number;
  neverCompletes?: boolean;
  imageData?: string;
}): { url: string; log: FakeEngineLog; stop: () => void } => {
  const generations: Record<string, unknown>[] = [];
  const state = { inFlight: 0, maxInFlight: 0, dispatched: 0 };
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const path = new URL(request.url).pathname;
      if (path === '/sdapi/v1/sd-models') {
        return Response.json([{ model_name: 'fake-model', title: 'fake-model' }]);
      }
      if (path === '/sdcpp/v1/img_gen') {
        const body = (await request.json()) as Record<string, unknown>;
        generations.push(body);
        state.inFlight += 1;
        state.dispatched += 1;
        state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
        if (options?.delayMs !== undefined) {
          await Bun.sleep(options.delayMs);
        }
        state.inFlight -= 1;
        return Response.json({ id: `job-${state.dispatched}`, state: 'queued' });
      }
      if (path.startsWith('/sdcpp/v1/jobs/')) {
        if (options?.neverCompletes) {
          return Response.json({ state: 'processing', progress: 10 });
        }
        return Response.json({
          state: 'completed',
          width: 1,
          height: 1,
          image: options?.imageData ?? `data:image/png;base64,${PNG_1X1_BASE64}`,
        });
      }
      return new Response('not found', { status: 404 });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    log: {
      generations,
      get maxInFlight() {
        return state.maxInFlight;
      },
    },
    stop: () => {
      void server.stop(true);
    },
  };
};

/** Builds a fixture brief whose references resolve to real local bytes. */
export const writeFixtureBrief = (options: {
  dir: string;
  id?: string;
  items: readonly {
    id: string;
    subject: string;
    canvas: readonly [number, number];
    kind?: 'prop' | 'portrait';
  }[];
  references?: AssetBrief['references'];
}): string => {
  const brief: AssetBrief = {
    $schema: 'urn:aikami:asset-brief:1',
    format: 'aikami.asset-brief',
    formatVersion: 1,
    id: options.id ?? 'fixture-brief',
    status: 'proposed',
    baseline: {
      repository: 'aikami',
      commit: 'deadbeef',
      packId: 'emberwatch',
      packVersion: '4.2.0',
      reviewedAt: '2026-09-13',
    },
    execution: {
      defaultMode: 'plan',
      defaultPhase: 'slice',
      requiresRunnerContract: 'C-519',
      gpuConcurrency: 1,
      candidateLimitPerItem: 2,
      hostedBudgetUsd: 0,
      autoAccept: false,
      autoPublish: false,
      unresolvedReferencePolicy: 'block_required_inputs',
      providerFallbackPolicy: 'explicit_only',
    },
    style: {
      gridPixels: 32,
      view: 'top-down',
      palette: 'muted',
      lighting: 'soft',
      rules: ['no ground slab'],
    },
    audioDirection: {
      motif: 'three-note ward',
      voices: 'plucked strings',
      mixTargets: '-14 LUFS',
      loopReviewRepeats: 3,
      note: 'instrumental only',
    },
    preserve: {
      mapIds: ['village'],
      npcIds: ['village_elder'],
      questIds: ['fading_ward'],
      mapExtents: { village: [64, 48] },
      invariants: ['stable prop ids'],
    },
    reuseBeforeGenerate: ['accepted grass sources'],
    providerPreferences: {
      local_image_reference: ['existing_sdcpp_profile_if_required_capabilities_pass'],
    },
    experimentalProviders: [],
    preparationProfiles: { prop_alpha: 'native crop + true alpha inspection' },
    references: options.references ?? [],
    jobs: options.items.map((item) => ({
      id: item.id,
      phase: 'slice' as const,
      kind: item.kind ?? 'prop',
      action: 'generate_if_missing' as const,
      subject: item.subject,
      providerPreference: 'local_image_reference',
      preparationProfile: 'prop_alpha',
      referenceIds: [],
      candidateLimit: 2,
      dependsOn: [],
      binding: {
        kind: 'prop' as const,
        mapIds: ['village'],
        targetIds: [`village_${item.id}`],
        mode: 'proposed_pending_validation' as const,
        variant: null,
      },
      targetCanvas: [item.canvas[0], item.canvas[1]],
      audio: null,
      releaseGates: ['exact_hash_accepted'],
      status: 'planned' as const,
    })),
    summary: {
      sliceItems: options.items.length,
      expansionItems: 1,
      totalItems: options.items.length + 1,
      maxCandidates: 4,
      maxRequestedAudioSecondsPerCandidatePass: 0,
    },
    releaseGates: ['exact_hash_accepted'],
    notes: ['fixture brief'],
  };
  const path = join(options.dir, `${brief.id}.json`);
  writeFileSync(path, `${JSON.stringify(brief, null, 2)}\n`);
  return path;
};

/** Reads a job record from the run store. */
export const readJobs = (runsDir: string, runId: string): Record<string, unknown>[] =>
  readdirSync(join(runsDir, runId, 'jobs'))
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(runsDir, runId, 'jobs', name), 'utf8')));

/** A recursive listing of a directory (path → sha256), for byte-identity checks. */
export const snapshotTree = async (dir: string): Promise<Record<string, string>> => {
  const snapshot: Record<string, string> = {};
  if (!existsSync(dir)) {
    return snapshot;
  }
  const walk = async (current: string): Promise<void> => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else {
        const bytes = new Uint8Array(readFileSync(path));
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        snapshot[path.slice(dir.length)] = Array.from(new Uint8Array(digest))
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join('');
      }
    }
  };
  await walk(dir);
  return snapshot;
};
