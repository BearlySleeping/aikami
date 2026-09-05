import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { logPath, workspaceLabel } from './background_herdr_shared.ts';
import { journalDir } from './background_journal.ts';

describe('background_herdr_shared', () => {
  test('workspaceLabel is the fixed peer workspace name', () => {
    expect(workspaceLabel()).toBe('aikami-background-tasks');
  });

  test('logPath joins the journal dir with a .log suffix', () => {
    // join(), not a template-string '/' — the platform separator on
    // Windows is '\\', and logPath itself is built with join().
    expect(logPath('/repo', 'bg-1-1')).toBe(join(journalDir('/repo'), 'bg-1-1.log'));
  });
});
