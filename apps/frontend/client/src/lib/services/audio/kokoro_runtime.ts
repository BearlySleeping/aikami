// apps/frontend/client/src/lib/services/audio/kokoro_runtime.ts
import { KOKORO_BUNDLE, KOKORO_REVISION } from '@aikami/constants';
import type { KokoroDevicePreference } from './kokoro_worker_protocol.ts';

/** Use downloaded q8 on the requested backend; never fetch alternate weights implicitly. */
export const kokoroLoadPlan = (options: {
  device: KokoroDevicePreference;
  gpuSupported: boolean;
}) => {
  const useWebGpu = options.device !== 'wasm' && options.gpuSupported;
  const device = useWebGpu ? ('webgpu' as const) : ('wasm' as const);
  const fallbackReason =
    options.device !== 'wasm' && !options.gpuSupported
      ? 'WebGPU is unavailable in this worker. Using cached q8 on WASM.'
      : undefined;
  const pretrained = {
    revision: KOKORO_REVISION,
    // biome-ignore lint/style/useNamingConvention: Transformers public API spelling.
    local_files_only: true,
  };
  return {
    model: { ...pretrained, dtype: 'q8' as const, device },
    tokenizer: {
      key: `https://huggingface.co/${KOKORO_BUNDLE.repo}/resolve/${KOKORO_REVISION}/tokenizer.json`,
      // Exact metadata from tokenizer_config.json at KOKORO_REVISION. Shipping
      // these 4 scalar values avoids invalidating existing 92 MB downloads.
      config: {
        // biome-ignore lint/style/useNamingConvention: Transformers tokenizer configuration.
        model_max_length: 512,
        // biome-ignore lint/style/useNamingConvention: Transformers tokenizer configuration.
        pad_token: '$',
        // biome-ignore lint/style/useNamingConvention: Transformers tokenizer configuration.
        tokenizer_class: 'PreTrainedTokenizer',
        // biome-ignore lint/style/useNamingConvention: Transformers tokenizer configuration.
        unk_token: '$',
      },
    },
    fallbackReason,
  };
};

/** Kokoro's independent voice loader must never download a voice implicitly. */
export const createKokoroFetch = (options: {
  fetch: typeof globalThis.fetch;
  match(cache: string, key: string): Promise<Response | undefined>;
}): typeof globalThis.fetch => {
  const cachedFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith('https://huggingface.co/') && !url.startsWith('/models/')) {
      // Runtime glue, WASM and phonemizer assets are not model downloads.
      return options.fetch(input, init);
    }
    const asset = KOKORO_BUNDLE.assets.find((candidate) => candidate.key === url);
    const response = asset ? await options.match(asset.cache, asset.key) : undefined;
    if (!response) {
      throw new Error(
        `Kokoro model cache miss: ${url}. Download the voice model explicitly before synthesis.`,
      );
    }
    return response;
  };
  return Object.assign(cachedFetch, { preconnect: options.fetch.preconnect });
};
