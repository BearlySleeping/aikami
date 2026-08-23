// packages/shared/constants/src/lib/local_models.ts
//
// Local model bundle declarations (C-427). Each bundle is a pinned revision
// with SHA-256 checksums for every asset. Adding a second bundle touches
// ONLY this file — no download, hashing, or Cache Storage logic in services/.

/** Path inside the HF repo, byte size, and pinned SHA-256. */
export type LocalModelAsset = {
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

const KOKORO_MODEL_ID = 'onnx-community/Kokoro-82M-ONNX';
const KOKORO_REVISION = 'f46687f7e41512228ae953af24a11b2640ea0f22';
const KOKORO_VOICE_REPO = 'onnx-community/Kokoro-82M-v1.0-ONNX';

const TRANSFORMERS_CACHE = 'transformers-cache';
const KOKORO_VOICES_CACHE = 'kokoro-voices';

const kokoroCacheKey = (path: string): string => `/models/${KOKORO_MODEL_ID}/${path}`;

const kokoroVoiceCacheKey = (path: string): string =>
  `https://huggingface.co/${KOKORO_VOICE_REPO}/resolve/main/${path}`;

export const KOKORO_BUNDLE: LocalModelBundle = {
  id: 'kokoro-82m',
  repo: KOKORO_MODEL_ID,
  revision: KOKORO_REVISION,
  label: 'Kokoro 82M',
  license: 'Apache-2.0',
  modality: 'voice',
  assets: [
    {
      path: 'config.json',
      bytes: 44,
      sha256: 'df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f',
      cache: TRANSFORMERS_CACHE,
      key: kokoroCacheKey('config.json'),
    },
    {
      path: 'tokenizer.json',
      bytes: 4_608,
      sha256: 'ee301fc39cf903ddbb463564630a28767785e3a11edd6d8226e92d4b4ef131bb',
      cache: TRANSFORMERS_CACHE,
      key: kokoroCacheKey('tokenizer.json'),
    },
    {
      path: 'onnx/model_quantized.onnx',
      bytes: 92_360_543,
      sha256: '0d55b15d4b735d61a21b0105136bc81b8768c4db94753193c19354fa863cd556',
      cache: TRANSFORMERS_CACHE,
      key: kokoroCacheKey('onnx/model_quantized.onnx'),
    },
    {
      path: 'voices/af_heart.bin',
      bytes: 522_240,
      sha256: 'd583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b',
      cache: KOKORO_VOICES_CACHE,
      key: kokoroVoiceCacheKey('voices/af_heart.bin'),
    },
  ],
  manifestKey: 'aikami-voice-model/manifest-v1',
  manifestVersion: 2,
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
      path: 'config.json',
      bytes: 44,
      sha256: 'placeholder', // FIXME: gen_model_bundle.ts will replace this
      cache: TRANSFORMERS_CACHE,
      key: qwen3CacheKey('config.json'),
    },
    {
      path: 'tokenizer.json',
      bytes: 4_608,
      sha256: 'placeholder',
      cache: TRANSFORMERS_CACHE,
      key: qwen3CacheKey('tokenizer.json'),
    },
    {
      path: 'onnx/model_q4f16.onnx',
      bytes: 570_000_000, // approximate — gen_model_bundle.ts will compute exact
      sha256: 'placeholder',
      cache: TRANSFORMERS_CACHE,
      key: qwen3CacheKey('onnx/model_q4f16.onnx'),
    },
  ],
  manifestKey: 'aikami-text-model/manifest-v1',
  manifestVersion: 1,
};

/** Registry of all known bundles, keyed by bundle id. */
export const LOCAL_MODEL_BUNDLES: Record<string, LocalModelBundle> = {
  'kokoro-82m': KOKORO_BUNDLE,
  'qwen3-0.6b': QWEN3_BUNDLE,
} as const;
