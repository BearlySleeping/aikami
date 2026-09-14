// packages/shared/local-ai/src/lib/engines/ace_step_v15_engine.ts
// biome-ignore-all lint/style/useNamingConvention: the ACE-Step API uses snake_case fields
//
// C-521: the versioned ACE-Step **v1.5** adapter.
//
// v1.5 is not v1 with a new model id — it is a different REST flow:
//
//   POST /release_task  → { code, data: { task_id } }        (enqueue)
//   POST /query_result  → { data: [{ task_id, status, ... }] } (poll)
//   then a *scoped* retrieval of the audio the task reports.
//
// Three consequences drive this module's shape:
//
//   * **The native task id is recorded the moment it exists.** A generation
//     that dies mid-poll must still be reportable ("this native task was
//     submitted and never reconciled") rather than silently re-run, which is
//     what C-521's cancellation/idempotency requirement asks for.
//   * **The output format is explicit.** v1.5's API defaults to MP3 for some
//     configurations; a rendition profile that expects WAV must say so in the
//     request rather than discover it afterwards.
//   * **The server's own path is never handed to a client.** The task's
//     reported reference is validated (origin, root, traversal, no arbitrary
//     query) and fetched through an injected fetcher with a byte ceiling, so a
//     returned string cannot become a filesystem or SSRF primitive.
//
// The v1 adapter (`ace_step_engine.ts`) stays in the tree for rollback; this
// one is selected by the audio profile, not by replacing the other.
//
// Contract: C-521 Music and SFX generation with audio preparation

import type {
  GenerationCallbacks,
  GenerationCapabilities,
  GenerationEngineClient,
  GenerationEngineId,
  GenerationModality,
  GenerationModelInfo,
  GenerationRequest,
  GenerationResult,
} from '@aikami/types';
import { compileAudioPrompt } from './ace_step_engine.ts';
import {
  assertNotAborted,
  assertSafeBaseUrl,
  normaliseBaseUrl,
  withRequestTimeout,
} from './transport.ts';

/** The `models.manifest.json` id of the pinned v1.5 checkpoint (2B turbo first). */
export const DEFAULT_ACE_STEP_V15_MODEL_ID = 'audio-ace-step-v15-2b-turbo';

/** Where the pinned container writes artifacts, on ITS filesystem. */
export const DEFAULT_ACE_STEP_V15_ARTIFACT_ROOT = '/models/audio/v15/output';

/**
 * Task status values as recorded from the pinned v1.5 server's `/query_result`.
 *
 * 🔴 This mapping is a *recorded protocol fixture*, not a guess: the known
 * values are declared here once and every consumer reads them from this table.
 * Re-verify against the pinned upstream commit during the live-readiness
 * preflight; a server that reports a different integer fails loudly (an
 * unknown status is an error, never "keep waiting forever").
 */
export const ACE_STEP_V15_TASK_STATUS = {
  queued: 0,
  running: 1,
  succeeded: 2,
  failed: 3,
} as const;

/** A declared native task status value. */
export type AceStepV15TaskStatus =
  (typeof ACE_STEP_V15_TASK_STATUS)[keyof typeof ACE_STEP_V15_TASK_STATUS];

/** Output formats the adapter will request. */
export const ACE_STEP_V15_OUTPUT_FORMATS = ['wav', 'flac', 'mp3'] as const;

/** A requested output format. */
export type AceStepV15OutputFormat = (typeof ACE_STEP_V15_OUTPUT_FORMATS)[number];

/** MIME type for a requested output format. */
const MIME_BY_FORMAT: Readonly<Record<AceStepV15OutputFormat, string>> = {
  wav: 'audio/wav',
  flac: 'audio/flac',
  mp3: 'audio/mpeg',
};

/** Typed failure codes — a caller branches on the code, not on the message. */
export const ACE_STEP_V15_ERROR_CODES = [
  'engine_not_configured',
  'unsupported_request_field',
  'release_task_failed',
  'query_result_failed',
  'task_failed',
  'poll_timeout',
  'unknown_task_status',
  'artifact_reference_rejected',
  'artifact_too_large',
  'artifact_empty',
  'unsupported_output_format',
] as const;

/** A typed adapter failure code. */
export type AceStepV15ErrorCode = (typeof ACE_STEP_V15_ERROR_CODES)[number];

/** A failure raised by the v1.5 adapter, carrying a stable code. */
export class AceStepV15Error extends Error {
  readonly code: AceStepV15ErrorCode;

  constructor(code: AceStepV15ErrorCode, message: string) {
    super(message);
    this.name = 'AceStepV15Error';
    this.code = code;
  }
}

/** The reference a finished task reports for its audio, plus its native id. */
export type ScopedArtifactReference = {
  /** The opaque string the server returned (a URL or a server-side path). */
  readonly reference: string;
  /** The native task id the reference belongs to. */
  readonly taskId: string;
  /** The format the task reported, when it reported one. */
  readonly format?: string;
};

/** Why a server-reported artifact reference was rejected. */
export type ArtifactReferenceVerdict =
  | { accepted: true; kind: 'url' | 'path'; normalised: string }
  | { accepted: false; reason: string };

/**
 * Decides whether a server-reported artifact reference may be fetched.
 *
 * The rules are deliberately narrow — v1.5 lets a task report an arbitrary
 * path, and that is exactly the primitive this contract says must not reach a
 * client:
 *
 *   * no empty reference, no NUL byte, no `..` segment;
 *   * no query string or fragment (an arbitrary path query is not a scoped
 *     retrieval);
 *   * an absolute URL must be http(s) and share the configured engine origin;
 *   * anything else is treated as a server path and must sit under one of the
 *     declared artifact roots.
 */
export const checkArtifactReference = (options: {
  reference: string;
  baseUrl: string;
  allowedRoots: readonly string[];
}): ArtifactReferenceVerdict => {
  const { reference, baseUrl, allowedRoots } = options;
  if (reference.trim().length === 0) {
    return { accepted: false, reason: 'the task reported an empty artifact reference' };
  }
  if (reference.includes('\0')) {
    return { accepted: false, reason: 'the artifact reference contains a NUL byte' };
  }
  if (reference.includes('?') || reference.includes('#')) {
    return {
      accepted: false,
      reason: `the artifact reference carries a query/fragment ("${reference.slice(0, 80)}") — only a scoped retrieval is allowed`,
    };
  }
  const segments = reference.split(/[\\/]+/);
  if (segments.includes('..')) {
    return { accepted: false, reason: 'the artifact reference traverses upwards (`..`)' };
  }

  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(reference);
  if (schemeMatch) {
    const scheme = (schemeMatch[1] as string).toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') {
      return {
        accepted: false,
        reason: `the artifact reference uses the "${scheme}:" scheme — only http(s) from the configured engine origin is allowed`,
      };
    }
    let artifactOrigin: string;
    let engineOrigin: string;
    try {
      artifactOrigin = new URL(reference).origin;
      engineOrigin = new URL(baseUrl).origin;
    } catch {
      return { accepted: false, reason: 'the artifact reference is not a parsable URL' };
    }
    if (artifactOrigin !== engineOrigin) {
      return {
        accepted: false,
        reason: `the artifact reference points at "${artifactOrigin}" but the engine is "${engineOrigin}"`,
      };
    }
    return { accepted: true, kind: 'url', normalised: reference };
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(reference)) {
    return {
      accepted: false,
      reason: `the artifact reference uses a non-http scheme ("${reference.slice(0, 40)}")`,
    };
  }

  const normalised = reference.startsWith('/') ? reference : `/${reference}`;
  const allowed = allowedRoots.some(
    (root) => normalised === root || normalised.startsWith(root.endsWith('/') ? root : `${root}/`),
  );
  if (!allowed) {
    return {
      accepted: false,
      reason: `the artifact path "${normalised}" is outside the declared artifact roots (${allowedRoots.join(', ')})`,
    };
  }
  return { accepted: true, kind: 'path', normalised };
};

/** Construction options for {@link AceStepV15GenerationEngine}. */
export type AceStepV15GenerationEngineOptions = {
  /** Engine base URL. Empty/unset means "not configured" — never probe. */
  baseUrl?: string;
  /** Manifest id of the pinned v1.5 checkpoint. */
  modelId?: string;
  /** Format to request explicitly. Defaults to `wav`. */
  outputFormat?: AceStepV15OutputFormat;
  /** Server paths an artifact reference may sit under. */
  allowedArtifactRoots?: readonly string[];
  /** Hard ceiling on a retrieved artifact. */
  maxArtifactBytes?: number;
  /** Diffusers inference steps forwarded to the server. */
  inferSteps?: number;
  /** Poll interval. */
  pollIntervalMs?: number;
  /** Poll deadline — the whole job, not one HTTP call. */
  pollDeadlineMs?: number;
  /** CUDA device index. */
  deviceId?: number;
  /**
   * Retrieves an already-validated reference. The host supplies this so the
   * portable core never grows a filesystem or an unbounded fetch.
   */
  fetchArtifact?: (
    reference: ScopedArtifactReference,
    options: { signal?: AbortSignal },
  ) => Promise<Uint8Array>;
  /** Test seam: the clock used for the poll deadline. */
  now?: () => number;
  /** Test seam: the sleep between polls. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

/** The `/release_task` response body. */
type ReleaseTaskResponse = {
  code?: number;
  data?: { task_id?: string };
  task_id?: string;
  message?: string;
};

/** One entry of the `/query_result` response. */
type QueryResultEntry = {
  task_id?: string;
  status?: number;
  progress?: number;
  result?: unknown;
  message?: string;
};

/** The `/query_result` response body. */
type QueryResultResponse = {
  code?: number;
  data?: QueryResultEntry[];
  message?: string;
};

/** Request fields this engine cannot honour — rejected, never stripped. */
const UNSUPPORTED_REQUEST_FIELDS: readonly (keyof GenerationRequest)[] = [
  'width',
  'height',
  'steps',
  'cfgScale',
  'sampler',
  'denoise',
  'negativePrompt',
  'initImage',
  'mask',
  'referenceImages',
  'loras',
];

const sleepDefault = async (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });

/**
 * Versioned ACE-Step v1.5 generation engine.
 *
 * `capabilities.cancel` is **false**: v1.5's shipped surface has no confirmed
 * native cancel call in this adapter's verified flow, and reporting `true`
 * would let a caller claim a task stopped when only the *waiting* stopped.
 * `progress` is `true` — `/query_result` reports a progress fraction, so the
 * CLI/Studio can show real movement.
 */
export class AceStepV15GenerationEngine implements GenerationEngineClient {
  readonly id: GenerationEngineId = 'ace-step';

  readonly modality: GenerationModality = 'audio';

  readonly capabilities: GenerationCapabilities = {
    negativePrompt: false,
    seed: true,
    sampler: false,
    initImage: false,
    mask: false,
    referenceImages: false,
    controlNet: false,
    lora: false,
    cancel: false,
    progress: true,
  };

  private readonly _baseUrl: string;

  private readonly _modelId: string;

  private readonly _outputFormat: AceStepV15OutputFormat;

  private readonly _allowedArtifactRoots: readonly string[];

  private readonly _maxArtifactBytes: number;

  private readonly _inferSteps: number;

  private readonly _pollIntervalMs: number;

  private readonly _pollDeadlineMs: number;

  private readonly _deviceId: number;

  private readonly _fetchArtifact:
    | ((
        reference: ScopedArtifactReference,
        options: { signal?: AbortSignal },
      ) => Promise<Uint8Array>)
    | undefined;

  private readonly _now: () => number;

  private readonly _sleep: (ms: number, signal?: AbortSignal) => Promise<void>;

  /** Native task ids submitted by this adapter, in submission order. */
  private readonly _nativeTaskIds: string[] = [];

  /** Tail of the serialization chain — a single GPU runs one job at a time. */
  private _queue: Promise<unknown> = Promise.resolve();

  constructor(options: AceStepV15GenerationEngineOptions = {}) {
    this._baseUrl = normaliseBaseUrl(options.baseUrl);
    if (this._baseUrl) {
      assertSafeBaseUrl(this._baseUrl, 'ACE-Step v1.5');
    }
    this._modelId = options.modelId ?? DEFAULT_ACE_STEP_V15_MODEL_ID;
    this._outputFormat = options.outputFormat ?? 'wav';
    if (!ACE_STEP_V15_OUTPUT_FORMATS.includes(this._outputFormat)) {
      throw new AceStepV15Error(
        'unsupported_output_format',
        `"${this._outputFormat}" is not a declared output format (${ACE_STEP_V15_OUTPUT_FORMATS.join(', ')})`,
      );
    }
    this._allowedArtifactRoots = options.allowedArtifactRoots ?? [
      DEFAULT_ACE_STEP_V15_ARTIFACT_ROOT,
    ];
    this._maxArtifactBytes = options.maxArtifactBytes ?? 50 * 1024 * 1024;
    this._inferSteps = options.inferSteps ?? 50;
    this._pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this._pollDeadlineMs = options.pollDeadlineMs ?? 1_800_000;
    this._deviceId = options.deviceId ?? 0;
    this._fetchArtifact = options.fetchArtifact;
    this._now = options.now ?? (() => Date.now());
    this._sleep = options.sleep ?? sleepDefault;
  }

  /** The manifest id this adapter is pinned to. */
  get modelId(): string {
    return this._modelId;
  }

  /** The explicit format this adapter requests. */
  get outputFormat(): AceStepV15OutputFormat {
    return this._outputFormat;
  }

  /**
   * Native task ids this adapter has submitted.
   *
   * Recorded at submission, so a job that never finished is still reportable
   * by id rather than becoming an anonymous lost request.
   */
  get nativeTaskIds(): readonly string[] {
    return [...this._nativeTaskIds];
  }

  /** @inheritdoc */
  async healthCheck(options?: { signal?: AbortSignal }): Promise<boolean> {
    if (!this._baseUrl) {
      return false; // no engine configured — never probe a hardcoded host
    }
    try {
      const response = await fetch(`${this._baseUrl}/health`, {
        method: 'GET',
        redirect: 'error',
        signal: options?.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(2000)])
          : AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /** @inheritdoc */
  async listModels(options?: { signal?: AbortSignal }): Promise<readonly GenerationModelInfo[]> {
    this._assertConfigured();
    assertNotAborted(options?.signal);
    // v1.5 exposes no model listing; the checkpoint is fixed at construction.
    return [{ id: this._modelId, description: `ACE-Step v1.5 pinned checkpoint` }];
  }

  /** @inheritdoc */
  generate(request: GenerationRequest, callbacks?: GenerationCallbacks): Promise<GenerationResult> {
    const preceding = this._queue;
    const run = preceding.then(
      () => this._generate(request, callbacks),
      () => this._generate(request, callbacks),
    );
    this._queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  // ── Private ──────────────────────────────────────────────────────────

  private async _generate(
    request: GenerationRequest,
    callbacks?: GenerationCallbacks,
  ): Promise<GenerationResult> {
    const { signal, onProgress } = callbacks ?? {};
    this._assertConfigured();
    this._assertAudioRequest(request);
    assertNotAborted(signal);

    const seed = request.seed ?? Math.floor(Math.random() * 2 ** 32);
    const durationSeconds = request.durationSeconds ?? 30;
    const submittedPrompt = compileAudioPrompt(request);

    const taskId = await this._releaseTask({
      request,
      submittedPrompt,
      seed,
      durationSeconds,
      signal,
    });
    // The id exists from here on — a failure after this point is reported with
    // the native id, never as an anonymous retry.
    const reference = await this._awaitTask({ taskId, signal, onProgress });

    const scoped: ScopedArtifactReference = {
      reference: reference.reference,
      taskId,
      ...(reference.format === undefined ? {} : { format: reference.format }),
    };
    const bytes = await this._retrieveArtifact(scoped, signal);
    if (bytes.length === 0) {
      throw new AceStepV15Error(
        'artifact_empty',
        `task ${taskId} reported a reference that yielded zero bytes`,
      );
    }
    if (bytes.length > this._maxArtifactBytes) {
      throw new AceStepV15Error(
        'artifact_too_large',
        `task ${taskId} yielded ${bytes.length} bytes, above the ${this._maxArtifactBytes}-byte ceiling`,
      );
    }

    const metadata: Record<string, string | number> = {
      model: this._modelId,
      profile: 'ace-step-v15',
      nativeTaskId: taskId,
      outputFormat: reference.format ?? this._outputFormat,
      requestedDurationSeconds: durationSeconds,
    };
    const key = request.key?.trim();
    if (request.bpm !== undefined) {
      metadata.requestedBpm = request.bpm;
    }
    if (key !== undefined && key.length > 0) {
      metadata.requestedKey = key;
    }
    if (request.instrumental !== undefined) {
      metadata.requestedInstrumental = request.instrumental ? 1 : 0;
    }

    // The bytes come back in the requested format; a task that reported a
    // different one is surfaced rather than mislabelled as WAV.
    const reportedFormat = this._formatOf(reference.format);
    return {
      bytes,
      mimeType: MIME_BY_FORMAT[reportedFormat],
      engine: this.id,
      seed,
      metadata,
    };
  }

  private _formatOf(reported: string | undefined): AceStepV15OutputFormat {
    if (reported === undefined) {
      return this._outputFormat;
    }
    const normalised = reported.toLowerCase().replace(/^\./, '') as AceStepV15OutputFormat;
    if (!ACE_STEP_V15_OUTPUT_FORMATS.includes(normalised)) {
      throw new AceStepV15Error(
        'unsupported_output_format',
        `the task reported output format "${reported}", which this adapter does not label`,
      );
    }
    return normalised;
  }

  private async _releaseTask(options: {
    request: GenerationRequest;
    submittedPrompt: string;
    seed: number;
    durationSeconds: number;
    signal?: AbortSignal;
  }): Promise<string> {
    const { request, submittedPrompt, seed, durationSeconds, signal } = options;
    const body = {
      model: this._modelId,
      device_id: this._deviceId,
      prompt: submittedPrompt,
      lyrics: request.instrumental === false ? (request.lyrics ?? '') : '[inst]',
      audio_duration: durationSeconds,
      infer_step: this._inferSteps,
      actual_seeds: [seed],
      // Explicit: v1.5's own default can be MP3, which no profile here wants.
      output_format: this._outputFormat,
    };

    let response: Response;
    try {
      response = await fetch(`${this._baseUrl}/release_task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: withRequestTimeout(signal, 60_000),
      });
    } catch (error) {
      throw new AceStepV15Error(
        'release_task_failed',
        `POST /release_task failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!response.ok) {
      throw new AceStepV15Error(
        'release_task_failed',
        `POST /release_task returned ${response.status}`,
      );
    }
    const parsed = (await response.json()) as ReleaseTaskResponse;
    const taskId = parsed.data?.task_id ?? parsed.task_id;
    if (typeof taskId !== 'string' || taskId.length === 0) {
      throw new AceStepV15Error(
        'release_task_failed',
        `POST /release_task returned no task id (code ${parsed.code ?? 'unknown'})`,
      );
    }
    this._nativeTaskIds.push(taskId);
    return taskId;
  }

  private async _awaitTask(options: {
    taskId: string;
    signal?: AbortSignal;
    onProgress?: GenerationCallbacks['onProgress'];
  }): Promise<{ reference: string; format?: string }> {
    const { taskId, signal, onProgress } = options;
    const deadline = this._now() + this._pollDeadlineMs;

    while (true) {
      assertNotAborted(signal);
      if (this._now() > deadline) {
        throw new AceStepV15Error(
          'poll_timeout',
          `native task ${taskId} did not finish within ${this._pollDeadlineMs} ms — the wait stopped, but the server task was NOT cancelled`,
        );
      }

      const entry = await this._queryResult(taskId, signal);
      const status = entry.status;
      if (status === ACE_STEP_V15_TASK_STATUS.succeeded) {
        onProgress?.({ fraction: 1, label: `task ${taskId} finished` });
        return this._readReference(taskId, entry.result);
      }
      if (status === ACE_STEP_V15_TASK_STATUS.failed) {
        throw new AceStepV15Error(
          'task_failed',
          `native task ${taskId} failed: ${entry.message ?? 'the server reported no reason'}`,
        );
      }
      if (
        status !== ACE_STEP_V15_TASK_STATUS.queued &&
        status !== ACE_STEP_V15_TASK_STATUS.running
      ) {
        throw new AceStepV15Error(
          'unknown_task_status',
          `native task ${taskId} reported status ${String(status)}, which is not in the recorded v1.5 status table`,
        );
      }
      if (typeof entry.progress === 'number' && onProgress) {
        const fraction = entry.progress > 1 ? entry.progress / 100 : entry.progress;
        onProgress({ fraction, label: `task ${taskId} ${(fraction * 100) | 0}%` });
      }
      await this._sleep(this._pollIntervalMs, signal);
    }
  }

  private async _queryResult(taskId: string, signal?: AbortSignal): Promise<QueryResultEntry> {
    let response: Response;
    try {
      response = await fetch(`${this._baseUrl}/query_result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id_list: [taskId] }),
        signal: withRequestTimeout(signal, 30_000),
      });
    } catch (error) {
      throw new AceStepV15Error(
        'query_result_failed',
        `POST /query_result failed for task ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!response.ok) {
      throw new AceStepV15Error(
        'query_result_failed',
        `POST /query_result returned ${response.status} for task ${taskId}`,
      );
    }
    const parsed = (await response.json()) as QueryResultResponse;
    const entry = parsed.data?.find((candidate) => candidate.task_id === taskId);
    if (entry === undefined) {
      throw new AceStepV15Error(
        'query_result_failed',
        `POST /query_result returned no entry for task ${taskId}`,
      );
    }
    return entry;
  }

  /**
   * Extracts the artifact reference from a finished task's `result`.
   *
   * v1.5 may report the reference as a bare string or inside a JSON blob; both
   * shapes are read here, and anything else is a typed failure rather than an
   * `undefined` that later becomes an empty file.
   */
  private _readReference(taskId: string, result: unknown): { reference: string; format?: string } {
    if (typeof result === 'string') {
      const trimmed = result.trim();
      if (trimmed.startsWith('{')) {
        // v1.5 may hand back the result as a JSON blob inside a string.
        let parsed: unknown;
        try {
          parsed = JSON.parse(trimmed) as unknown;
        } catch {
          parsed = undefined;
        }
        if (typeof parsed === 'object' && parsed !== null) {
          return this._readReference(taskId, parsed);
        }
      }
      if (trimmed.length > 0) {
        return { reference: trimmed };
      }
    }
    if (typeof result === 'object' && result !== null) {
      const record = result as Record<string, unknown>;
      const reference =
        (record.audio_path as string | undefined) ??
        (record.path as string | undefined) ??
        (record.url as string | undefined) ??
        (record.file as string | undefined);
      const format =
        (record.format as string | undefined) ?? (record.audio_format as string | undefined);
      if (typeof reference === 'string' && reference.length > 0) {
        return { reference, ...(format === undefined ? {} : { format }) };
      }
    }
    throw new AceStepV15Error(
      'artifact_reference_rejected',
      `native task ${taskId} finished without a readable artifact reference`,
    );
  }

  private async _retrieveArtifact(
    reference: ScopedArtifactReference,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    const verdict = checkArtifactReference({
      reference: reference.reference,
      baseUrl: this._baseUrl,
      allowedRoots: this._allowedArtifactRoots,
    });
    if (!verdict.accepted) {
      throw new AceStepV15Error(
        'artifact_reference_rejected',
        `task ${reference.taskId}: ${verdict.reason}`,
      );
    }
    if (!this._fetchArtifact) {
      throw new AceStepV15Error(
        'artifact_reference_rejected',
        'no artifact fetcher is configured — the host must supply a bounded fetcher rather than dial the server path directly',
      );
    }
    const bytes = await this._fetchArtifact(
      { ...reference, reference: verdict.normalised },
      { ...(signal === undefined ? {} : { signal }) },
    );
    if (bytes.length > this._maxArtifactBytes) {
      throw new AceStepV15Error(
        'artifact_too_large',
        `the artifact for task ${reference.taskId} is ${bytes.length} bytes, above the ${this._maxArtifactBytes}-byte ceiling`,
      );
    }
    return bytes;
  }

  private _assertConfigured(): void {
    if (!this._baseUrl) {
      throw new AceStepV15Error(
        'engine_not_configured',
        'ACE-Step v1.5 is not configured (audio.v15.url missing from config.json)',
      );
    }
  }

  private _assertAudioRequest(request: GenerationRequest): void {
    if (request.modality !== this.modality) {
      throw new AceStepV15Error(
        'unsupported_request_field',
        `ACE-Step v1.5 generates '${this.modality}' — a '${request.modality}' request cannot be dispatched to it`,
      );
    }
    for (const field of UNSUPPORTED_REQUEST_FIELDS) {
      const value = request[field];
      if (value === undefined || value === null) {
        continue;
      }
      if (Array.isArray(value) && value.length === 0) {
        continue;
      }
      throw new AceStepV15Error(
        'unsupported_request_field',
        `ACE-Step v1.5 is an audio engine and does not support the request field "${field}" — remove it (the field is image-only and is never silently stripped)`,
      );
    }
    if (request.model !== undefined && request.model !== this._modelId) {
      throw new AceStepV15Error(
        'unsupported_request_field',
        `ACE-Step v1.5 cannot hot-swap models: this adapter is pinned to "${this._modelId}" but the request names "${request.model}"`,
      );
    }
  }
}
