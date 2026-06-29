// apps/e2e/src/visual/core/cache.ts
// Hash-based caching layer for AI visual evaluation results.
//
// Cache key = SHA-256 of (Base64Image + Prompt + stringified JSON Schema).
// Storage: JSON file at apps/e2e/.visual-cache.json (committed to Git
// for zero-cost cache hits across machines). Only stores hash → result
// mappings — base64 image data is never persisted here.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TSchema } from 'typebox';

// ── Types ─────────────────────────────────────────────────────

/** A single cache entry keyed by content hash. */
export type CacheEntry = {
  /** SHA-256 hash of the input content. */
  hash: string;
  /** ISO-8601 timestamp of when this entry was stored. */
  timestamp: string;
  /** The parsed JSON result matching the original schema. */
  result: unknown;
};

/** Shape of the on-disk cache file. */
type CacheFile = {
  entries: Record<string, CacheEntry>;
};

// ── Path resolution ──────────────────────────────────────────

const E2E_DIR = resolve(import.meta.dirname, '../../..');
const CACHE_PATH = resolve(E2E_DIR, '.visual-cache.json');

// ── Public API ────────────────────────────────────────────────

/**
 * Computes a SHA-256 cache key from the visual test inputs.
 *
 * The hash includes all three inputs to prevent false cache hits
 * when any part of the evaluation changes (image, prompt, or schema).
 */
export const computeCacheKey = (options: {
  imageDataUri: string;
  prompt: string;
  schema: TSchema;
}): string => {
  const { imageDataUri, prompt, schema } = options;
  const schemaJson = JSON.stringify(schema);
  const input = `${imageDataUri}|${prompt}|${schemaJson}`;
  return createHash('sha256').update(input).digest('hex');
};

/**
 * Reads the on-disk cache file and returns the full entries map.
 *
 * Returns an empty object if the cache file doesn't exist yet.
 */
const _readCacheFile = (): Record<string, CacheEntry> => {
  if (!existsSync(CACHE_PATH)) {
    return {};
  }

  try {
    const raw = readFileSync(CACHE_PATH, 'utf-8');
    const data = JSON.parse(raw) as CacheFile;
    return data.entries ?? {};
  } catch {
    return {};
  }
};

/**
 * Writes the entries map to the on-disk cache file.
 *
 * Creates the cache directory if it doesn't exist.
 */
const _writeCacheFile = (entries: Record<string, CacheEntry>): void => {
  mkdirSync(resolve(E2E_DIR), { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify({ entries }, null, 2));
};

/**
 * Looks up a cached evaluation result by hash key.
 *
 * @returns The cached result if found, or `undefined` on miss.
 */
export const getCachedResult = (hash: string): unknown | undefined => {
  const entries = _readCacheFile();
  const entry = entries[hash];

  if (!entry) {
    return undefined;
  }

  return entry.result;
};

/**
 * Stores an evaluation result in the cache.
 *
 * Overwrites any existing entry with the same hash (idempotent).
 */
export const setCachedResult = (options: { hash: string; result: unknown }): void => {
  const { hash, result } = options;
  const entries = _readCacheFile();

  entries[hash] = {
    hash,
    timestamp: new Date().toISOString(),
    result,
  };

  _writeCacheFile(entries);
};

/**
 * Reads the full cache file for reporting purposes.
 *
 * @returns All cached entries.
 */
export const getAllCacheEntries = (): Record<string, CacheEntry> => {
  return _readCacheFile();
};
