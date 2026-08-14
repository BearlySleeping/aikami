// .pi/extensions/lib/output_normalize.ts
//
// Output normalisation for change detection.
//
// 🔴 Naive "is the output the same as last time?" comparison fails in both
// directions on real build tools:
//
//   - False NEGATIVE: cargo/npm/vite redraw progress with \r and ANSI cursor
//     moves. The raw bytes differ on every sample, so output never looks
//     stable and the poll always runs to its timeout.
//   - False POSITIVE is handled elsewhere (see poll_until's predicate
//     ordering and `stableFor` minimum) — normalisation only removes noise,
//     it never decides completion on its own.
//
// So: strip ANSI, resolve \r redraws to the final painted line, and scrub
// tokens that tick even when nothing is happening (timestamps, elapsed
// counters, byte counts, spinner frames).

import { createHash } from 'node:crypto';

// ── Patterns ───────────────────────────────────────────────────────

// Escape sequences are built with `new RegExp` and explicit \u escapes so the
// source file stays pure ASCII — literal ESC bytes in a source file are
// invisible in diffs and get mangled by copy/paste.

/** OSC strings: ESC ] ... terminated by BEL or ST (ESC \). */
const OSC_PATTERN = '\\u001B\\][^\\u0007\\u001B]*(?:\\u0007|\\u001B\\\\)';

/** CSI and single-character escapes: colour, cursor moves, erase-line. */
const CSI_PATTERN = '\\u001B[[\\]()#;?]*(?:\\d{1,4}(?:;\\d{0,4})*)?[0-9A-PR-TZcf-nqry=><]';

/** Combined ANSI matcher. OSC first so its payload is not partially eaten. */
const ANSI_RE = new RegExp(`${OSC_PATTERN}|${CSI_PATTERN}`, 'g');

/** Braille + block spinner frames used by cargo, bun, vite, ora, etc. */
const SPINNER_RE = /[\u2800-\u28FF\u2580-\u259F]+/g;

/** ISO-8601 timestamps and clock times: 2026-08-14T13:41:02, 13:41:02.123 */
const TIMESTAMP_RE =
  /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?|\b\d{1,2}:\d{2}:\d{2}(?:\.\d+)?\b/g;

/** Elapsed/duration counters: "in 4.21s", "12.3ms", "35 mins" */
const DURATION_RE = /\b\d+(?:\.\d+)?\s*(?:ms|s|m|h|sec|secs|min|mins)\b/gi;

/** Byte counters: "1.2 MiB", "45kB", "930 bytes" */
const BYTES_RE = /\b\d+(?:\.\d+)?\s*(?:[KMGT]i?B|bytes?)\b/gi;

/** Percentage counters: "42%", "  7 %" */
const PERCENT_RE = /\b\d{1,3}\s*%/g;

/** "[123/456]" style progress fractions. */
const FRACTION_RE = /\[\s*\d+\s*\/\s*\d+\s*\]/g;

/**
 * Bracketed ASCII/Unicode progress bars: "[=====>    ]", "[####....]",
 * "[████░░░░]". This is the cargo/tauri case — the bar grows on every sample
 * while the build is doing exactly one thing.
 *
 * Requires 4+ characters drawn only from bar glyphs, so bracketed prose and
 * short literals like "[ok]" are left alone.
 */
const PROGRESS_BAR_RE = /\[[\s=#>.*_\-\u2588\u2593\u2592\u2591]{4,}\]/g;

/** Bare hex ids that churn between runs (short commit shas, container ids). */
const HEXID_RE = /\b[0-9a-f]{7,40}\b/gi;

// ── Core ───────────────────────────────────────────────────────────

/** Removes ANSI escape sequences. */
export const stripAnsi = (text: string): string => text.replace(ANSI_RE, '');

/**
 * Resolves carriage-return redraws to the final painted content of each line.
 *
 * A progress bar writes `10%\r20%\r30%\n`; a terminal shows only `30%`, and
 * that is what we compare against. Later segments overwrite earlier ones from
 * column 0, so a shorter redraw leaves the tail of the longer one visible —
 * which is exactly how a real terminal behaves.
 */
export const resolveCarriageReturns = (text: string): string =>
  text
    .split('\n')
    .map((line) => {
      if (!line.includes('\r')) {
        return line;
      }
      let painted = '';
      for (const segment of line.split('\r')) {
        painted =
          segment.length >= painted.length ? segment : segment + painted.slice(segment.length);
      }
      return painted;
    })
    .join('\n');

export type NormalizeOptions = {
  /**
   * Scrub values that change on their own (timestamps, elapsed time, byte and
   * percent counters, spinner frames, hex ids). Default true.
   *
   * Turn this OFF when the thing being waited on is itself a counter — e.g.
   * polling until a queue depth stops changing.
   */
  scrubVolatile?: boolean;
  /** Keep only the last N non-empty lines. 0 (default) keeps everything. */
  tailLines?: number;
};

/**
 * Normalises command output for stable comparison between poll samples.
 * Always: strips ANSI, resolves \r redraws, trims each line, drops blank
 * lines, and collapses runs of whitespace.
 */
export const normalizeOutput = (raw: string, options: NormalizeOptions = {}): string => {
  const scrubVolatile = options.scrubVolatile ?? true;

  let text = resolveCarriageReturns(stripAnsi(raw));

  if (scrubVolatile) {
    text = text
      .replace(TIMESTAMP_RE, '<ts>')
      .replace(DURATION_RE, '<dur>')
      .replace(BYTES_RE, '<bytes>')
      .replace(PERCENT_RE, '<pct>')
      .replace(FRACTION_RE, '<frac>')
      .replace(PROGRESS_BAR_RE, '<bar>')
      .replace(HEXID_RE, '<hex>')
      .replace(SPINNER_RE, '');
  }

  let lines = text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0);

  const tail = options.tailLines ?? 0;
  if (tail > 0 && lines.length > tail) {
    lines = lines.slice(-tail);
  }

  return lines.join('\n');
};

/** Stable short digest of normalised output, for cheap sample comparison. */
export const outputFingerprint = (raw: string, options: NormalizeOptions = {}): string =>
  createHash('sha256').update(normalizeOutput(raw, options)).digest('hex').slice(0, 16);

/** Last non-empty normalised line — the "is it still logging?" signal. */
export const lastMeaningfulLine = (raw: string): string => {
  const lines = normalizeOutput(raw, { scrubVolatile: false }).split('\n');
  return lines.at(-1) ?? '';
};

/**
 * Human-readable tail for display in tool output.
 *
 * Unlike normalizeOutput this does NOT scrub volatile values — timings and
 * byte counts are exactly what a human wants to read in a build log. It only
 * removes what a terminal would have consumed anyway (ANSI, \r redraws) and
 * trims to the last N lines.
 */
export const displayTail = (raw: string, lines: number): string =>
  resolveCarriageReturns(stripAnsi(raw))
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .slice(-Math.max(1, lines))
    .join('\n');
