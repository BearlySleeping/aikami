// apps/frontend/client/src/lib/services/audio/voice_model_service.svelte.ts
//
// On-demand Kokoro voice model download manager (C-389 AC-4b / AC-4c / AC-5).
//
// The weights are NEVER bundled into the installer and never fetched
// implicitly on first speech. TTS starts in `not-downloaded`; the settings
// UI offers an explicit "Download voice model" control showing the size.
//
// Browser path: files are fetched (with progress) from the runtime-configured
// model origin, SHA-256 verified against a pinned manifest, and stored in the
// browser Cache Storage under transformers.js's local-model keys
// (`/models/{modelId}/{file}`), so the worker loads them with zero network.
// The default voice embedding is pre-warmed into kokoro-js's own
// `kokoro-voices` cache.
//
// Tauri path: files are downloaded by the Rust side (bypassing webview CSP),
// checksum-verified in Rust, and written to the app data directory. The JS
// side then reads them back and pre-warms the same Cache Storage keys so the
// worker uses one uniform loading path.
//
// Downloads are explicit, cancellable, resumable (re-call joins the in-flight
// promise), and idempotent.

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { VoiceModelState } from '$types';
import { runtimeConfigService } from '../config/runtime_config_service.svelte.ts';

export type VoiceModelServiceOptions = BaseFrontendClassOptions;

export type VoiceModelServiceInterface = BaseFrontendClassInterface & {
  /** Lifecycle of the voice model download (AC-4b/4c). */
  readonly state: VoiceModelState;

  /** Total download size in bytes (shown before the user commits). */
  readonly totalBytes: number;

  /** True while a download is in flight. */
  readonly isDownloading: boolean;

  /** Re-checks the cache and reports ready/not-downloaded. */
  checkStatus(): Promise<VoiceModelState>;

  /** Starts (or joins) the explicit model download. */
  download(): Promise<VoiceModelState>;

  /** Aborts an in-flight download; state returns to not-downloaded. */
  cancel(): void;

  /** Removes the cached model; state returns to not-downloaded. */
  deleteModel(): Promise<void>;
};

// ---------------------------------------------------------------------------
// Pinned manifest (C-389). Revision pinned, not `main`, so a republished
// upstream weight cannot break every install (checksum drift guard).
// ---------------------------------------------------------------------------

const MODEL_ID = 'onnx-community/Kokoro-82M-ONNX';
const MODEL_REVISION = 'f46687f7e41512228ae953af24a11b2640ea0f22';
const VOICE_REPO = 'onnx-community/Kokoro-82M-v1.0-ONNX';

type ManifestFile = {
  /** Path inside the model repo. */
  path: string;
  /** Expected byte size. */
  size: number;
  /** Pinned SHA-256 of the exact revision bytes. */
  sha256: string;
};

const MODEL_FILES: readonly ManifestFile[] = [
  {
    path: 'config.json',
    size: 44,
    sha256: 'df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f',
  },
  {
    path: 'tokenizer.json',
    size: 4_608,
    sha256: 'ee301fc39cf903ddbb463564630a28767785e3a11edd6d8226e92d4b4ef131bb',
  },
  {
    path: 'onnx/model_quantized.onnx',
    size: 92_360_543,
    sha256: '0d55b15d4b735d61a21b0105136bc81b8768c4db94753193c19354fa863cd556',
  },
];

/** Default voice embedding pre-warmed so first offline synthesis works. */
const VOICE_FILES: readonly ManifestFile[] = [
  {
    path: 'voices/af_heart.bin',
    size: 522_240,
    sha256: 'd583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b',
  },
];

const TRANSFORMERS_CACHE = 'transformers-cache';
const KOKORO_VOICES_CACHE = 'kokoro-voices';
const MANIFEST_KEY = 'aikami-voice-model/manifest-v1';

/** localPath cache key transformers.js resolves first (env.localModelPath). */
const localCacheKey = (path: string): string => `/models/${MODEL_ID}/${path}`;

/** The remote URL transformers.js / kokoro-js uses for this file. */
const remoteModelUrl = (path: string, origin: string): string =>
  `${origin}/${MODEL_ID}/resolve/${MODEL_REVISION}/${path}`;

const voiceCacheKey = (path: string): string =>
  `https://huggingface.co/${VOICE_REPO}/resolve/main/${path}`;

/**
 * Actual network URL for a voice file, derived from the configured model
 * origin (C-389 CR) — the cache key above stays canonical for kokoro-js
 * while the fetch honors `models.originUrl`.
 */
const voiceFetchUrl = (path: string, origin: string): string =>
  `${origin}/${VOICE_REPO}/resolve/main/${path}`;

/** True when running inside a Tauri webview. */
const isTauriRuntime = (): boolean =>
  typeof window !== 'undefined' &&
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ !== undefined;

const tauriInvoke = (cmd: string, args?: Record<string, unknown>): Promise<unknown> => {
  const internals = (
    window as unknown as {
      // biome-ignore lint/style/useNamingConvention: Tauri global API name
      __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<unknown> };
    }
  ).__TAURI_INTERNALS__;
  return internals.invoke(cmd, args);
};

const sha256Hex = async (buffer: ArrayBuffer): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

class VoiceModelService
  extends BaseFrontendClass<VoiceModelServiceOptions>
  implements VoiceModelServiceInterface
{
  state = $state<VoiceModelState>({ status: 'not-downloaded', bytes: 0 });

  private _abortController: AbortController | undefined;
  private _inflight: Promise<VoiceModelState> | undefined;

  get totalBytes(): number {
    return [...MODEL_FILES, ...VOICE_FILES].reduce((sum, f) => sum + f.size, 0);
  }

  get isDownloading(): boolean {
    return this.state.status === 'downloading' || this.state.status === 'verifying';
  }

  // -----------------------------------------------------------------------
  // Status
  // -----------------------------------------------------------------------

  /** @inheritdoc */
  async checkStatus(): Promise<VoiceModelState> {
    try {
      if (typeof caches === 'undefined') {
        this.state = { status: 'not-downloaded', bytes: this.totalBytes };
        return this.state;
      }
      const cache = await caches.open(TRANSFORMERS_CACHE);
      const manifest = await cache.match(MANIFEST_KEY);
      if (!manifest) {
        this.state = { status: 'not-downloaded', bytes: this.totalBytes };
        return this.state;
      }
      const meta = (await manifest.json()) as {
        files?: Array<{ cache?: string; key?: string }> | string[];
        version?: number;
      };
      // v1 manifests predate the voice files (C-389 CR) — treat as
      // not-downloaded so the download re-runs and includes the voice.
      if ((meta.version ?? 1) < 2) {
        this.state = { status: 'not-downloaded', bytes: this.totalBytes };
        return this.state;
      }
      const entries = (meta.files ?? []).map((entry) =>
        typeof entry === 'string'
          ? { cache: TRANSFORMERS_CACHE, key: entry }
          : { cache: entry.cache ?? TRANSFORMERS_CACHE, key: entry.key ?? '' },
      );
      const allPresent = (
        await Promise.all(
          entries.map(async (entry) => {
            const cache = await caches.open(entry.cache);
            return (await cache.match(entry.key)) !== undefined;
          }),
        )
      ).every(Boolean);
      if (allPresent && entries.length > 0) {
        this.state = { status: 'ready' };
      } else {
        this.state = { status: 'not-downloaded', bytes: this.totalBytes };
      }
      return this.state;
    } catch (error) {
      this.warn('checkStatus:failed', error);
      this.state = { status: 'not-downloaded', bytes: this.totalBytes };
      return this.state;
    }
  }

  // -----------------------------------------------------------------------
  // Download
  // -----------------------------------------------------------------------

  /** @inheritdoc */
  async download(): Promise<VoiceModelState> {
    if (this.state.status === 'ready') {
      return this.state;
    }
    // Idempotent join: a second call while one is in flight joins it.
    if (this._inflight) {
      return await this._inflight;
    }
    this._inflight = this._runDownload();
    try {
      return await this._inflight;
    } finally {
      this._inflight = undefined;
    }
  }

  private async _runDownload(): Promise<VoiceModelState> {
    const controller = new AbortController();
    this._abortController = controller;
    const total = this.totalBytes;

    this.state = { status: 'downloading', receivedBytes: 0, totalBytes: total };

    try {
      if (isTauriRuntime()) {
        await this._downloadTauri({ total, signal: controller.signal });
      } else {
        await this._downloadBrowser({ total, signal: controller.signal });
      }
      if (controller.signal.aborted) {
        this.state = { status: 'not-downloaded', bytes: total };
        return this.state;
      }

      this.state = { status: 'verifying' };
      // Files were checksum-verified during download; write the manifest so
      // checkStatus() can report ready without re-hashing.
      await this._writeManifest();
      this.state = { status: 'ready' };
      this.info('voice-model:ready', { bytes: total });
      return this.state;
    } catch (error) {
      const aborted = controller.signal.aborted || (error as Error)?.name === 'AbortError';
      if (aborted) {
        this.state = { status: 'not-downloaded', bytes: total };
      } else {
        const message = error instanceof Error ? error.message : 'Voice model download failed';
        this.error('voice-model:failed', { message });
        this.state = { status: 'error', message, retryable: true };
      }
      return this.state;
    } finally {
      this._abortController = undefined;
    }
  }

  private async _downloadBrowser(options: { total: number; signal: AbortSignal }): Promise<void> {
    const { total, signal } = options;
    const origin =
      runtimeConfigService.getModelsOrigin()?.replace(/\/+$/, '') ?? 'https://huggingface.co';

    let received = 0;

    const downloadFile = async (
      file: ManifestFile,
      url: string,
      cacheName: string,
      cacheKey: string,
    ): Promise<void> => {
      const response = await fetch(url, { signal });
      if (!response.ok || !response.body) {
        throw new Error(`Failed to download ${file.path} (HTTP ${response.status})`);
      }

      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let downloaded = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        downloaded += value.byteLength;
        // C-389 CR: enforce the expected size while streaming — abort before
        // buffering an oversized response.
        if (downloaded > file.size) {
          throw new Error(`Download exceeded expected size for ${file.path} (${file.size} bytes)`);
        }
        chunks.push(value);
        received += value.byteLength;
        this.state = {
          status: 'downloading',
          receivedBytes: received,
          totalBytes: total,
        };
      }

      const buffer = new Uint8Array(downloaded);
      let offset = 0;
      for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.byteLength;
      }

      if (downloaded !== file.size) {
        throw new Error(`Size mismatch for ${file.path}: expected ${file.size}, got ${downloaded}`);
      }
      const hash = await sha256Hex(buffer.buffer as ArrayBuffer);
      if (hash !== file.sha256) {
        throw new Error(`Checksum mismatch for ${file.path}: expected ${file.sha256}, got ${hash}`);
      }

      const cache = await caches.open(cacheName);
      await cache.put(
        cacheKey,
        new Response(buffer, {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(downloaded),
          },
        }),
      );
    };

    for (const file of MODEL_FILES) {
      await downloadFile(
        file,
        remoteModelUrl(file.path, origin),
        TRANSFORMERS_CACHE,
        localCacheKey(file.path),
      );
    }
    for (const file of VOICE_FILES) {
      await downloadFile(
        file,
        voiceFetchUrl(file.path, origin),
        KOKORO_VOICES_CACHE,
        voiceCacheKey(file.path),
      );
    }
  }

  private async _downloadTauri(options: { total: number; signal: AbortSignal }): Promise<void> {
    const { total, signal } = options;
    const origin =
      runtimeConfigService.getModelsOrigin()?.replace(/\/+$/, '') ?? 'https://huggingface.co';

    // Cumulative bytes across already-completed files; per-file progress
    // events from Rust are added on top of this base.
    let base = 0;

    const downloadTauriFile = async (
      file: ManifestFile,
      url: string,
      cacheName: string,
      cacheKey: string,
    ): Promise<void> => {
      // C-389 CR: cancellation takes effect between files (Rust has no abort
      // channel) — checked before every file in both loops.
      if (signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      const unlisten = await this._listenTauriProgress(file.path, (receivedBytes) => {
        this.state = {
          status: 'downloading',
          receivedBytes: Math.min(total, base + receivedBytes),
          totalBytes: total,
        };
      });
      try {
        // Rust-side download: bypasses webview CSP, verifies SHA-256 + size,
        // writes to the app data dir, and emits progress events.
        await tauriInvoke('download_model_file', {
          url,
          checksum: file.sha256,
          fileName: file.path,
          expectedSize: file.size,
        });
      } finally {
        unlisten();
      }

      base += file.size;
      this.state = {
        status: 'downloading',
        receivedBytes: base,
        totalBytes: total,
      };

      // Read the verified bytes back so the worker can load from the
      // standard transformers Cache Storage path. C-389 CR: Rust returns the
      // bytes as a raw payload (tauri::ipc::Response) → ArrayBuffer.
      const buffer = (await tauriInvoke('read_model_file', {
        fileName: file.path,
      })) as ArrayBuffer;
      if (buffer.byteLength !== file.size) {
        throw new Error(`Size mismatch for ${file.path} after Rust download`);
      }
      const cache = await caches.open(cacheName);
      await cache.put(
        cacheKey,
        new Response(buffer, {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(buffer.byteLength),
          },
        }),
      );
    };

    for (const file of MODEL_FILES) {
      await downloadTauriFile(
        file,
        remoteModelUrl(file.path, origin),
        TRANSFORMERS_CACHE,
        localCacheKey(file.path),
      );
    }
    for (const file of VOICE_FILES) {
      await downloadTauriFile(
        file,
        voiceFetchUrl(file.path, origin),
        KOKORO_VOICES_CACHE,
        voiceCacheKey(file.path),
      );
    }
  }

  /**
   * Subscribes to Rust-side per-file progress events. Resolves only once the
   * listener is registered so a fast download cannot complete before
   * `unlisten` exists (C-389 CR) — no fire-and-forget listener leak.
   */
  private async _listenTauriProgress(
    fileName: string,
    onProgress: (receivedBytes: number) => void,
  ): Promise<() => void> {
    const eventApi = (
      window as unknown as {
        // biome-ignore lint/style/useNamingConvention: Tauri global event API name
        __TAURI_EVENT__?: {
          listen: (
            event: string,
            handler: (e: { payload: unknown }) => void,
          ) => Promise<() => void>;
        };
      }
    ).__TAURI_EVENT__;
    if (!eventApi?.listen) {
      return () => {};
    }
    try {
      return await eventApi.listen('model-download-progress', (event) => {
        const payload = event.payload as { file?: string; receivedBytes?: number };
        if (payload.file === fileName && payload.receivedBytes !== undefined) {
          onProgress(payload.receivedBytes);
        }
      });
    } catch {
      // Event API unavailable — per-file completion still drives the state.
      return () => {};
    }
  }

  private async _writeManifest(): Promise<void> {
    const cache = await caches.open(TRANSFORMERS_CACHE);
    // C-389 CR: record the cache name alongside every key so checkStatus can
    // verify model AND voice entries; version bumped to 2 (voice included).
    const files: Array<{ cache: string; key: string }> = [
      ...MODEL_FILES.map((f) => ({ cache: TRANSFORMERS_CACHE, key: localCacheKey(f.path) })),
      ...VOICE_FILES.map((f) => ({ cache: KOKORO_VOICES_CACHE, key: voiceCacheKey(f.path) })),
    ];
    await cache.put(
      MANIFEST_KEY,
      new Response(JSON.stringify({ files, version: 2 }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }

  // -----------------------------------------------------------------------
  // Cancel / delete
  // -----------------------------------------------------------------------

  /** @inheritdoc */
  cancel(): void {
    this._abortController?.abort();
    this._abortController = undefined;
  }

  /** @inheritdoc */
  async deleteModel(): Promise<void> {
    if (typeof caches === 'undefined') {
      this.state = { status: 'not-downloaded', bytes: this.totalBytes };
      return;
    }
    try {
      const cache = await caches.open(TRANSFORMERS_CACHE);
      await Promise.all(MODEL_FILES.map((f) => cache.delete(localCacheKey(f.path))));
      await cache.delete(MANIFEST_KEY);
      const voices = await caches.open(KOKORO_VOICES_CACHE);
      await Promise.all(VOICE_FILES.map((f) => voices.delete(voiceCacheKey(f.path))));
      if (isTauriRuntime()) {
        await tauriInvoke('delete_model_files', {
          files: [...MODEL_FILES.map((f) => f.path), ...VOICE_FILES.map((f) => f.path)],
        }).catch(() => {
          // Best-effort — cache removal is authoritative for the worker.
        });
      }
      this.state = { status: 'not-downloaded', bytes: this.totalBytes };
      this.info('voice-model:deleted');
    } catch (error) {
      this.error('voice-model:delete-failed', error);
    }
  }
}

export const voiceModelService: VoiceModelServiceInterface = VoiceModelService.create({
  className: 'VoiceModelService',
});
