// apps/frontend/client/src/lib/services/ai/text_effective_route.test.ts
import { describe, expect, test } from 'bun:test';
import { buildCoalescingIdentity } from './text_effective_route.ts';

const route = (endpoint: string | undefined): string =>
  buildCoalescingIdentity({
    task: 'summarization',
    schemaName: 'Test',
    schema: { type: 'object' },
    systemPrompt: undefined,
    prompt: 'Summarize',
    model: undefined,
    routing: { capability: 'text', mode: 'byok', provider: 'custom', endpoint },
    scope: undefined,
    configRevision: undefined,
  }).effectiveRoute;

describe('effective route destination', () => {
  test('distinguishes paths and queries on the same origin', () => {
    expect(route('https://example.com/a')).not.toBe(route('https://example.com/b'));
    expect(route('https://example.com/a?v=1')).not.toBe(route('https://example.com/a?v=2'));
  });

  test('normalizes URLs and ignores fragments', () => {
    expect(route(' HTTPS://EXAMPLE.COM:443/old/../a?v=1#fragment ')).toBe(
      route('https://example.com/a?v=1'),
    );
    expect(route('https://example.com')).toBe(route('https://example.com/'));
  });

  test('preserves empty and invalid endpoint handling', () => {
    expect(route(undefined)).toBe(route('   '));
    expect(route('   ')).toContain('origin=in-process');
    expect(route(' LOCAL-ENDPOINT/// ')).toBe(route('local-endpoint'));
  });
});
