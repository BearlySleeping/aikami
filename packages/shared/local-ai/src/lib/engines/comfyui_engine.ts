// packages/shared/local-ai/src/lib/engines/comfyui_engine.ts
// biome-ignore-all lint/style/useNamingConvention: ComfyUI API uses snake_case fields
//
// ComfyUI generation transport — the single surviving ComfyUI workflow
// builder + submit/poll/collect implementation (C-510). The frontend engine
// adapter delegates here; nothing else re-declares the graph.
//
// Transport:
// - POST /prompt           → queue a workflow
// - GET  /history/{id}     → poll for the output image
// - GET  /view?filename=…  → fetch image bytes
// - POST /upload/image     → img2img source upload
// - POST /interrupt        → cancellation
//
// Portable: no Svelte runes, no DOM-only globals, no Node/Bun-only imports.
//
// Contract: C-510 Engine-Agnostic Asset Generation Pipeline

import type {
  GenerationCallbacks,
  GenerationCapabilities,
  GenerationEngineClient,
  GenerationEngineId,
  GenerationModality,
  GenerationModelInfo,
  GenerationRequest,
  GenerationResult,
  WorkflowProfile,
  WorkflowTemplate,
} from '@aikami/types';
import {
  assertCompiledWorkflowRunnable,
  compileWorkflow,
  type NodeSchema,
} from '../workflows/workflow_compiler.ts';
import { resolveWorkflowProfileForRequest } from '../workflows/workflow_profile_registry.ts';
import {
  assertNotAborted,
  assertPayloadSize,
  assertSafeBaseUrl,
  bytesToBlob,
  decodeImagePayload,
  isAbortError,
  normaliseBaseUrl,
  sleep,
} from './transport.ts';

/** Poll interval when waiting for a generation. */
const POLL_INTERVAL_MS = 1000;

/** Default generation wait, preserving the pre-configurable 120 poll attempts. */
const DEFAULT_QUEUE_WAIT_MS = 120_000;

/** Progress fraction when the job is queued. */
const QUEUED_FRACTION = 0.05;

/** Progress fraction when the job starts generating. */
const GENERATING_FRACTION = 0.1;

/** Progress fraction when the image is ready to download. */
const DOWNLOADING_FRACTION = 0.95;

type ComfyUiHistoryEntry = {
  outputs: Record<
    string,
    { images: Array<{ filename: string; subfolder: string | null; type: string }> }
  >;
  status: { completed: boolean; messages: Array<[string, unknown]> };
};

/** Construction options for {@link ComfyUiGenerationEngine}. */
export type ComfyUiGenerationEngineOptions = {
  /** Engine base URL. Empty/unset means "not configured" — never probe. */
  baseUrl?: string;
  /** Poll deadline in milliseconds. */
  queueWaitMs?: number;
  /**
   * C-520: pinned workflow-profile id. When set, the engine compiles the
   * profile's own versioned template instead of the legacy SD-XL builder, its
   * capabilities are the profile's (not the adapter's), and the graph is
   * validated against the installed node schema before any submission.
   */
  workflowProfileId?: string;
};

/** What a resolved request produces, before any HTTP call is made. */
type PreparedComfyUiWorkflow = {
  readonly workflow: Record<string, unknown>;
  readonly seed: number;
  readonly metadata: Record<string, string | number>;
};

/**
 * ComfyUI generation engine.
 *
 * `mask`/`referenceImages`/`controlNet`/`lora` are declared unsupported, so
 * those request fields are stripped before the graph is built — never
 * silently forwarded into a node that would ignore them.
 */
export class ComfyUiGenerationEngine implements GenerationEngineClient {
  readonly id: GenerationEngineId = 'comfyui';

  readonly modality: GenerationModality = 'image';

  private readonly _baseUrl: string;

  /** Attempt budget derived from the configured queue duration. */
  private readonly _maxPollAttempts: number;

  /** The pinned profile this engine runs, when one was selected (C-520). */
  private readonly _profile: WorkflowProfile | undefined;

  private readonly _template: WorkflowTemplate | undefined;

  /**
   * The installed node schema, fetched once per engine instance.
   *
   * Cached deliberately: the schema is a property of the running ComfyUI, and
   * re-reading it per candidate would add a round trip without adding safety.
   */
  private _nodeSchema: NodeSchema | undefined;

  constructor(options: ComfyUiGenerationEngineOptions = {}) {
    this._baseUrl = normaliseBaseUrl(options.baseUrl);
    if (this._baseUrl) {
      assertSafeBaseUrl(this._baseUrl, 'ComfyUI');
    }
    const queueWaitMs = options.queueWaitMs ?? DEFAULT_QUEUE_WAIT_MS;
    this._maxPollAttempts = Math.max(1, Math.ceil(queueWaitMs / POLL_INTERVAL_MS));

    if (options.workflowProfileId !== undefined) {
      // Resolving at construction refuses an unknown or experimental-blocked
      // profile immediately, rather than at the first generation attempt.
      const resolved = resolveWorkflowProfileForRequest({
        profileId: options.workflowProfileId,
      });
      this._profile = resolved.profile;
      this._template = resolved.template;
    }
  }

  /**
   * What this engine can honour.
   *
   * With a pinned profile these are the profile's proven capabilities — the
   * ones its graph and allowlist actually back — so a capability UI cannot
   * advertise something the selected graph has no node for (AC-2).
   */
  get capabilities(): GenerationCapabilities {
    if (!this._profile) {
      return {
        negativePrompt: true,
        seed: true,
        sampler: true,
        initImage: true,
        mask: false,
        referenceImages: false,
        controlNet: false,
        lora: false,
        cancel: true,
        progress: true,
      };
    }
    return {
      negativePrompt: this._profile.capabilities.negativePrompt,
      seed: this._profile.capabilities.seed,
      sampler: this._profile.capabilities.sampler,
      initImage: this._profile.capabilities.initImage,
      mask: this._profile.capabilities.mask,
      referenceImages: this._profile.capabilities.referenceImages,
      controlNet: this._profile.capabilities.controlNet,
      lora: this._profile.capabilities.lora,
      cancel: true,
      progress: true,
    };
  }

  /** The pinned profile id, when this engine runs one. */
  get workflowProfileId(): string | undefined {
    return this._profile?.id;
  }

  /** @inheritdoc */
  async healthCheck(options?: { signal?: AbortSignal }): Promise<boolean> {
    if (!this._baseUrl) {
      return false; // no engine configured — never probe a hardcoded host
    }
    try {
      const response = await fetch(`${this._baseUrl}/object_info`, {
        method: 'GET',
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
    const response = await fetch(`${this._baseUrl}/object_info`, {
      method: 'GET',
      signal: options?.signal,
    });
    if (!response.ok) {
      throw new Error(`ComfyUI object_info failed (${response.status})`);
    }

    const data = (await response.json()) as Record<
      string,
      { input?: { required?: { ckpt_name?: unknown } } }
    >;
    const checkpointNode = data.CheckpointLoaderSimple;

    // ckpt_name is a NESTED array ([["a.safetensors", ...]]) — do not regress.
    const raw = checkpointNode?.input?.required?.ckpt_name;
    let filenames: string[];
    if (Array.isArray(raw)) {
      filenames = Array.isArray(raw[0]) ? (raw[0] as string[]) : (raw as string[]);
    } else {
      filenames = [];
    }

    return filenames.map((filename) => ({
      id: filename.replace(/\.safetensors$/, ''),
      description: filename,
    }));
  }

  /** @inheritdoc */
  async generate(
    request: GenerationRequest,
    callbacks?: GenerationCallbacks,
  ): Promise<GenerationResult> {
    const { signal, onProgress } = callbacks ?? {};
    this._assertConfigured();

    if (request.modality !== this.modality) {
      throw new Error(
        `ComfyUI generates '${this.modality}' — a '${request.modality}' request cannot be dispatched to it`,
      );
    }

    const prepared = await this._prepareWorkflow(request, callbacks);

    onProgress?.({ fraction: QUEUED_FRACTION, label: 'Queuing' });

    const queueResponse = await this._post<{ prompt_id: string }>(
      '/prompt',
      { client_id: `aikami-${Date.now()}`, prompt: prepared.workflow },
      signal,
    );
    const promptId = queueResponse.prompt_id;

    onProgress?.({ fraction: GENERATING_FRACTION, label: 'Generating' });

    let polledResult: { filename: string; subfolder: string | null } | undefined;

    try {
      const imageRef = await this._pollForResult(promptId, signal, onProgress);
      polledResult = imageRef;

      onProgress?.({ fraction: DOWNLOADING_FRACTION, label: 'Downloading' });

      const imageUrl =
        `${this._baseUrl}/view?filename=${encodeURIComponent(imageRef.filename)}` +
        `&subfolder=${encodeURIComponent(imageRef.subfolder ?? '')}&type=output`;

      const response = await fetch(imageUrl, { signal });
      if (!response.ok) {
        throw new Error(`Failed to fetch image (${response.status})`);
      }
      const blob = await response.blob();
      const bytes = new Uint8Array(await blob.arrayBuffer());

      onProgress?.({ fraction: 1, label: 'Complete' });

      return {
        bytes,
        mimeType: blob.type || 'image/png',
        width: request.width ?? this._profile?.defaults.width ?? 512,
        height: request.height ?? this._profile?.defaults.height ?? 512,
        engine: this.id,
        seed: prepared.seed,
        metadata: { ...prepared.metadata, bytes: bytes.length },
      };
    } finally {
      // Abort issues ComfyUI's native cancel (POST /interrupt). Also interrupt
      // when polling ended without a result so the GPU is not left busy.
      if (signal?.aborted || !polledResult) {
        void this._interrupt().catch(() => {});
      }
    }
  }

  /**
   * Builds the graph this request will submit.
   *
   * The legacy path is untouched — a request with no pinned profile builds the
   * same SD-XL graph it always did. A pinned profile compiles its own
   * versioned template, and the compiled graph is validated against the
   * installed node schema *here*, before the caller reaches `POST /prompt`, so
   * a missing node class, an uninstalled weight or a stray input fails without
   * occupying the GPU (AC-1).
   */
  private async _prepareWorkflow(
    request: GenerationRequest,
    callbacks?: GenerationCallbacks,
  ): Promise<PreparedComfyUiWorkflow> {
    const { signal, onProgress } = callbacks ?? {};

    if (!this._profile || !this._template) {
      return this._prepareLegacyWorkflow(request, callbacks);
    }

    // AC-2: a LoRA outside the profile's allowlist, or a capability the profile
    // does not prove, is refused before the graph is even built.
    const resolved = resolveWorkflowProfileForRequest({
      profileId: this._profile.id,
      ...(request.loras === undefined || request.loras.length === 0
        ? {}
        : { loras: request.loras.map((lora) => lora.path) }),
      capabilities: {
        negativePrompt: request.negativePrompt !== undefined,
        initImage: request.initImage !== undefined,
        mask: request.mask !== undefined,
        referenceImages:
          request.referenceImages !== undefined && request.referenceImages.length > 0,
      },
    });

    const nodeSchema = await this._loadNodeSchema(signal);
    const resolvedSeed = request.seed ?? Math.floor(Math.random() * 2 ** 32);

    const referenceImage = request.referenceImages?.[0] ?? request.initImage;
    const values = (referenceImageValue?: string): Record<string, string | number> => ({
      positivePrompt: request.positivePrompt,
      ...(request.negativePrompt === undefined ? {} : { negativePrompt: request.negativePrompt }),
      ...(request.width === undefined ? {} : { width: request.width }),
      ...(request.height === undefined ? {} : { height: request.height }),
      ...(request.steps === undefined ? {} : { steps: request.steps }),
      ...(request.cfgScale === undefined ? {} : { cfgScale: request.cfgScale }),
      ...(request.sampler === undefined ? {} : { sampler: request.sampler }),
      ...(request.denoise === undefined ? {} : { denoise: request.denoise }),
      seed: resolvedSeed,
      ...(referenceImageValue === undefined ? {} : { referenceImage: referenceImageValue }),
    });

    // Preflight the graph structure *before* uploading anything: a missing node
    // class or an uninstalled weight must not cost a multi-megabyte upload
    // first. The image input is bound to a placeholder name for this check and
    // replaced with the real upload name below.
    const preflight = compileWorkflow({
      profile: resolved.profile,
      template: resolved.template,
      values: values(referenceImage === undefined ? undefined : 'aikami-preflight.png'),
    });
    assertCompiledWorkflowRunnable({ workflow: preflight, nodeSchema });

    let referenceImageName: string | undefined;
    if (referenceImage !== undefined) {
      assertPayloadSize(referenceImage);
      onProgress?.({ fraction: 0.02, label: 'Uploading image' });
      referenceImageName = await this._uploadImage(referenceImage, signal);
    }

    const compiled = compileWorkflow({
      profile: resolved.profile,
      template: resolved.template,
      values: values(referenceImageName),
    });

    return {
      workflow: compiled.prompt,
      seed: resolvedSeed,
      metadata: {
        prompt: request.positivePrompt,
        profileId: resolved.profile.id,
        profileVersion: resolved.profile.version,
        workflowTemplate: resolved.template.id,
        workflowSha256: resolved.profile.templateSha256,
        semanticBindings: compiled.bindings.length,
      },
    };
  }

  /** The pre-C-520 SD-XL path, unchanged. */
  private _prepareLegacyWorkflow(
    request: GenerationRequest,
    callbacks?: GenerationCallbacks,
  ): PreparedComfyUiWorkflow | Promise<PreparedComfyUiWorkflow> {
    const { signal, onProgress } = callbacks ?? {};
    const sanitised = this._sanitiseRequest(request);
    const resolvedSeed = sanitised.seed ?? Math.floor(Math.random() * 2 ** 32);

    if (!sanitised.initImage) {
      const workflow = this._buildWorkflow({ ...sanitised, seed: resolvedSeed });
      return {
        workflow,
        seed: resolvedSeed,
        metadata: { prompt: request.positivePrompt },
      };
    }

    // The init image must be uploaded before the graph can name it, so this
    // path stays async even though it is otherwise a pure build.
    return this._uploadAndBuildLegacyWorkflow({
      request,
      sanitised,
      seed: resolvedSeed,
      ...(signal === undefined ? {} : { signal }),
      ...(onProgress === undefined ? {} : { onProgress }),
    });
  }

  private async _uploadAndBuildLegacyWorkflow(options: {
    request: GenerationRequest;
    sanitised: GenerationRequest;
    seed: number;
    signal?: AbortSignal;
    onProgress?: GenerationCallbacks['onProgress'];
  }): Promise<PreparedComfyUiWorkflow> {
    const initImage = options.sanitised.initImage;
    if (!initImage) {
      throw new Error('ComfyUI legacy path reached without an init image');
    }
    assertPayloadSize(initImage);
    options.onProgress?.({ fraction: 0.02, label: 'Uploading image' });
    const initImageName = await this._uploadImage(initImage, options.signal);
    return {
      workflow: this._buildWorkflow({
        ...options.sanitised,
        seed: options.seed,
        initImageName,
      }),
      seed: options.seed,
      metadata: { prompt: options.request.positivePrompt },
    };
  }

  /** Reads `/object_info`, caching the narrowed node schema. */
  private async _loadNodeSchema(signal?: AbortSignal): Promise<NodeSchema> {
    if (this._nodeSchema) {
      return this._nodeSchema;
    }
    const raw = await this._get<Record<string, unknown>>('/object_info', signal);
    const schema: Record<string, { input?: { required?: Record<string, unknown> } }> = {};
    for (const [classType, entry] of Object.entries(raw)) {
      if (entry === null || typeof entry !== 'object') {
        continue;
      }
      const node = entry as { input?: unknown };
      if (node.input === null || typeof node.input !== 'object') {
        schema[classType] = {};
        continue;
      }
      const input = node.input as { required?: unknown; optional?: unknown };
      schema[classType] = {
        input: {
          ...(input.required === null || typeof input.required !== 'object'
            ? {}
            : { required: input.required as Record<string, unknown> }),
          ...(input.optional === null || typeof input.optional !== 'object'
            ? {}
            : { optional: input.optional as Record<string, unknown> }),
        },
      };
    }
    this._nodeSchema = schema;
    return schema;
  }

  // ── Private ──────────────────────────────────────────────────────────

  private _assertConfigured(): void {
    if (!this._baseUrl) {
      throw new Error('Image engine is not configured (image.url missing from config.json)');
    }
  }

  /**
   * Strips fields the engine does not declare support for and drops
   * meaningless combinations (denoise without initImage).
   */
  private _sanitiseRequest(request: GenerationRequest): GenerationRequest {
    const sanitised: GenerationRequest = {
      modality: request.modality,
      positivePrompt: request.positivePrompt,
      model: request.model,
      width: request.width,
      height: request.height,
      steps: request.steps,
      cfgScale: request.cfgScale,
      sampler: request.sampler,
    };

    if (request.negativePrompt && this.capabilities.negativePrompt) {
      sanitised.negativePrompt = request.negativePrompt;
    }
    if (request.seed !== undefined && this.capabilities.seed) {
      sanitised.seed = request.seed;
    }
    if (request.initImage && this.capabilities.initImage) {
      sanitised.initImage = request.initImage;
      // denoise is only meaningful with initImage — strip otherwise
      if (request.denoise !== undefined) {
        sanitised.denoise = request.denoise;
      }
    }
    // mask / referenceImages / controlNet / lora — capabilities are false,
    // so the fields never reach the wire.

    return sanitised;
  }

  /**
   * Builds the ComfyUI API-format workflow.
   *
   * Node ids are the API contract (the frontend tests assert them), so they
   * are constants rather than reverse-engineered at runtime: 3 KSampler,
   * 4 CheckpointLoaderSimple, 5 EmptyLatentImage | 10 LoadImage + 11 VAEEncode,
   * 6/7 CLIPTextEncode, 8 VAEDecode, 9 SaveImage.
   */
  private _buildWorkflow(options: {
    positivePrompt: string;
    negativePrompt?: string;
    model?: string;
    width?: number;
    height?: number;
    steps?: number;
    cfgScale?: number;
    seed: number;
    sampler?: string;
    denoise?: number;
    initImageName?: string;
  }): Record<string, unknown> {
    const checkpointId = options.model || 'sd_xl_base_1.0';
    // Preserve the id when it already carries a recognized model extension;
    // append .safetensors only for bare ids (the ComfyUI default convention).
    const ckptName = /\.(?:safetensors|ckpt|sft|gguf)$/i.test(checkpointId)
      ? checkpointId
      : `${checkpointId}.safetensors`;

    const seed = options.seed;
    const steps = options.steps ?? 20;
    const cfg = options.cfgScale ?? 7.0;
    const sampler = options.sampler ?? 'euler';
    const width = options.width ?? 512;
    const height = options.height ?? 512;

    // img2img path: LoadImage → VAEEncode feeds the latent; txt2img path
    // uses EmptyLatentImage with denoise 1.
    const hasInitImage = Boolean(options.initImageName);
    const latentNodeId = hasInitImage ? '11' : '5';
    const denoise = hasInitImage ? (options.denoise ?? 0.5) : 1;

    const workflow: Record<string, unknown> = {
      '3': {
        class_type: 'KSampler',
        inputs: {
          seed,
          steps,
          cfg,
          sampler_name: sampler,
          scheduler: 'normal',
          denoise,
          model: ['4', 0],
          positive: ['6', 0],
          negative: ['7', 0],
          latent_image: [latentNodeId, 0],
        },
      },
      '4': {
        class_type: 'CheckpointLoaderSimple',
        inputs: { ckpt_name: ckptName },
      },
      '6': {
        class_type: 'CLIPTextEncode',
        inputs: { text: options.positivePrompt, clip: ['4', 1] },
      },
      '7': {
        class_type: 'CLIPTextEncode',
        inputs: { text: options.negativePrompt ?? '', clip: ['4', 1] },
      },
      '8': {
        class_type: 'VAEDecode',
        inputs: { samples: ['3', 0], vae: ['4', 2] },
      },
      '9': {
        class_type: 'SaveImage',
        inputs: { filename_prefix: 'aikami-gen', images: ['8', 0] },
      },
    };

    if (hasInitImage) {
      workflow['10'] = { class_type: 'LoadImage', inputs: { image: options.initImageName } };
      workflow['11'] = {
        class_type: 'VAEEncode',
        inputs: { pixels: ['10', 0], vae: ['4', 2] },
      };
    } else {
      workflow['5'] = {
        class_type: 'EmptyLatentImage',
        inputs: { width, height, batch_size: 1 },
      };
    }

    return workflow;
  }

  private async _uploadImage(dataUrl: string, signal?: AbortSignal): Promise<string> {
    const { bytes, mimeType } = decodeImagePayload(dataUrl);
    const formData = new FormData();
    formData.append('image', bytesToBlob(bytes, mimeType), 'input.png');

    const response = await fetch(`${this._baseUrl}/upload/image`, {
      method: 'POST',
      body: formData,
      signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`ComfyUI upload failed (${response.status}): ${text.slice(0, 200)}`);
    }

    const result = (await response.json()) as { name?: string };
    if (!result.name) {
      throw new Error('ComfyUI upload returned no image name');
    }
    return result.name;
  }

  private async _pollForResult(
    promptId: string,
    signal: AbortSignal | undefined,
    onProgress?: GenerationCallbacks['onProgress'],
  ): Promise<{ filename: string; subfolder: string | null }> {
    for (let attempt = 0; attempt < this._maxPollAttempts; attempt++) {
      assertNotAborted(signal);

      await sleep(POLL_INTERVAL_MS, signal);
      assertNotAborted(signal);

      const fraction = Math.min(
        DOWNLOADING_FRACTION,
        GENERATING_FRACTION + (attempt / this._maxPollAttempts) * 0.85,
      );
      onProgress?.({ fraction, label: 'Generating' });

      try {
        const history = await this._get<Record<string, ComfyUiHistoryEntry>>(
          `/history/${promptId}`,
          signal,
        );
        const entry = history[promptId];

        // Fail fast when ComfyUI reports the job failed instead of spinning
        // until the poll budget expires.
        if (entry?.status && !entry.status.completed) {
          const messages = entry.status.messages ?? [];
          const errorText = messages
            .filter(
              (message) =>
                message[0] === 'execution_error' || message[0] === 'execution_interrupted',
            )
            .map((message) => String(message[1] ?? ''))
            .filter(Boolean)
            .join('; ');
          throw new Error(`ComfyUI generation failed: ${errorText || 'workflow reported failure'}`);
        }

        const outputs = entry?.outputs;
        if (outputs) {
          for (const nodeOutput of Object.values(outputs)) {
            if (nodeOutput.images && nodeOutput.images.length > 0) {
              const image = nodeOutput.images[0];
              return { filename: image.filename, subfolder: image.subfolder ?? null };
            }
          }
        }
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }
        if (error instanceof Error && error.message.startsWith('ComfyUI generation failed')) {
          throw error;
        }
        // transient poll failure — keep trying
      }
    }

    throw new Error('Image generation timed out — ComfyUI did not complete in time');
  }

  /** Issues ComfyUI's native cancel. Fire-and-forget on abort. */
  private async _interrupt(): Promise<void> {
    await fetch(`${this._baseUrl}/interrupt`, { method: 'POST' });
  }

  private async _post<TResponse>(
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<TResponse> {
    const response = await fetch(`${this._baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`ComfyUI API error (${response.status}): ${text.slice(0, 200)}`);
    }

    return response.json() as Promise<TResponse>;
  }

  private async _get<TResponse>(path: string, signal?: AbortSignal): Promise<TResponse> {
    const response = await fetch(`${this._baseUrl}${path}`, {
      method: 'GET',
      signal,
    });

    if (!response.ok) {
      throw new Error(`ComfyUI error (${response.status})`);
    }

    return response.json() as Promise<TResponse>;
  }
}
