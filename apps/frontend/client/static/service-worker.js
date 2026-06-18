// apps/frontend/client/static/service-worker.js
//
// Service Worker — Audio Range Request Interceptor (C-150)
//
// iOS Safari requires HTTP 206 Partial Content with correct byte-range
// headers for Web Audio API playback. Without this, audio elements and
// AudioContext.decodeAudioData() silently fail on iOS.
//
// This worker intercepts requests to /assets/audio/ and:
// 1. Fetches the full asset if not cached
// 2. Reads the ArrayBuffer from the response
// 3. Slices it according to the Range header
// 4. Returns a 206 Partial Content response

/** Base path for audio assets to intercept. */
const AUDIO_PATH_PREFIX = '/assets/audio/';

/**
 * Opens (or creates) a dedicated cache for audio assets.
 * @returns {Promise<Cache>}
 */
const openAudioCache = async () => {
  return caches.open('aikami-audio-v1');
};

/**
 * Fetches an audio asset, caches it for future Range requests,
 * and returns the raw ArrayBuffer.
 *
 * @param {string} url — absolute URL of the audio asset
 * @returns {Promise<ArrayBuffer>}
 */
const fetchAndCacheAsset = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch audio asset: ${response.status}`);
  }

  // Clone before reading to preserve for cache storage
  const cloned = response.clone();

  // Store in cache for subsequent byte-range slicing
  const cache = await openAudioCache();
  await cache.put(url, cloned);

  return response.arrayBuffer();
};

/**
 * Reads the audio asset from cache (or fetches + caches if missing),
 * slices it according to the Range header, and returns a 206 response.
 *
 * @param {Request} request — the original fetch event request
 * @returns {Promise<Response>}
 */
const handleRangeRequest = async (request) => {
  const url = request.url;

  let arrayBuffer;
  const cache = await openAudioCache();
  const cached = await cache.match(url);

  if (cached) {
    arrayBuffer = await cached.arrayBuffer();
  } else {
    arrayBuffer = await fetchAndCacheAsset(url);
  }

  const rangeHeader = request.headers.get('Range');
  if (!rangeHeader) {
    // No Range header — return full response
    const contentType = url.endsWith('.webm') ? 'audio/webm; codecs=opus' : 'audio/wav';
    return new Response(arrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(arrayBuffer.byteLength),
        'Accept-Ranges': 'bytes',
      },
    });
  }

  // Parse Range header: "bytes=0-"
  const match = rangeHeader.match(/^bytes=(\d+)-(\d*)/);
  if (!match) {
    return new Response('Invalid Range header', { status: 400 });
  }

  const start = Number.parseInt(match[1], 10);
  const end = match[2] ? Number.parseInt(match[2], 10) : arrayBuffer.byteLength - 1;

  if (start >= arrayBuffer.byteLength) {
    return new Response('Range Not Satisfiable', {
      status: 416,
      headers: { 'Content-Range': `bytes */${arrayBuffer.byteLength}` },
    });
  }

  const sliced = arrayBuffer.slice(start, end + 1);
  const contentType = url.endsWith('.webm') ? 'audio/webm; codecs=opus' : 'audio/wav';

  return new Response(sliced, {
    status: 206,
    headers: {
      'Content-Type': contentType,
      'Content-Range': `bytes ${start}-${end}/${arrayBuffer.byteLength}`,
      'Content-Length': String(sliced.byteLength),
      'Accept-Ranges': 'bytes',
    },
  });
};

// ── Install — take control immediately (skip waiting) ──
self.addEventListener('install', () => {
  self.skipWaiting();
});

// ── Activate — claim all clients ──
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// ── Fetch — intercept audio asset requests ──
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only intercept GET requests to /assets/audio/
  if (event.request.method !== 'GET' || !url.pathname.startsWith(AUDIO_PATH_PREFIX)) {
    return;
  }

  event.respondWith(handleRangeRequest(event.request));
});
