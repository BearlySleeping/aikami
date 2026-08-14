// .pi/extensions/lib/duration_cache.ts
//
// Learned wall-clock durations for commands, persisted across sessions.
//
// 🔴 Why durations and NOT a cached "done" regex:
//
// Caching a completion pattern memoises a heuristic on top of a heuristic.
// Output formats change with every toolchain bump, and when the cached
// pattern goes stale it fails SILENTLY in the worst direction — declaring a
// still-running or broken build "complete".
//
// A duration prior cannot do that. It only decides WHEN to look, never
// WHETHER the thing finished; the completion verdict always comes from the
// exit code or an explicit predicate. Its worst failure is polling slightly
// early, which costs one cheap extra sample.
//
// The win is real: a build that reliably takes ~4 min goes from ~48 polls at
// 5s to ~4 (sleep 80% of expected, then back off).

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// ── Tuning ─────────────────────────────────────────────────────────

/** Samples retained per command. Enough for a stable median, cheap to store. */
const MAX_SAMPLES = 10;

/** Commands tracked before the least-recently-used ones are evicted. */
const MAX_ENTRIES = 200;

/** Fraction of the expected duration to sleep before the first poll. */
const FIRST_SLEEP_RATIO = 0.8;

/** Never sleep longer than this before the first sample, however long the prior. */
const MAX_FIRST_SLEEP_MS = 120_000;

// ── Storage ────────────────────────────────────────────────────────

export const DEFAULT_CACHE_PATH = '.pi/cache/command_durations.json';

type DurationEntry = {
  /** Recent durations in ms, oldest first. */
  samples: number[];
  /** Epoch ms of the last write — drives LRU eviction. */
  updatedAt: number;
  /** Human-readable command, kept for debugging the cache by hand. */
  label: string;
};

type DurationCacheFile = {
  version: 1;
  entries: Record<string, DurationEntry>;
};

const EMPTY: DurationCacheFile = { version: 1, entries: {} };

/**
 * Stable key for a command. Normalises whitespace so trivial formatting
 * differences share a prior, but keeps arguments — `moon run app:build` and
 * `moon run api:build` legitimately take different amounts of time.
 */
export const commandKey = (command: string): string =>
  createHash('sha256').update(command.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16);

const _read = (path: string): DurationCacheFile => {
  if (!existsSync(path)) {
    return { ...EMPTY, entries: {} };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as DurationCacheFile;
    if (parsed?.version !== 1 || typeof parsed.entries !== 'object') {
      return { ...EMPTY, entries: {} };
    }
    return parsed;
  } catch {
    // A corrupt cache is never worth failing a build over — start fresh.
    return { ...EMPTY, entries: {} };
  }
};

/** Writes via a temp file + rename so a crash mid-write cannot corrupt the cache. */
const _write = (path: string, data: DurationCacheFile): void => {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, path);
  } catch {
    // Cache writes are best-effort — a read-only FS must not break the tool.
  }
};

/** Drops the least-recently-updated entries once the cache exceeds MAX_ENTRIES. */
const _evict = (entries: Record<string, DurationEntry>): Record<string, DurationEntry> => {
  const keys = Object.keys(entries);
  if (keys.length <= MAX_ENTRIES) {
    return entries;
  }
  const kept = keys
    .sort((a, b) => (entries[b]?.updatedAt ?? 0) - (entries[a]?.updatedAt ?? 0))
    .slice(0, MAX_ENTRIES);
  return Object.fromEntries(kept.map((k) => [k, entries[k] as DurationEntry]));
};

// ── Public API ─────────────────────────────────────────────────────

export type DurationCacheOptions = {
  /** Repo-relative or absolute cache path. Defaults to DEFAULT_CACHE_PATH. */
  cachePath?: string;
  /** Base directory the cache path resolves against. Defaults to cwd. */
  cwd?: string;
};

const _resolvePath = (options: DurationCacheOptions = {}): string =>
  join(options.cwd ?? process.cwd(), options.cachePath ?? DEFAULT_CACHE_PATH);

/** Median of a numeric list. Returns undefined for an empty list. */
export const median = (values: number[]): number | undefined => {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] as number;
  }
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};

/** Records an observed duration for a command. */
export const recordDuration = (
  command: string,
  durationMs: number,
  options: DurationCacheOptions = {},
): void => {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return;
  }
  const path = _resolvePath(options);
  const cache = _read(path);
  const key = commandKey(command);
  const existing = cache.entries[key];

  const samples = [...(existing?.samples ?? []), Math.round(durationMs)].slice(-MAX_SAMPLES);
  cache.entries[key] = { samples, updatedAt: Date.now(), label: command.slice(0, 200) };
  cache.entries = _evict(cache.entries);

  _write(path, cache);
};

export type DurationPrior = {
  /** Median observed duration in ms. */
  expectedMs: number;
  /** How many samples back it. 1 is a weak signal; 3+ is trustworthy. */
  sampleCount: number;
};

/** Returns the learned duration prior for a command, if any samples exist. */
export const getDurationPrior = (
  command: string,
  options: DurationCacheOptions = {},
): DurationPrior | undefined => {
  const entry = _read(_resolvePath(options)).entries[commandKey(command)];
  const expectedMs = median(entry?.samples ?? []);
  if (expectedMs === undefined || !entry) {
    return undefined;
  }
  return { expectedMs, sampleCount: entry.samples.length };
};

/**
 * How long to wait before taking the FIRST sample.
 *
 * With no prior, returns the caller's normal interval — no speculation. With
 * a prior, sleeps 80% of the expected duration (capped), so a long build is
 * not sampled 50 pointless times while it compiles.
 */
export const firstSleepMs = (
  intervalMs: number,
  prior: DurationPrior | undefined,
  maxWaitMs: number,
): number => {
  if (!prior || prior.sampleCount < 2) {
    return Math.min(intervalMs, maxWaitMs);
  }
  const speculative = Math.floor(prior.expectedMs * FIRST_SLEEP_RATIO);
  return Math.min(Math.max(speculative, intervalMs), MAX_FIRST_SLEEP_MS, maxWaitMs);
};

/**
 * Exponential backoff for subsequent samples, capped so a poll never goes
 * quiet for longer than 30s or overshoots the deadline.
 */
export const nextIntervalMs = (current: number, remainingMs: number): number =>
  Math.max(1000, Math.min(Math.floor(current * 1.5), 30_000, Math.max(1000, remainingMs)));
