import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  closeLogStream,
  JOURNAL_DIR,
  journalDir,
  listIds,
  makeTaskId,
  openLogStream,
  readLogTail,
  readSnapshot,
  writeLog,
  writeSnapshot,
} from './background_journal.ts';

const tmpBase = () => {
  const base = mkdtempSync(join(tmpdir(), 'bg-journal-'));
  return base;
};

describe('background_journal', () => {
  test('makeTaskId yields distinct ids and safe filenames', () => {
    const a = makeTaskId(123);
    const b = makeTaskId(124);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^bg-\d+-\d+$/);
  });

  test('writeSnapshot + readSnapshot round-trips, tolerating missing files', async () => {
    const base = tmpBase();
    const read = readSnapshot(base, 'bg-1-1');
    expect(read).toBeNull();

    const snap = {
      id: 'bg-1-1',
      command: 'echo hi',
      cwd: base,
      pid: 99,
      startedAt: 1000,
      exitCode: 0,
      state: 'success' as const,
      updatedAt: 2000,
    };
    writeSnapshot(base, snap);
    const back = readSnapshot(base, 'bg-1-1');
    expect(back?.id).toBe('bg-1-1');
    expect(back?.command).toBe('echo hi');
    expect(back?.state).toBe('success');
    expect(back?.exitCode).toBe(0);

    rmSync(base, { recursive: true, force: true });
  });

  test('listIds only returns snapshot ids (no .log files)', async () => {
    const base = tmpBase();
    writeSnapshot(base, {
      id: 'bg-a-1',
      command: 'c',
      cwd: base,
      startedAt: 1,
      state: 'running',
      updatedAt: 1,
    });
    writeSnapshot(base, {
      id: 'bg-b-2',
      command: 'c',
      cwd: base,
      startedAt: 2,
      state: 'running',
      updatedAt: 2,
    });
    const stream = openLogStream(base, 'bg-a-1');
    writeLog(stream, 'some output');
    closeLogStream(stream);

    // The .log must not appear as an id.
    const ids = listIds(base);
    expect(ids).toContain('bg-a-1');
    expect(ids).toContain('bg-b-2');
    expect(ids).toHaveLength(2);

    rmSync(base, { recursive: true, force: true });
  });

  test('readLogTail returns only the requested trailing lines', async () => {
    const base = tmpBase();
    const stream = openLogStream(base, 'bg-t-1');
    for (let i = 1; i <= 5; i += 1) {
      writeLog(stream, `line ${i}\n`);
    }
    await closeLogStream(stream);
    const tail = readLogTail(base, 'bg-t-1', 2);
    expect(tail).toContain('line 5');
    expect(tail).not.toContain('line 1');

    rmSync(base, { recursive: true, force: true });
  });

  test('journalDir resolves a repo-relative base', () => {
    // node:path.join uses the platform separator, so the expectation must
    // too — a hardcoded '/repo/.pi/background-tasks' string only matches
    // on POSIX and fails under Windows CI.
    const dir = journalDir('/repo');
    expect(dir).toBe(join('/repo', JOURNAL_DIR));
    expect(dir).toBe(join('/repo', '.pi', 'background-tasks'));
  });
});
