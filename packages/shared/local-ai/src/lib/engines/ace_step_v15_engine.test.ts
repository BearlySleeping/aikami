// packages/shared/local-ai/src/lib/engines/ace_step_v15_engine.test.ts
// biome-ignore-all lint/style/useNamingConvention: ACE-Step v1.5 uses snake_case wire fields
//
// C-521 AC-1: the v1.5 adapter follows the release_task → query_result → scoped
// retrieval flow, records the native task id immediately, requests its output
// format explicitly, and refuses a server-reported artifact reference that is
// outside the runner's owned bounds.
//
// Contract: C-521 Music and SFX generation with audio preparation

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { GenerationRequest } from '@aikami/types';
import {
  ACE_STEP_V15_QUERY_FAILED,
  ACE_STEP_V15_QUERY_QUEUED,
  ACE_STEP_V15_QUERY_RUNNING,
  ACE_STEP_V15_QUERY_SUCCEEDED_ESCAPING_PATH,
  ACE_STEP_V15_QUERY_SUCCEEDED_JSON,
  ACE_STEP_V15_QUERY_SUCCEEDED_PATH,
  ACE_STEP_V15_QUERY_UNKNOWN_STATUS,
  ACE_STEP_V15_RELEASE_TASK_RESPONSE,
} from '../__fixtures__/ace_step_v15_protocol.ts';
import {
  ACE_STEP_V15_TASK_STATUS,
  AceStepV15Error,
  AceStepV15GenerationEngine,
  checkArtifactReference,
} from './ace_step_v15_engine.ts';

const BASE_URL = 'http://127.0.0.1:8091';
const ARTIFACT_ROOT = '/models/audio/v15/output';
const WAV_BYTES = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);

const audioRequest = (overrides: Partial<GenerationRequest> = {}): GenerationRequest => ({
  modality: 'audio',
  positivePrompt: 'tense gate-slam impact, brass hit',
  durationSeconds: 2,
  ...overrides,
});

const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  }) as Response;

describe('AceStepV15GenerationEngine (C-521 AC-1)', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    mock.restore();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  /** Installs a fetch mock that walks the recorded v1.5 conversation. */
  const mockServer = (options: {
    pollResponses: readonly unknown[];
    releaseResponse?: unknown;
  }): {
    releaseBodies: Record<string, unknown>[];
    queriedTaskIds: string[];
    requestInits: RequestInit[];
  } => {
    const releaseBodies: Record<string, unknown>[] = [];
    const queriedTaskIds: string[] = [];
    const requestInits: RequestInit[] = [];
    let pollIndex = 0;
    globalThis.fetch = mock((url: string, init: RequestInit): Promise<Response> => {
      requestInits.push(init);
      if (url.endsWith('/release_task')) {
        releaseBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return Promise.resolve(
          jsonResponse(options.releaseResponse ?? ACE_STEP_V15_RELEASE_TASK_RESPONSE),
        );
      }
      if (url.endsWith('/query_result')) {
        const body = JSON.parse(String(init.body)) as { task_id_list?: string[] };
        queriedTaskIds.push(...(body.task_id_list ?? []));
        const response =
          options.pollResponses[Math.min(pollIndex, options.pollResponses.length - 1)];
        pollIndex += 1;
        return Promise.resolve(jsonResponse(response));
      }
      return Promise.resolve(jsonResponse({}, 404));
    });
    return { releaseBodies, queriedTaskIds, requestInits };
  };

  const makeEngine = (
    overrides: Partial<ConstructorParameters<typeof AceStepV15GenerationEngine>[0]> = {},
  ): AceStepV15GenerationEngine =>
    new AceStepV15GenerationEngine({
      baseUrl: BASE_URL,
      allowedArtifactRoots: [ARTIFACT_ROOT],
      pollIntervalMs: 1,
      fetchArtifact: async () => WAV_BYTES,
      ...overrides,
    });

  test('walks release_task → query_result → scoped retrieval and records the native task id', async () => {
    const server = mockServer({
      pollResponses: [
        ACE_STEP_V15_QUERY_QUEUED,
        ACE_STEP_V15_QUERY_RUNNING,
        ACE_STEP_V15_QUERY_SUCCEEDED_PATH,
      ],
    });
    const engine = makeEngine();
    const result = await engine.generate(audioRequest());

    expect(result.bytes).toEqual(WAV_BYTES);
    expect(result.mimeType).toBe('audio/wav');
    expect(result.metadata.nativeTaskId).toBe('v15-task-7f3c1a');
    expect(result.metadata.profile).toBe('ace-step-v15');
    expect(engine.nativeTaskIds).toEqual(['v15-task-7f3c1a']);
    expect(server.queriedTaskIds).toEqual([
      'v15-task-7f3c1a',
      'v15-task-7f3c1a',
      'v15-task-7f3c1a',
    ]);
    expect(server.requestInits.every((init) => init.redirect === 'error')).toBe(true);
  });

  test('preserves lyrics unless instrumental is explicitly true', async () => {
    const lyrical = mockServer({ pollResponses: [ACE_STEP_V15_QUERY_SUCCEEDED_PATH] });
    await makeEngine().generate(audioRequest({ lyrics: 'Hold the village gate' }));
    expect(lyrical.releaseBodies[0]?.lyrics).toBe('Hold the village gate');

    const instrumental = mockServer({ pollResponses: [ACE_STEP_V15_QUERY_SUCCEEDED_PATH] });
    await makeEngine().generate(
      audioRequest({ lyrics: 'This must not be emitted', instrumental: true }),
    );
    expect(instrumental.releaseBodies[0]?.lyrics).toBe('[inst]');
  });

  test('the compiled payload carries the subject and the recipe tags together', async () => {
    const server = mockServer({ pollResponses: [ACE_STEP_V15_QUERY_SUCCEEDED_PATH] });
    await makeEngine().generate(
      audioRequest({
        positivePrompt: 'a guarded gate slam',
        tags: 'sfx, impact, no music',
        bpm: 120,
        key: 'D minor',
      }),
    );
    const body = server.releaseBodies[0] as Record<string, unknown>;
    const prompt = String(body.prompt);
    expect(prompt).toContain('a guarded gate slam');
    expect(prompt).toContain('sfx, impact, no music');
    expect(prompt).toContain('120 BPM');
    expect(prompt).toContain('key: D minor');
  });

  test('the output format is requested explicitly, never left to the API default', async () => {
    const server = mockServer({ pollResponses: [ACE_STEP_V15_QUERY_SUCCEEDED_PATH] });
    await makeEngine({ outputFormat: 'flac' }).generate(audioRequest());
    expect((server.releaseBodies[0] as Record<string, unknown>).output_format).toBe('flac');
  });

  test('progress from query_result reaches the caller', async () => {
    mockServer({
      pollResponses: [ACE_STEP_V15_QUERY_RUNNING, ACE_STEP_V15_QUERY_SUCCEEDED_PATH],
    });
    const fractions: number[] = [];
    await makeEngine().generate(audioRequest(), {
      onProgress: (progress) => fractions.push(progress.fraction),
    });
    expect(fractions).toContain(0.5);
    expect(fractions[fractions.length - 1]).toBe(1);
  });

  test('a JSON-blob result is read and its reported format is honoured', async () => {
    mockServer({ pollResponses: [ACE_STEP_V15_QUERY_SUCCEEDED_JSON] });
    const result = await makeEngine().generate(audioRequest());
    expect(result.mimeType).toBe('audio/flac');
    expect(result.metadata.outputFormat).toBe('flac');
  });

  test('a reference outside the artifact roots is refused with a typed reason', async () => {
    mockServer({ pollResponses: [ACE_STEP_V15_QUERY_SUCCEEDED_ESCAPING_PATH] });
    const engine = makeEngine();
    let caught: unknown;
    try {
      await engine.generate(audioRequest());
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AceStepV15Error);
    expect((caught as AceStepV15Error).code).toBe('artifact_reference_rejected');
    // The native id was recorded even though the run failed — the job is
    // reportable rather than lost.
    expect(engine.nativeTaskIds).toEqual(['v15-task-7f3c1a']);
  });

  test('a failed native task reports the server reason and is not retried', async () => {
    const server = mockServer({ pollResponses: [ACE_STEP_V15_QUERY_FAILED] });
    let caught: unknown;
    try {
      await makeEngine().generate(audioRequest());
    } catch (error) {
      caught = error;
    }
    expect((caught as AceStepV15Error).code).toBe('task_failed');
    expect(String((caught as Error).message)).toContain('CUDA out of memory');
    expect(server.releaseBodies).toHaveLength(1);
  });

  test('a status outside the recorded table fails loudly instead of polling forever', async () => {
    mockServer({ pollResponses: [ACE_STEP_V15_QUERY_UNKNOWN_STATUS] });
    let caught: unknown;
    try {
      await makeEngine().generate(audioRequest());
    } catch (error) {
      caught = error;
    }
    expect((caught as AceStepV15Error).code).toBe('unknown_task_status');
  });

  test('a poll deadline reports that the wait stopped without claiming cancellation', async () => {
    mockServer({ pollResponses: [ACE_STEP_V15_QUERY_RUNNING] });
    let clock = 0;
    const engine = makeEngine({
      pollDeadlineMs: 50,
      now: () => clock,
      sleep: async () => {
        clock += 100;
      },
    });
    let caught: unknown;
    try {
      await engine.generate(audioRequest());
    } catch (error) {
      caught = error;
    }
    expect((caught as AceStepV15Error).code).toBe('poll_timeout');
    expect(String((caught as Error).message)).toContain('NOT cancelled');
    // The adapter must not advertise a cancel it cannot confirm.
    expect(engine.capabilities.cancel).toBe(false);
  });

  test('an oversized artifact is refused', async () => {
    mockServer({ pollResponses: [ACE_STEP_V15_QUERY_SUCCEEDED_PATH] });
    const engine = makeEngine({
      maxArtifactBytes: 4,
      fetchArtifact: async () => new Uint8Array(16),
    });
    let caught: unknown;
    try {
      await engine.generate(audioRequest());
    } catch (error) {
      caught = error;
    }
    expect((caught as AceStepV15Error).code).toBe('artifact_too_large');
  });

  test('an empty artifact is refused rather than saved as a silent cue', async () => {
    mockServer({ pollResponses: [ACE_STEP_V15_QUERY_SUCCEEDED_PATH] });
    const engine = makeEngine({ fetchArtifact: async () => new Uint8Array(0) });
    let caught: unknown;
    try {
      await engine.generate(audioRequest());
    } catch (error) {
      caught = error;
    }
    expect((caught as AceStepV15Error).code).toBe('artifact_empty');
  });

  test('no fetcher configured means the server path never reaches a caller', async () => {
    mockServer({ pollResponses: [ACE_STEP_V15_QUERY_SUCCEEDED_PATH] });
    const engine = new AceStepV15GenerationEngine({
      baseUrl: BASE_URL,
      pollIntervalMs: 1,
      allowedArtifactRoots: [ARTIFACT_ROOT],
    });
    let caught: unknown;
    try {
      await engine.generate(audioRequest());
    } catch (error) {
      caught = error;
    }
    expect((caught as AceStepV15Error).code).toBe('artifact_reference_rejected');
  });

  test('an unconfigured engine reports engine_not_configured, never a hardcoded host', async () => {
    const engine = new AceStepV15GenerationEngine({});
    expect(await engine.healthCheck()).toBe(false);
    let caught: unknown;
    try {
      await engine.generate(audioRequest());
    } catch (error) {
      caught = error;
    }
    expect((caught as AceStepV15Error).code).toBe('engine_not_configured');
  });

  test('image-only request fields are rejected before any HTTP call', async () => {
    const server = mockServer({ pollResponses: [ACE_STEP_V15_QUERY_SUCCEEDED_PATH] });
    let caught: unknown;
    try {
      await makeEngine().generate(audioRequest({ width: 1024 }));
    } catch (error) {
      caught = error;
    }
    expect((caught as AceStepV15Error).code).toBe('unsupported_request_field');
    expect(server.releaseBodies).toHaveLength(0);
  });

  test('a v1-era request cannot be dispatched to the v1.5 adapter', async () => {
    let caught: unknown;
    try {
      await makeEngine().generate(audioRequest({ modality: 'image' }));
    } catch (error) {
      caught = error;
    }
    expect((caught as AceStepV15Error).code).toBe('unsupported_request_field');
  });

  test('the recorded status table is the single source for status values', () => {
    expect(ACE_STEP_V15_TASK_STATUS.succeeded).toBe(2);
    expect(Object.values(ACE_STEP_V15_TASK_STATUS)).toContain(0);
  });
});

describe('checkArtifactReference', () => {
  const base = { baseUrl: BASE_URL, allowedRoots: [ARTIFACT_ROOT] };

  test('accepts a path under a declared root', () => {
    const verdict = checkArtifactReference({ ...base, reference: `${ARTIFACT_ROOT}/a.wav` });
    expect(verdict.accepted).toBe(true);
  });

  test('accepts a URL on the engine origin', () => {
    const verdict = checkArtifactReference({
      ...base,
      reference: `${BASE_URL}${ARTIFACT_ROOT}/a.wav`,
    });
    expect(verdict.accepted).toBe(true);
    expect(verdict.accepted && verdict.kind).toBe('url');
  });

  test('rejects a path escaping the root, a traversal, a foreign origin and a query', () => {
    for (const reference of [
      '/etc/passwd',
      `${ARTIFACT_ROOT}/../../etc/passwd`,
      'http://169.254.169.254/latest/meta-data/',
      `${ARTIFACT_ROOT}/a.wav?path=/etc/shadow`,
      'file:///models/audio/v15/output/a.wav',
      '',
    ]) {
      expect(checkArtifactReference({ ...base, reference }).accepted).toBe(false);
    }
  });
});
