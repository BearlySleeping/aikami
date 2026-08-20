// .pi/extensions/lib/background_journal.ts
//
// Disk journal for background tasks. Every task started by `bg` writes a
// `<id>.json` snapshot (command, cwd, pid, timestamps, exit code) plus a
// `<id>.log` of its combined output, streamed live. The journal makes tasks
// visible beyond the owning pi process: `tail -f` from a terminal, or any
// other agent that reads this directory.
//
// Ids are `bg-<ts>-<pid>` rather than the old per-session `bg1/2/…` so they
// never collide across sessions. See README.md beside this directory.

import type { WriteStream } from 'node:fs';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

// ── Location ────────────────────────────────────────────────────────

/** Repo-relative journal directory (gitignored). */
export const JOURNAL_DIR = '.pi/background-tasks';

/** Full absolute path to the journal directory. */
export const journalDir = (base: string): string => join(base, JOURNAL_DIR);

export const _logPath = (base: string, id: string): string => join(journalDir(base), `${id}.log`);
export const _jsonPath = (base: string, id: string): string => join(journalDir(base), `${id}.json`);

// ── Ids ─────────────────────────────────────────────────────────────

/** `bg-<epoch ms>-<pid>` — unique across sessions and processes. Safe for filenames. */
export const makeTaskId = (pid: number | undefined): string =>
  `bg-${Date.now()}-${pid ?? process.pid}`;

// ── Snapshots ───────────────────────────────────────────────────────

export type TaskSnapshot = {
  id: string;
  command: string;
  cwd: string;
  pid?: number | null;
  startedAt: number;
  finishedAt?: number;
  exitCode?: number | null;
  killed?: boolean;
  state: 'running' | 'success' | 'failed' | 'killed';
  /** Epoch ms the snapshot was last written. */
  updatedAt: number;
};

/** Atomic temp+rename write (same pattern as duration_cache.ts). */
const _writeJson = (path: string, data: TaskSnapshot): void => {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, path);
  } catch {
    // Best-effort — a read-only FS must not break the task.
  }
};

/** Writes (or refreshes) a task's JSON snapshot atomically. */
export const writeSnapshot = (base: string, data: TaskSnapshot): void => {
  _writeJson(_jsonPath(base, data.id), data);
};

/** Opens an append stream for a task's log file. Best-effort. */
export const openLogStream = (base: string, id: string): WriteStream | null => {
  try {
    mkdirSync(journalDir(base), { recursive: true });
    const stream = createWriteStream(_logPath(base, id), { flags: 'a' });
    stream.on('error', () => undefined);
    return stream;
  } catch {
    return null;
  }
};

/** Appends a chunk line to the task's log stream. */
export const writeLog = (stream: WriteStream | null, chunk: string): void => {
  if (!stream) {
    return;
  }
  try {
    stream.write(chunk);
  } catch {
    // Best-effort.
  }
};

/**
 * Closes the log stream, waiting for buffered writes to flush to disk so no
 * trailing output is lost if the host process exits right after. Returns a
 * promise so callers can await durability before reporting completion.
 */
export const closeLogStream = (stream: WriteStream | null): Promise<void> => {
  if (!stream) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    stream.on('finish', finish);
    stream.on('error', finish);
    try {
      stream.end(finish);
    } catch {
      finish();
    }
  });
};

// ── Reading ─────────────────────────────────────────────────────────

/** Parses a snapshot from a `.json` file, tolerating corruption. */
export const readSnapshot = (base: string, id: string): TaskSnapshot | null => {
  const path = _jsonPath(base, id);
  if (!existsSync(path)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as TaskSnapshot;
    if (!parsed?.id || typeof parsed.command !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

/** Lists every known task id in the journal (each has a `.json`). */
export const listIds = (base: string): string[] => {
  try {
    return readdirSync(journalDir(base))
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -'.json'.length))
      .sort();
  } catch {
    return [];
  }
};

/** Returns the current tail of a task's log file. */
export const readLogTail = (base: string, id: string, lines: number): string => {
  const path = _logPath(base, id);
  if (!existsSync(path)) {
    return '';
  }
  try {
    const text = readFileSync(path, 'utf8');
    const all = text.split('\n');
    return all
      .slice(Math.max(0, all.length - lines))
      .join('\n')
      .trim();
  } catch {
    return '';
  }
};
