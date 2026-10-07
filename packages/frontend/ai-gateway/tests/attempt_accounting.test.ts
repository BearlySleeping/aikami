// packages/frontend/ai-gateway/tests/attempt_accounting.test.ts
import { expect, test } from 'bun:test';
import type { AiModeResolution } from '@aikami/types';
import {
  type AiTransportAttemptEvent,
  createAdapterRegistry,
  createAiProviderGateway,
  createOpenAiCompatibleTextAdapter,
} from '../src/index.ts';
import { createNativeNdjsonFetchMock, NATIVE_DONE, ndjsonFrame } from './helpers.ts';

const resolution: AiModeResolution = {
  capability: 'text',
  mode: 'offline',
  provider: 'ollama',
  endpoint: 'http://localhost:11434',
};

test('overlapping calls keep shared ordinals until the final caller settles', async () => {
  const registry = createAdapterRegistry();
  const releases: Array<() => void> = [];
  registry.registerText({
    mode: 'offline',
    adapter: {
      provider: 'ollama',
      generateText: async ({ onAttempt }) => {
        await new Promise<void>((resolve) => releases.push(resolve));
        onAttempt?.({
          kind: 'narrative',
          transport: 'ndjson-stream',
          startedAt: 0,
          outcome: 'completed',
        });
        return { text: 'ok' };
      },
    },
  });
  const gateway = createAiProviderGateway({ registry, resolveMode: () => resolution });
  const events: AiTransportAttemptEvent[] = [];
  const dispatch = () =>
    gateway.generateText({
      messages: [],
      requestId: 'shared',
      onAttempt: (event) => events.push(event),
    });
  const first = dispatch();
  const second = dispatch();
  releases[0]?.();
  await first;
  const third = dispatch();
  releases[1]?.();
  await second;
  releases[2]?.();
  await third;
  expect(events.map((event) => event.attemptId)).toEqual(['shared#1', 'shared#2', 'shared#3']);
  const later = dispatch();
  releases[3]?.();
  await later;
  expect(events[3]?.attemptId).toBe('shared#1');
});

test('a final native frame after malformed lines still carries complete usage', async () => {
  const { fetchFn } = createNativeNdjsonFetchMock({
    lines: [
      'invalid json\n',
      ndjsonFrame({ content: 'ok' }),
      NATIVE_DONE({ usage: { promptTokens: 9, evalTokens: 2, cachedTokens: 0 } }),
    ],
  });
  const result = await createOpenAiCompatibleTextAdapter({ fetchFn }).generateText({
    resolution,
    signal: new AbortController().signal,
    messages: [],
  });
  expect(result.usage).toMatchObject({
    inputTokens: 9,
    outputTokens: 2,
    cachedTokens: 0,
    cachedSource: 'provider',
  });
  expect(result.usage?.partial).toBeUndefined();
});

test('buffered native responses preserve cached count provenance', async () => {
  const fetchFn = (async () =>
    new Response(
      NATIVE_DONE({
        usage: {
          promptTokens: 9,
          evalTokens: 2,
          cachedTokens: 0,
        },
      }),
    )) as typeof fetch;
  const result = await createOpenAiCompatibleTextAdapter({
    fetchFn,
    nativeStreamingEnabled: false,
  }).generateText({
    resolution,
    signal: new AbortController().signal,
    messages: [],
  });
  expect(result.usage).toMatchObject({ cachedTokens: 0, cachedSource: 'provider' });
});

test('request usage includes an empty attempt, invalid retry and plain fallback', async () => {
  const responses = [
    ndjsonFrame({ done: true, content: '', usage: { promptTokens: 10, evalTokens: 0 } }),
    ndjsonFrame({ done: true, content: 'invalid json', usage: { promptTokens: 7, evalTokens: 2 } }),
    ndjsonFrame({ done: true, content: '{"ok":true}', usage: { promptTokens: 5, evalTokens: 3 } }),
  ];
  let index = 0;
  const fetchFn = (async () => new Response(responses[index++])) as typeof fetch;
  const usages: number[] = [];
  const result = await createOpenAiCompatibleTextAdapter({ fetchFn }).generateText({
    resolution,
    signal: new AbortController().signal,
    messages: [],
    schema: { type: 'object' },
    schemaName: 'Result',
    onAttempt: (event) => usages.push(event.usage?.inputTokens ?? -1),
  });
  expect(usages).toEqual([10, 7, 5]);
  expect(result.usage).toMatchObject({ inputTokens: 22, outputTokens: 5 });
});
