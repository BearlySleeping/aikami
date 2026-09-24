// scripts/src/lib/agents/subagents/subagents.test.ts

import { describe, expect, it } from 'bun:test';
import { parseLine, reduceEvent, type StreamState } from './events.ts';
import { parseModelCatalog, pickStealthModel, resolveModel } from './models.ts';
import { splitTitle } from './prompt.ts';
import { decideReview, parseNumstat } from './review_policy.ts';
import { emptyUsage } from './store.ts';
import { buildPiArgs } from './supervise.ts';
import type { SubagentSpec } from './types.ts';

const CATALOG_TEXT = `provider    model                           context  max-out  thinking  images
openrouter  mistralai/codestral-2508:batch  256K     204.8K   no        no
openrouter  stealth/space-bunny-alpha       1M       524.3K   yes       yes
opencode    space-bunny-free                1.0M     524.3K   yes       yes
`;

describe('models', () => {
  const catalog = parseModelCatalog(CATALOG_TEXT);

  it('parses the pi --list-models table', () => {
    expect(catalog).toHaveLength(3);
    expect(catalog[1]).toEqual({
      provider: 'openrouter',
      model: 'stealth/space-bunny-alpha',
      thinking: true,
    });
  });

  it('prefers a stealth model', () => {
    expect(pickStealthModel(catalog)).toBe('openrouter/stealth/space-bunny-alpha');
    expect(pickStealthModel([])).toBeUndefined();
  });

  it('rejects unknown explicit models before any paid work', () => {
    expect(() => resolveModel({ requested: 'nope/model', repoRoot: '/tmp', catalog })).toThrow(
      /Unknown model/,
    );
    expect(
      resolveModel({
        requested: 'openrouter/stealth/space-bunny-alpha',
        repoRoot: '/tmp',
        catalog,
      }),
    ).toEqual({ model: 'openrouter/stealth/space-bunny-alpha', source: 'explicit' });
  });

  it('stealth request skips env defaults', () => {
    expect(resolveModel({ requested: 'stealth', repoRoot: '/tmp', catalog }).source).toBe(
      'stealth-discovery',
    );
  });
});

describe('review policy', () => {
  const now = Date.parse('2026-01-01T12:00:00Z');
  const code = (n: number, lines = 30) =>
    Array.from({ length: n }, (_, i) => ({ path: `src/f${i}.ts`, added: lines, removed: 0 }));

  it('honours explicit modes', () => {
    expect(decideReview({ mode: 'never', files: code(3), now }).review).toBe(false);
    expect(decideReview({ mode: 'always', files: [], now }).review).toBe(true);
  });

  it('skips sweep-sized diffs', () => {
    expect(decideReview({ mode: 'auto', files: code(101), now }).reason).toMatch(/101 files/);
  });

  it('skips docs-only and trivial diffs', () => {
    const docs = [{ path: 'docs/a.md', added: 400, removed: 2 }];
    expect(decideReview({ mode: 'auto', files: docs, now }).review).toBe(false);
    expect(decideReview({ mode: 'auto', files: code(1, 5), now }).reason).toMatch(/trivial/);
  });

  it('applies the one-hour cooldown', () => {
    const recent = decideReview({
      mode: 'auto',
      files: code(3),
      now,
      lastReviewAt: now - 20 * 60_000,
    });
    expect(recent.review).toBe(false);
    expect(recent.reason).toMatch(/cooldown/);
    const old = decideReview({
      mode: 'auto',
      files: code(3),
      now,
      lastReviewAt: now - 61 * 60_000,
    });
    expect(old.review).toBe(true);
  });

  it('parses numstat including binaries', () => {
    expect(parseNumstat('3\t1\tsrc/a.ts\n-\t-\tassets/x.png\n')).toEqual([
      { path: 'src/a.ts', added: 3, removed: 1 },
      { path: 'assets/x.png', added: 0, removed: 0 },
    ]);
  });
});

describe('event reducer', () => {
  const initial: StreamState = { usage: emptyUsage(), lastText: '' };
  const lines = [
    '{"type":"session","id":"abc"}',
    '{"type":"tool_execution_start","toolName":"bash","args":{"command":"echo 42"}}',
    '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"Done."}],"model":"m","usage":{"input":10,"output":2,"cacheRead":5,"cost":{"total":0.01}}}}',
    'not json',
  ];

  it('folds usage, activity, session and final text', () => {
    const state = lines.reduce((s, l) => reduceEvent(s, parseLine(l)).state, initial);
    expect(state.sessionId).toBe('abc');
    expect(state.activity).toBe('bash echo 42');
    expect(state.lastText).toBe('Done.');
    expect(state.usage).toMatchObject({ turns: 1, toolCalls: 1, inputTokens: 10, cost: 0.01 });
  });

  it('flags model errors', () => {
    const e =
      '{"type":"message_end","message":{"role":"assistant","content":[],"stopReason":"error","errorMessage":"429"}}';
    expect(reduceEvent(initial, parseLine(e)).state.errored).toBe('429');
  });
});

describe('prompt + args', () => {
  it('splits a TITLE line from the body', () => {
    expect(splitTitle('TITLE: fix(hub): x\n\nbody')).toEqual({
      title: 'fix(hub): x',
      body: 'body',
    });
    expect(splitTitle('just text')).toEqual({ body: 'just text' });
  });

  const spec = {
    id: 'sa-x-0000',
    kind: 'read',
    model: 'openrouter/stealth/space-bunny-alpha',
    thinking: 'low',
    repoRoot: '/repo',
    noSkillDiscovery: true,
    excludeTools: ['foo'],
  } as unknown as SubagentSpec;

  it('removes mutation tools for read agents', () => {
    const args = buildPiArgs({ spec, sessionId: 's1', task: 'do it' });
    const excluded = args[args.indexOf('--exclude-tools') + 1] ?? '';
    for (const t of ['edit', 'write', 'subagent', 'gh_pr', 'foo']) {
      expect(excluded.split(',')).toContain(t);
    }
    expect(args).toContain('--no-skills');
    expect(args.slice(-2)).toEqual(['-p', 'do it']);
  });

  it('uses an explicit allowlist verbatim', () => {
    const args = buildPiArgs({
      spec: { ...spec, tools: ['read', 'bash'] },
      sessionId: 's',
      task: 't',
    });
    expect(args).toContain('read,bash');
    expect(args).not.toContain('--exclude-tools');
  });
});
