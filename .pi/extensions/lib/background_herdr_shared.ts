// .pi/extensions/lib/background_herdr_shared.ts
//
// Shared helpers for the optional herdr viewer: where the journal log lives,
// and what the peer workspace is labelled. Kept separate from
// background_herdr.ts so the label logic can be unit-tested without invoking
// the herdr CLI.

import { join } from 'node:path';
import { journalDir } from './background_journal.ts';

/** Absolute path to a task's journal log file. */
export const logPath = (base: string, id: string): string => join(journalDir(base), `${id}.log`);

/** The herdr workspace that mirrors background tasks. */
export const workspaceLabel = (): string => 'aikami-background-tasks';
