// packages/shared/constants/src/lib/local_models.ts
//
// Local model bundle declarations (C-427). Each bundle is a pinned revision
// with SHA-256 checksums for every asset. Adding a second bundle touches
// ONLY this file — no download, hashing, or Cache Storage logic in services/.

/** Path inside the HF repo, byte size, and pinned SHA-256. */
export type LocalModelAsset = {
  /** HuggingFace repo containing this asset. */
  readonly repo: string;
  /** Revision used to resolve this asset. */
  readonly revision: string;
  /** Path inside the HF repo. */
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  /** Cache Storage bucket this asset lands in. */
  readonly cache: string;
  /** Cache key the consuming engine resolves. */
  readonly key: string;
};

/** A pinned, versioned model bundle. */
export type LocalModelBundle = {
  readonly id: string; // 'kokoro-82m' | 'qwen3-0.6b'
  readonly repo: string; // HF repo id
  readonly revision: string; // pinned commit — never 'main'
  readonly label: string;
  readonly license: string;
  readonly modality: 'text' | 'voice' | 'stt' | 'image';
  readonly assets: readonly LocalModelAsset[];
  readonly manifestKey: string;
  readonly manifestVersion: number;
};

// ---------------------------------------------------------------------------
// Kokoro-82M (TTS voice model, C-389)
// ---------------------------------------------------------------------------

/** Canonical Kokoro model repo — the worker resolves URLs against this id. */
export const KOKORO_MODEL_ID = 'onnx-community/Kokoro-82M-ONNX';
/** Pinned Kokoro revision — the worker and the cache keys must agree. */
export const KOKORO_REVISION = 'f46687f7e41512228ae953af24a11b2640ea0f22';
const KOKORO_VOICE_REPO = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const KOKORO_VOICE_REVISION = 'main';

const TRANSFORMERS_CACHE = 'transformers-cache';
const KOKORO_VOICES_CACHE = 'kokoro-voices';

/**
 * Absolute origin every bundle manifest is keyed under in Cache Storage.
 *
 * A Cache Storage key given as a relative string is resolved against the
 * document base URL. That is harmless in a browser and in WebView2 (Windows
 * Tauri), where the app is served from `http://tauri.localhost`, but a
 * packaged Linux/macOS Tauri build is served from the `tauri://localhost`
 * custom protocol — and WebKit refuses a non-HTTP(S) request URL outright
 * (`Request url is not HTTP/HTTPS`).
 *
 * The failure was silent and late: every model byte downloaded and verified
 * fine, then the manifest write threw, so the whole download reported an
 * error and the model never reached `ready` (which is also why `status()`
 * kept answering `not-downloaded` and speech stayed silent). The manifest is
 * pure app bookkeeping and is never fetched over the network, so pinning it
 * to a stable absolute https URL is both sufficient and origin-independent.
 */
const MODEL_MANIFEST_ORIGIN = 'https://manifest.aikami.app/';

/** Absolute, origin-independent Cache Storage key for a bundle manifest. */
const modelManifestKey = (bundleId: string, version: number): string =>
  `${MODEL_MANIFEST_ORIGIN}${bundleId}/manifest-v${version}.json`;

/**
 * Cache keys are the exact URLs the Kokoro worker requests.
 *
 * They used to be `/models/<repo>/<file>`, which a static SPA host answers
 * with `index.html` — a cache miss surfaced as `Unexpected token '<'` rather
 * than a 404. Keying by the canonical remote URL keeps the bytes app-owned
 * (Cache Storage serves them offline) while making the request URL real.
 */
const kokoroCacheKey = (path: string): string =>
  `https://huggingface.co/${KOKORO_MODEL_ID}/resolve/${KOKORO_REVISION}/${path}`;

const kokoroVoiceCacheKey = (path: string): string =>
  `https://huggingface.co/${KOKORO_VOICE_REPO}/resolve/${KOKORO_VOICE_REVISION}/${path}`;

export const KOKORO_BUNDLE: LocalModelBundle = {
  id: 'kokoro-82m',
  repo: KOKORO_MODEL_ID,
  revision: KOKORO_REVISION,
  label: 'Kokoro 82M',
  license: 'Apache-2.0',
  modality: 'voice',
  assets: [
    {
      repo: KOKORO_MODEL_ID,
      revision: KOKORO_REVISION,
      path: 'config.json',
      bytes: 44,
      sha256: 'df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f',
      cache: TRANSFORMERS_CACHE,
      key: kokoroCacheKey('config.json'),
    },
    {
      repo: KOKORO_MODEL_ID,
      revision: KOKORO_REVISION,
      path: 'tokenizer.json',
      bytes: 4_608,
      sha256: 'ee301fc39cf903ddbb463564630a28767785e3a11edd6d8226e92d4b4ef131bb',
      cache: TRANSFORMERS_CACHE,
      key: kokoroCacheKey('tokenizer.json'),
    },
    {
      repo: KOKORO_MODEL_ID,
      revision: KOKORO_REVISION,
      path: 'onnx/model_quantized.onnx',
      bytes: 92_360_543,
      sha256: '0d55b15d4b735d61a21b0105136bc81b8768c4db94753193c19354fa863cd556',
      cache: TRANSFORMERS_CACHE,
      key: kokoroCacheKey('onnx/model_quantized.onnx'),
    },
    {
      repo: KOKORO_VOICE_REPO,
      revision: KOKORO_VOICE_REVISION,
      path: 'voices/af_heart.bin',
      bytes: 522_240,
      sha256: 'd583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b',
      cache: KOKORO_VOICES_CACHE,
      key: kokoroVoiceCacheKey('voices/af_heart.bin'),
    },
  ],
  manifestKey: modelManifestKey('kokoro-82m', 4),
  // 3: cache keys moved from `/models/...` to the canonical HuggingFace URLs.
  // Existing installs must re-download so the new keys are populated.
  // 4: manifest key moved from the document-relative
  // `aikami-voice-model/manifest-v1` to an absolute https URL, so it no
  // longer resolves against the `tauri://localhost` origin on Linux/macOS.
  manifestVersion: 4,
};

// ---------------------------------------------------------------------------
// Qwen3-0.6B-ONNX (text LLM for micro-tasks, C-427)
// ---------------------------------------------------------------------------

const QWEN3_MODEL_ID = 'onnx-community/Qwen3-0.6B-ONNX';
const QWEN3_REVISION = 'da1453100cf3ff33ef56d17983fc7a8648706db6';

const qwen3CacheKey = (path: string): string => `/models/${QWEN3_MODEL_ID}/${path}`;

export const QWEN3_BUNDLE: LocalModelBundle = {
  id: 'qwen3-0.6b',
  repo: QWEN3_MODEL_ID,
  revision: QWEN3_REVISION,
  label: 'Qwen3 0.6B',
  license: 'Apache-2.0',
  modality: 'text',
  assets: [
    {
      repo: QWEN3_MODEL_ID,
      revision: QWEN3_REVISION,
      path: 'config.json',
      bytes: 44,
      sha256: 'placeholder', // FIXME: gen_model_bundle.ts will replace this
      cache: TRANSFORMERS_CACHE,
      key: qwen3CacheKey('config.json'),
    },
    {
      repo: QWEN3_MODEL_ID,
      revision: QWEN3_REVISION,
      path: 'tokenizer.json',
      bytes: 4_608,
      sha256: 'placeholder',
      cache: TRANSFORMERS_CACHE,
      key: qwen3CacheKey('tokenizer.json'),
    },
    {
      repo: QWEN3_MODEL_ID,
      revision: QWEN3_REVISION,
      path: 'onnx/model_q4f16.onnx',
      bytes: 570_000_000, // approximate — gen_model_bundle.ts will compute exact
      sha256: 'placeholder',
      cache: TRANSFORMERS_CACHE,
      key: qwen3CacheKey('onnx/model_q4f16.onnx'),
    },
  ],
  manifestKey: modelManifestKey('qwen3-0.6b', 2),
  manifestVersion: 2,
};

/** Registry of all known bundles, keyed by bundle id. */
export const LOCAL_MODEL_BUNDLES: Record<string, LocalModelBundle> = {
  'kokoro-82m': KOKORO_BUNDLE,
  'qwen3-0.6b': QWEN3_BUNDLE,
} as const;
