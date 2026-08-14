// scripts/src/lib/agents/contract_pipeline/review_pane.test.ts
import { describe, expect, it } from 'bun:test';
import {
  advanceFirstResponse,
  canSendToReviewPane,
  hasPendingUserInput,
  initialFirstResponseState,
  isSettledStatus,
  readComposer,
} from './review_pane.ts';

const RULE = '─'.repeat(77);

/** A pi TUI snapshot with `composer` typed but unsent. */
const snapshot = (composer: string): string =>
  [
    ' Took 2.1s',
    '',
    ' The branch is still NOT pushed to origin.',
    '',
    RULE,
    composer,
    RULE,
    '~/.herdr/worktrees/aikami/contract-task-c-390-mssulnwd (contract-task-c-39...',
    '↑72k ↓13k R1.0M $0.017 8.0%/1.0M (auto)   (deepseek) deepseek-v4-flash • high',
    '🔌 MCP: 1 server enabled Stable · DS cache 1156/1161·255.0M/256.1M 99.6% ...',
  ].join('\n');

describe('readComposer', () => {
  it('extracts unsent text between the last rule pair', () => {
    expect(readComposer(snapshot('please make the implementer'))).toEqual({
      found: true,
      text: 'please make the implementer',
    });
  });

  it('reports an empty composer when the agent is working', () => {
    expect(readComposer(snapshot(''))).toEqual({ found: true, text: '' });
  });

  it('joins a wrapped multi-line composer', () => {
    const read = readComposer(
      snapshot('please ask claude sonnet about\nwhat has been implemented'),
    );
    expect(read.text).toBe('please ask claude sonnet about\nwhat has been implemented');
  });

  it('uses the LAST rule pair so scrollback tables cannot shadow the composer', () => {
    // A rendered table earlier in scrollback contributes two extra rules.
    const withTable = [RULE, ' │ D2 │ BLOCKER │', RULE, snapshot('real input')].join('\n');
    expect(readComposer(withTable).text).toBe('real input');
  });

  it('reports not-found when the snapshot has no composer rules', () => {
    expect(readComposer('booting pi...\n$ ')).toEqual({ found: false, text: '' });
  });

  it('ignores short dash runs that are not full-width rules', () => {
    expect(readComposer('---\nhi\n---')).toEqual({ found: false, text: '' });
  });

  it('ignores a rule pair buried far above the bottom', () => {
    // An agent-rendered table high in the snapshot must not pass as an empty
    // composer — that is the one misread that could green-light a send.
    const buried = [RULE, RULE, ...Array.from({ length: 20 }, (_, i) => `output line ${i}`)].join(
      '\n',
    );
    expect(readComposer(buried)).toEqual({ found: false, text: '' });
    expect(hasPendingUserInput(buried)).toBe(true);
  });

  it('still finds the composer under trailing blank padding', () => {
    expect(readComposer(`${snapshot('typing')}\n\n\n`).text).toBe('typing');
  });
});

describe('hasPendingUserInput', () => {
  it('is true when the composer holds text', () => {
    expect(hasPendingUserInput(snapshot('half a sentence'))).toBe(true);
  });

  it('is false only for a parsed, empty composer', () => {
    expect(hasPendingUserInput(snapshot('   '))).toBe(false);
  });

  it('fails safe when the pane read failed', () => {
    expect(hasPendingUserInput(null)).toBe(true);
  });

  it('fails safe on an empty snapshot', () => {
    expect(hasPendingUserInput('   ')).toBe(true);
  });

  it('fails safe when the composer cannot be located', () => {
    expect(hasPendingUserInput('some pane that is not pi')).toBe(true);
  });
});

describe('canSendToReviewPane', () => {
  it('allows sending to an idle pane with an empty composer', () => {
    const gate = canSendToReviewPane({ status: 'idle', paneText: snapshot('') });
    expect(gate.ok).toBe(true);
  });

  it('refuses while the agent is mid-response', () => {
    const gate = canSendToReviewPane({ status: 'working', paneText: snapshot('') });
    expect(gate.ok).toBe(false);
    expect(gate.reason).toContain('mid-response');
  });

  it('refuses when the user has unsent input — the C-390 regression', () => {
    const gate = canSendToReviewPane({
      status: 'idle',
      paneText: snapshot('please make the implementer'),
    });
    expect(gate.ok).toBe(false);
    expect(gate.reason).toContain('unsent user input');
  });

  it('refuses when agent status is unreported', () => {
    const gate = canSendToReviewPane({ status: undefined, paneText: snapshot('') });
    expect(gate.ok).toBe(false);
    expect(gate.reason).toContain('unavailable');
  });

  it('allows a blocked agent (permission prompt) with an empty composer', () => {
    expect(canSendToReviewPane({ status: 'blocked', paneText: snapshot('') }).ok).toBe(true);
  });
});

describe('isSettledStatus', () => {
  it('treats idle, blocked and done as settled', () => {
    expect(['idle', 'blocked', 'done'].every(isSettledStatus)).toBe(true);
  });

  it('treats working and unknown as unsettled', () => {
    expect(isSettledStatus('working')).toBe(false);
    expect(isSettledStatus('unknown')).toBe(false);
    expect(isSettledStatus(undefined)).toBe(false);
  });
});

describe('advanceFirstResponse', () => {
  const fold = (statuses: Array<string | undefined>, settleSamples = 4) =>
    statuses.reduce(
      (state, status) => advanceFirstResponse(state, status, settleSamples),
      initialFirstResponseState(),
    );

  it('does not fire on the idle that precedes the agent starting', () => {
    expect(fold(['idle', 'idle', 'idle', 'idle', 'idle', 'idle']).phase).toBe('waiting_for_start');
  });

  it('fires after the agent works and then settles for enough samples', () => {
    expect(fold(['idle', 'working', 'working', 'idle', 'idle', 'idle', 'idle']).phase).toBe(
      'responded',
    );
  });

  it('does not fire on an inter-turn idle blip', () => {
    // pi reports `idle` between LLM turns; the streak must reset.
    const state = fold(['working', 'idle', 'idle', 'working', 'idle', 'idle']);
    expect(state.phase).toBe('working');
  });

  it('counts a blocked permission prompt as settled', () => {
    expect(fold(['working', 'blocked', 'blocked', 'blocked', 'blocked']).phase).toBe('responded');
  });

  it('is terminal once responded', () => {
    const responded = fold(['working', 'idle', 'idle', 'idle', 'idle']);
    expect(advanceFirstResponse(responded, 'working').phase).toBe('responded');
  });

  it('honours a custom settle-sample count', () => {
    expect(fold(['working', 'idle', 'idle'], 2).phase).toBe('responded');
  });
});
