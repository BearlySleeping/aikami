// packages/shared/local-ai/src/lib/engines/ace_step_engine.ts
// biome-ignore-all lint/style/useNamingConvention: the ACE-Step API uses snake_case fields
//
// ACE-Step (text-to-audio) generation transport — the audio modality's engine
// adapter (C-511). It is the second modality on the C-510 `GenerationEngineClient`
// interface: same capability flags, same factory, same `GenerationResult`
// shape. Nothing here forks the interface.
//
// Transport — ACE-Step's own FastAPI server (`infer-api.py` in the upstream
// repo, the only REST surface the checkpoint ships):
//   GET  /health    → {"status": "healthy"}          (identity probe)
//   POST /generate  → {"status","output_path","message"}
//
// The server writes the WAV to `output_path` on ITS filesystem rather than
// returning bytes inline, so the adapter reads the artifact back through an
// injected {@link ArtifactReader} (the Bun CLI supplies a filesystem reader;
// a Tauri host would supply its FS plugin). That keeps this module portable —
// no Node/Bun-only imports, per @aikami/local-ai's AC-0 boundary.
//
// Portable: no Svelte runes, no DOM-only globals, no Node/Bun-only imports.
//
// Contract: C-511 Local Audio Generation Modality

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
import {
  assertNotAborted,
  assertSafeBaseUrl,
  normaliseBaseUrl,
  withRequestTimeout,
} from './transport.ts';

/** Poll deadline ceiling for an audio job (a long track on CPU is slow). */
export const DEFAULT_ACE_STEP_POLL_DEADLINE_MS = 1_800_000;

/**
 * Default model id — the `models.manifest.json` entry id for the pinned
 * checkpoint. It is deliberately the MANIFEST id, not the checkpoint
 * directory name: the descriptor's `model` is the publish preflight's only
 * handle on the licence that gates publication (C-511 AC-4).
 */
export const DEFAULT_ACE_STEP_MODEL_ID = 'audio-ace-step-v1-3.5b';

/** Where inside the engine container the checkpoint directory is mounted. */
export const DEFAULT_ACE_STEP_CHECKPOINT_DIR = '/models/audio';

/** Checkpoint directory name inside the models volume (the manifest targetPath root). */
export const DEFAULT_ACE_STEP_CHECKPOINT_NAME = 'ace-step-v1-3.5b';

/** Where inside the engine container generated audio is written. */
export const DEFAULT_ACE_STEP_OUTPUT_DIR = '/models/audio/output';

/** ACE-Step's own default inference step count. */
const DEFAULT_INFER_STEPS = 60;

/** ACE-Step's own default guidance scale. */
const DEFAULT_GUIDANCE_SCALE = 15;

/** Fallback clip length when a request carries no `durationSeconds`. */
const DEFAULT_DURATION_SECONDS = 30;

/**
 * ACE-Step's marker for an instrumental (no-vocal) generation. The upstream
 * pipeline treats this exact token as "no lyrics"; an empty string is not
 * equivalent.
 */
export const ACE_STEP_INSTRUMENTAL_LYRIC = '[inst]';

/**
 * Reads a file the engine wrote on its own filesystem.
 *
 * Injected because the engine returns a path, not bytes, and this package
 * must stay runtime-portable (see the module header).
 */
export type ArtifactReader = (path: string) => Promise<Uint8Array>;

/** Parsed RIFF/WAVE header fields the adapter records as flat metadata. */
export type WavHeader = {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  durationSeconds: number;
};

/**
 * Parses a RIFF/WAVE header — sample rate, channel count and duration.
 *
 * The engine's output format is recorded, not assumed: a recipe that declares
 * `.wav` must register bytes whose header actually says 44.1 kHz/stereo (or
 * whatever the engine produced), never a guess.
 *
 * @returns The parsed header, or undefined when the bytes are not a WAV file.
 */
export const parseWavHeader = (bytes: Uint8Array): WavHeader | undefined => {
  if (bytes.length < 44) {
    return undefined;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (at: number): string =>
    String.fromCharCode(bytes[at] ?? 0, bytes[at + 1] ?? 0, bytes[at + 2] ?? 0, bytes[at + 3] ?? 0);
  if (ascii(0) !== 'RIFF' || ascii(8) !== 'WAVE') {
    return undefined;
  }

  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let dataBytes = 0;

  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkId = ascii(offset);
    const chunkSize = view.getUint32(offset + 4, true);
    if (chunkId === 'fmt ' && offset + 8 + 16 <= bytes.length) {
      channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bitsPerSample = view.getUint16(offset + 22, true);
    } else if (chunkId === 'data') {
      dataBytes = chunkSize;
      break;
    }
    // Chunks are word-aligned — an odd size carries one pad byte.
    offset += 8 + chunkSize + (chunkSize % 2);
  }

  if (sampleRate <= 0 || channels <= 0 || bitsPerSample <= 0) {
    return undefined;
  }

  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  return {
    sampleRate,
    channels,
    bitsPerSample,
    durationSeconds: byteRate > 0 ? dataBytes / byteRate : 0,
  };
};

/** Construction options for {@link AceStepGenerationEngine}. */
export type AceStepGenerationEngineOptions = {
  /** Engine base URL. Empty/unset means "not configured" — never probe. */
  baseUrl?: string;
  /**
   * Poll deadline in milliseconds. ACE-Step's `/generate` is synchronous, so
   * this is the HTTP budget for one generation request.
   */
  queueWaitMs?: number;
  /** Model id recorded on the result. Defaults to the pinned checkpoint. */
  modelId?: string;
  /** Checkpoint directory as seen by the engine. */
  checkpointPath?: string;
  /** Output directory as seen by the engine. */
  outputDir?: string;
  /** CUDA device index the engine should use. */
  deviceId?: number;
  /** bfloat16 inference (the upstream default). */
  bf16?: boolean;
  /** torch.compile the pipeline (the upstream default is off). */
  torchCompile?: boolean;
  /** Diffusion inference steps. */
  inferSteps?: number;
  /** Classifier-free guidance scale. */
  guidanceScale?: number;
  /** Scheduler name (ACE-Step default: 'euler'). */
  schedulerType?: string;
  /** CFG type (ACE-Step default: 'apg'). */
  cfgType?: string;
  /** Omega guidance scale (ACE-Step default: 10). */
  omegaScale?: number;
  /** Guidance interval (ACE-Step default: 0.5). */
  guidanceInterval?: number;
  /** Guidance interval decay (ACE-Step default: 0). */
  guidanceIntervalDecay?: number;
  /** Minimum guidance scale (ACE-Step default: 3). */
  minGuidanceScale?: number;
  /** Use ERG tag guidance (ACE-Step default: on). */
  useErgTag?: boolean;
  /** Use ERG lyric guidance (ACE-Step default: on). */
  useErgLyric?: boolean;
  /** Use ERG diffusion guidance (ACE-Step default: on). */
  useErgDiffusion?: boolean;
  /** OSS step schedule (ACE-Step default: empty). */
  ossSteps?: readonly number[];
  /**
   * Reads the file the engine wrote. Without it `generate()` fails with a
   * readable error rather than returning a fabricated payload.
   */
  readArtifact?: ArtifactReader;
};

/** The `/generate` response body. */
type AceStepResponse = {
  status?: string;
  output_path?: string | null;
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

/**
 * ACE-Step audio generation engine.
 *
 * Single-slot: `generate()` calls are serialized per instance, so a second
 * concurrent call waits for the first instead of failing the GPU job.
 *
 * `cancel`/`progress` are declared false — the shipped ACE-Step API server
 * exposes neither, and claiming otherwise would make the CLI show a cancel
 * affordance that does nothing.
 */
export class AceStepGenerationEngine implements GenerationEngineClient {
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
    progress: false,
  };

  private readonly _baseUrl: string;

  private readonly _queueWaitMs: number;

  private readonly _modelId: string;

  private readonly _checkpointPath: string;

  private readonly _outputDir: string;

  private readonly _deviceId: number;

  private readonly _bf16: boolean;

  private readonly _torchCompile: boolean;

  private readonly _inferSteps: number;

  private readonly _guidanceScale: number;

  private readonly _schedulerType: string;

  private readonly _cfgType: string;

  private readonly _omegaScale: number;

  private readonly _guidanceInterval: number;

  private readonly _guidanceIntervalDecay: number;

  private readonly _minGuidanceScale: number;

  private readonly _useErgTag: boolean;

  private readonly _useErgLyric: boolean;

  private readonly _useErgDiffusion: boolean;

  private readonly _ossSteps: readonly number[];

  private readonly _readArtifact: ArtifactReader | undefined;

  /** Tail of the serialization chain — single-slot engines run one job. */
  private _queue: Promise<unknown> = Promise.resolve();

  constructor(options: AceStepGenerationEngineOptions = {}) {
    this._baseUrl = normaliseBaseUrl(options.baseUrl);
    if (this._baseUrl) {
      assertSafeBaseUrl(this._baseUrl, 'ACE-Step');
    }
    this._queueWaitMs = options.queueWaitMs ?? DEFAULT_ACE_STEP_POLL_DEADLINE_MS;
    this._modelId = options.modelId ?? DEFAULT_ACE_STEP_MODEL_ID;
    this._checkpointPath =
      options.checkpointPath ??
      `${DEFAULT_ACE_STEP_CHECKPOINT_DIR}/${DEFAULT_ACE_STEP_CHECKPOINT_NAME}`;
    this._outputDir = options.outputDir ?? DEFAULT_ACE_STEP_OUTPUT_DIR;
    this._deviceId = options.deviceId ?? 0;
    this._bf16 = options.bf16 ?? true;
    this._torchCompile = options.torchCompile ?? false;
    this._inferSteps = options.inferSteps ?? DEFAULT_INFER_STEPS;
    this._guidanceScale = options.guidanceScale ?? DEFAULT_GUIDANCE_SCALE;
    this._schedulerType = options.schedulerType ?? 'euler';
    this._cfgType = options.cfgType ?? 'apg';
    this._omegaScale = options.omegaScale ?? 10;
    this._guidanceInterval = options.guidanceInterval ?? 0.5;
    this._guidanceIntervalDecay = options.guidanceIntervalDecay ?? 0;
    this._minGuidanceScale = options.minGuidanceScale ?? 3;
    this._useErgTag = options.useErgTag ?? true;
    this._useErgLyric = options.useErgLyric ?? true;
    this._useErgDiffusion = options.useErgDiffusion ?? true;
    this._ossSteps = options.ossSteps ?? [];
    this._readArtifact = options.readArtifact;
  }

  /** The checkpoint directory this engine is pinned to. */
  get modelId(): string {
    return this._modelId;
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
      if (!response.ok) {
        return false;
      }
      const body = (await response.json()) as unknown;
      return (
        typeof body === 'object' &&
        body !== null &&
        (body as { status?: unknown }).status === 'healthy'
      );
    } catch {
      return false;
    }
  }

  /** @inheritdoc */
  async listModels(options?: { signal?: AbortSignal }): Promise<readonly GenerationModelInfo[]> {
    this._assertConfigured();
    assertNotAborted(options?.signal);
    // The shipped ACE-Step server exposes no model listing; the checkpoint is
    // fixed at construction. Report the pinned one rather than inventing an
    // endpoint.
    return [{ id: this._modelId, description: this._checkpointPath }];
  }

  /** @inheritdoc */
  generate(request: GenerationRequest, callbacks?: GenerationCallbacks): Promise<GenerationResult> {
    const run = this._queue.then(
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
    const { signal } = callbacks ?? {};
    this._assertConfigured();
    this._assertAudioRequest(request);
    assertNotAborted(signal);

    const seed = request.seed ?? Math.floor(Math.random() * 2 ** 32);
    const outputPath = `${this._outputDir}/aikami-${this._newId()}.wav`;
    const durationSeconds = request.durationSeconds ?? DEFAULT_DURATION_SECONDS;

    const body = {
      checkpoint_path: this._checkpointPath,
      bf16: this._bf16,
      torch_compile: this._torchCompile,
      device_id: this._deviceId,
      output_path: outputPath,
      audio_duration: durationSeconds,
      prompt: request.tags?.trim() ? request.tags : request.positivePrompt,
      lyrics: this._resolveLyrics(request),
      infer_step: this._inferSteps,
      guidance_scale: this._guidanceScale,
      scheduler_type: this._schedulerType,
      cfg_type: this._cfgType,
      omega_scale: this._omegaScale,
      actual_seeds: [seed],
      guidance_interval: this._guidanceInterval,
      guidance_interval_decay: this._guidanceIntervalDecay,
      min_guidance_scale: this._minGuidanceScale,
      use_erg_tag: this._useErgTag,
      use_erg_lyric: this._useErgLyric,
      use_erg_diffusion: this._useErgDiffusion,
      oss_steps: [...this._ossSteps],
      guidance_scale_text: 0,
      guidance_scale_lyric: 0,
    };

    const response = await fetch(`${this._baseUrl}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: withRequestTimeout(signal, this._queueWaitMs),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`ACE-Step API error (${response.status}): ${text.slice(0, 200)}`);
    }

    const result = (await response.json()) as AceStepResponse;
    if (result.status !== 'success') {
      throw new Error(
        `ACE-Step generation failed: ${result.message ?? result.status ?? 'unknown error'}`,
      );
    }
    const writtenPath = result.output_path;
    if (typeof writtenPath !== 'string' || writtenPath.length === 0) {
      throw new Error(
        'ACE-Step reported success without an output path — cannot read the generated audio',
      );
    }

    const bytes = await this._readBytes(writtenPath);
    if (bytes.length === 0) {
      throw new Error(`ACE-Step wrote an empty file at "${writtenPath}"`);
    }

    const header = parseWavHeader(bytes);
    const metadata: Record<string, string | number> = {
      format: 'wav',
      sampleRate: header?.sampleRate ?? 0,
      channels: header?.channels ?? 0,
      durationSeconds: header?.durationSeconds ?? durationSeconds,
      model: this._modelId,
      prompt: request.positivePrompt,
      outputPath: writtenPath,
    };
    if (request.bpm !== undefined) {
      metadata.bpm = request.bpm;
    }
    if (request.key !== undefined) {
      metadata.key = request.key;
    }

    return {
      bytes,
      mimeType: 'audio/wav',
      engine: this.id,
      seed,
      metadata,
    };
  }

  private _assertConfigured(): void {
    if (!this._baseUrl) {
      throw new Error('Audio engine is not configured (audio.url missing from config.json)');
    }
  }

  /**
   * The adapter's own guards. `validateRequestCapabilities` gates only the
   * `CAPABILITY_FIELDS` list, which has no `width`/`height`/`steps` flags —
   * so this guard owns the image-only fields, and it runs before any HTTP
   * call. A field is named, never silently stripped.
   */
  private _assertAudioRequest(request: GenerationRequest): void {
    if (request.modality !== this.modality) {
      throw new Error(
        `ACE-Step generates '${this.modality}' — a '${request.modality}' request cannot be dispatched to it`,
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
      throw new Error(
        `ACE-Step is an audio engine and does not support the request field "${field}" — remove it (the field is image-only and is never silently stripped)`,
      );
    }
    if (request.model !== undefined && request.model !== this._modelId) {
      throw new Error(
        `ACE-Step cannot hot-swap models: this adapter is pinned to "${this._modelId}" but the request names "${request.model}"`,
      );
    }
  }

  private _resolveLyrics(request: GenerationRequest): string {
    if (request.instrumental === true) {
      return ACE_STEP_INSTRUMENTAL_LYRIC;
    }
    const lyrics = request.lyrics?.trim();
    return lyrics && lyrics.length > 0 ? lyrics : ACE_STEP_INSTRUMENTAL_LYRIC;
  }

  private async _readBytes(path: string): Promise<Uint8Array> {
    if (!this._readArtifact) {
      throw new Error(
        'ACE-Step writes generated audio to its own filesystem and no artifact reader is configured — supply `readArtifact` to read the output file',
      );
    }
    return this._readArtifact(path);
  }

  private _newId(): string {
    const cryptoApi = globalThis.crypto as { randomUUID?: () => string } | undefined;
    if (typeof cryptoApi?.randomUUID === 'function') {
      return cryptoApi.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
