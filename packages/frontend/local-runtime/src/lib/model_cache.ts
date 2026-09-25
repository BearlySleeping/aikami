// packages/frontend/local-runtime/src/lib/model_cache.ts
//
// The app-owned model cache boundary for `@huggingface/transformers`.
//
// Why this exists
// ---------------
// transformers.js resolves a model file like this (v3 `getModelFile`):
//
//     response = await tryCache(cache, localPath, proposedCacheKey)
//     //                        ^^^^^^^^^ always tried first, regardless of
//     //                                  env.allowLocalModels
//
// `localPath` is `env.localModelPath + requestURL` — a document-relative URL
// such as `/models/onnx-community/Kokoro-82M-ONNX/config.json`. Inside a
// packaged Tauri SPA that path is answered by the app's own asset handler with
// `index.html` and HTTP 200. transformers caches any 200 without checking the
// content type, so WebView2 persists a poisoned HTML entry in
// `transformers-cache` — and it keeps winning the lookup on every later launch,
// long after the configuration that created it was fixed.
//
// Switching to remote resolution does not help, because the lookup order does
// not change. The only reliable fix is to own the cache: hand transformers a
// `customCache` that refuses every key that is not a canonical, pinned model
// URL, so the relative key can never match and the app-controlled bytes are
// served from the canonical URL instead.
//
// Additionally, a response is only stored after it is checked not to be HTML,
// so a proxy captive portal or an SPA fallback can never poison the bucket
// again.

/** Canonical model origin used by every Aikami model bundle. */
export const MODEL_ORIGIN = 'https://huggingface.co/';

/** Storage backend the cache reads and writes through (Cache Storage in the app). */
export type ModelCacheBackend = {
  match(url: string): Promise<Response | undefined>;
  put(url: string, response: Response): Promise<void>;
};

/** Keys transformers may ask for: a string, a `URL`, or a `Request`. */
export type ModelCacheKey = string | URL | Request;

export type PinnedModelCacheOptions = {
  /** Canonical origin every model URL must start with. */
  origin: string;
  /** Repo ids this cache is allowed to serve, e.g. `onnx-community/Kokoro-82M-ONNX`. */
  repos: readonly string[];
  /** Pinned revision; `main` is never accepted. */
  revision: string;
  /** Called once per rejected key shape, for diagnostics. */
  onReject?: (key: string) => void;
};

/** Normalize any transformers cache key to an absolute URL string. */
const keyToUrl = (key: ModelCacheKey): string => {
  if (typeof key === 'string') {
    return key;
  }
  if (key instanceof URL) {
    return key.href;
  }
  return key.url;
};

/**
 * Whether `url` is a canonical, pinned model URL this cache may serve.
 *
 * Everything else — document-relative `/models/...` keys, other origins,
 * `main` revisions, lookalike hosts — is rejected, which is what makes the
 * poisoned-entry class of failure unreachable.
 */
export const isCanonicalModelUrl = (
  url: string,
  options: Pick<PinnedModelCacheOptions, 'origin' | 'repos' | 'revision'>,
): boolean => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') {
    return false;
  }
  const origin = options.origin.endsWith('/') ? options.origin : `${options.origin}/`;
  if (!url.startsWith(origin)) {
    return false;
  }
  const rest = url.slice(origin.length);
  return options.repos.some((repo) => {
    const expected = `${repo}/resolve/${options.revision}/`;
    return rest.startsWith(expected) && !rest.includes('../');
  });
};

/**
 * True when a response body looks like an HTML document rather than model
 * bytes. Used to reject SPA fallbacks and captive portals before they are
 * cached, so a bad response fails once instead of poisoning every later run.
 */
export const responseLooksLikeHtml = async (response: Response): Promise<boolean> => {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/html')) {
    return true;
  }
  // Some SPA fallbacks are served with no content type at all, so peek at the
  // first bytes. The body is read one chunk and cancelled: model weights are
  // tens of megabytes and must never be buffered to be sniffed.
  const body = response.clone().body;
  if (!body || typeof body.getReader !== 'function') {
    return false;
  }
  const reader = body.getReader();
  try {
    const first = await reader.read();
    if (first.done) {
      return false;
    }
    const head = new TextDecoder().decode(first.value).trimStart();
    return head.startsWith('<!DOCTYPE') || head.startsWith('<html');
  } catch {
    return false;
  } finally {
    await reader.cancel().catch(() => {});
  }
};

export type PinnedModelCache = {
  match(key: ModelCacheKey): Promise<Response | undefined>;
  put(key: ModelCacheKey, response: Response): Promise<void>;
};

/** Cache Storage bucket the pre-download control writes model bytes into. */
export const TRANSFORMERS_CACHE_NAME = 'transformers-cache';

/**
 * A {@link ModelCacheBackend} over the browser Cache Storage.
 *
 * This is the same bucket `ModelAssetStore` pre-warms after a verified Rust
 * download, which is what lets the worker load the model with no network.
 */
export const createCacheStorageBackend = (
  cacheName: string = TRANSFORMERS_CACHE_NAME,
): ModelCacheBackend => ({
  async match(url: string): Promise<Response | undefined> {
    if (typeof caches === 'undefined') {
      return undefined;
    }
    const cache = await caches.open(cacheName);
    return (await cache.match(url)) ?? undefined;
  },
  async put(url: string, response: Response): Promise<void> {
    if (typeof caches === 'undefined') {
      return;
    }
    const cache = await caches.open(cacheName);
    await cache.put(url, response);
  },
});

/**
 * Build the `env.customCache` implementation.
 *
 * `match` answers only for canonical pinned URLs; everything else is a miss so
 * transformers falls through to the network rather than reading a stale
 * same-origin entry. `put` refuses to store HTML, so the bucket cannot be
 * poisoned by an SPA fallback or an intercepting proxy.
 */
export const createPinnedModelCache = (
  backend: ModelCacheBackend,
  options: PinnedModelCacheOptions,
): PinnedModelCache => {
  const rejected = new Set<string>();

  const reject = (url: string): undefined => {
    if (!rejected.has(url)) {
      rejected.add(url);
      options.onReject?.(url);
    }
    return undefined;
  };

  return {
    async match(key: ModelCacheKey): Promise<Response | undefined> {
      const url = keyToUrl(key);
      if (!isCanonicalModelUrl(url, options)) {
        return reject(url);
      }
      return await backend.match(url);
    },

    async put(key: ModelCacheKey, response: Response): Promise<void> {
      const url = keyToUrl(key);
      if (!isCanonicalModelUrl(url, options)) {
        reject(url);
        return;
      }
      if (await responseLooksLikeHtml(response)) {
        throw new Error(
          `Refusing to cache an HTML response for model file ${url}. ` +
            'The request was answered by a web page, not the model origin.',
        );
      }
      await backend.put(url, response);
    },
  };
};
