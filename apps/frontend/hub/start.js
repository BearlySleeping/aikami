// apps/frontend/hub/start.js
//
// Pre-runtime wrapper — seeds Bun's CJS module cache with the real Node stream
// module before SvelteKit or any bundled iconv-lite/fetch-blob code evaluates.
//
// Vite bundles iconv-lite and fetch-blob into shared chunks where they shadow
// each other's require('stream') references. By priming the cache first, Bun
// serves the real stream constructors instead of empty objects.
// (Adopted from nordclaw's production-proven Cloud Run + Bun setup.)

import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);

// Populate both prefixed and unprefixed cache entries
require_('node:stream');
require_('stream');

// Hand off to the compiled SvelteKit server
await import('./index.js');
