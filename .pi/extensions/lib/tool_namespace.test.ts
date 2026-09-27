import { describe, expect, test } from 'bun:test';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import {
  defineAction,
  type NamespaceAction,
  registerNamespace,
  summarizeSchema,
} from './tool_namespace.ts';

// ── Test harness ───────────────────────────────────────────────────

type Registered = {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: unknown;
  execute: (
    id: string,
    params: { action: string; params?: Record<string, unknown> },
    signal?: AbortSignal,
    onUpdate?: unknown,
    ctx?: unknown,
  ) => Promise<{ content: { type: string; text: string }[]; isError?: boolean; details: unknown }>;
};

/** Minimal ExtensionAPI stand-in that captures the single registered tool. */
const fakePi = () => {
  let registered: Registered | undefined;
  // Only registerTool is exercised, so the double implements just that and is
  // widened through `unknown` rather than `any`.
  const pi = {
    registerTool: (tool: unknown) => {
      registered = tool as Registered;
    },
  } as unknown as ExtensionAPI;

  return {
    pi,
    get tool(): Registered {
      if (!registered) {
        throw new Error('no tool registered');
      }
      return registered;
    },
  };
};

const ok = (text: string) => ({ content: [{ type: 'text' as const, text }], details: {} });

const echoAction = defineAction({
  action: 'echo',
  summary: 'Echo a message back',
  parameters: Type.Object({
    message: Type.String(),
    times: Type.Optional(Type.Number({ default: 1 })),
  }),
  async execute(_id, params) {
    return ok(`${params.message}x${params.times}`);
  },
});

const noParamsAction = defineAction({
  action: 'ping',
  summary: 'No parameters at all',
  parameters: Type.Object({}),
  async execute() {
    return ok('pong');
  },
});

const build = (actions: NamespaceAction[] = [echoAction, noParamsAction]) => {
  const harness = fakePi();
  registerNamespace(harness.pi, {
    name: 'demo',
    label: 'Demo',
    description: 'Demo namespace.',
    actions,
  });
  return harness;
};

// ── Tests ──────────────────────────────────────────────────────────

describe('summarizeSchema', () => {
  test('renders required before optional', () => {
    const schema = Type.Object({
      opt: Type.Optional(Type.String()),
      req: Type.String(),
    });
    expect(summarizeSchema(schema)).toBe('req:string, opt?:string');
  });

  test('renders enums as alternatives', () => {
    const schema = Type.Object({
      state: Type.Optional(Type.String({ enum: ['open', 'closed'] })),
    });
    expect(summarizeSchema(schema)).toBe('state?:open|closed');
  });

  test('renders array item types', () => {
    expect(summarizeSchema(Type.Object({ tags: Type.Array(Type.String()) }))).toBe('tags:string[]');
  });

  test('returns empty for a schema with no properties', () => {
    expect(summarizeSchema(Type.Object({}))).toBe('');
  });
});

describe('registerNamespace', () => {
  test('registers exactly one tool for the whole family', () => {
    const { tool } = build();
    expect(tool.name).toBe('demo');
  });

  test('description carries a compact index of every action', () => {
    const { tool } = build();
    expect(tool.description).toContain(
      '• echo — Echo a message back [message:string, times?:number]',
    );
    expect(tool.description).toContain('• ping — No parameters at all');
  });

  test('omits promptSnippet when not supplied, keeping it out of the system prompt', () => {
    const { tool } = build();
    expect(tool.promptSnippet).toBeUndefined();
    expect(tool.promptGuidelines).toBeUndefined();
  });

  test('dispatches to the named action', async () => {
    const { tool } = build();
    const result = await tool.execute('t1', {
      action: 'echo',
      params: { message: 'hi', times: 2 },
    });
    expect(result.content[0]?.text).toBe('hix2');
  });

  test('applies TypeBox defaults before calling the action', async () => {
    const { tool } = build();
    const result = await tool.execute('t1', { action: 'echo', params: { message: 'hi' } });
    expect(result.content[0]?.text).toBe('hix1');
  });

  test('supports an action with no params and no params key', async () => {
    const { tool } = build();
    const result = await tool.execute('t1', { action: 'ping' });
    expect(result.content[0]?.text).toBe('pong');
  });

  test('rejects an unknown action and lists the valid ones', async () => {
    const { tool } = build();
    const result = await tool.execute('t1', { action: 'nope' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Unknown action "nope"');
    expect(result.content[0]?.text).toContain('echo, ping');
  });

  test('rejects params that fail validation, naming what was expected', async () => {
    const { tool } = build();
    const result = await tool.execute('t1', { action: 'echo', params: {} });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Invalid params');
    expect(result.content[0]?.text).toContain('message:string');
  });

  test('rejects a param of the wrong type', async () => {
    const { tool } = build();
    const result = await tool.execute('t1', {
      action: 'echo',
      params: { message: { nested: true } },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Invalid params');
  });

  test('names the value it actually received, so the failure is self-diagnosing', async () => {
    const { tool } = build();
    const result = await tool.execute('t1', { action: 'echo', params: { times: 'lots' } });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Received:');
    expect(result.content[0]?.text).toContain('times: lots');
  });

  test('recovers a flattened call — fields alongside `action` instead of nested under `params`', async () => {
    const { tool } = build();
    const flat = { action: 'echo', message: 'hi', times: 2 } as unknown as Parameters<
      typeof tool.execute
    >[1];
    const result = await tool.execute('t1', flat);
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBe('hix2');
  });

  test('prefers a genuinely nested `params` over stray top-level fields', async () => {
    const { tool } = build();
    const mixed = {
      action: 'echo',
      params: { message: 'nested', times: 3 },
      message: 'flat-should-be-ignored',
    } as unknown as Parameters<typeof tool.execute>[1];
    const result = await tool.execute('t1', mixed);
    expect(result.content[0]?.text).toBe('nestedx3');
  });

  test('a failing action never sees invalid params', async () => {
    let seen: unknown;
    const strict = defineAction({
      action: 'strict',
      summary: 'records what it received',
      parameters: Type.Object({ n: Type.Number() }),
      async execute(_id, params) {
        seen = params;
        return ok('called');
      },
    });
    const { tool } = build([strict]);
    await tool.execute('t1', { action: 'strict', params: { n: 'not a number' } });
    expect(seen).toBeUndefined();
  });

  test('passes signal and toolCallId straight through', async () => {
    const captured: { id?: string; aborted?: boolean } = {};
    const probe = defineAction({
      action: 'probe',
      summary: 'captures context',
      parameters: Type.Object({}),
      async execute(id, _params, signal) {
        captured.id = id;
        captured.aborted = signal?.aborted;
        return ok('ok');
      },
    });
    const { tool } = build([probe]);
    await tool.execute('call-42', { action: 'probe' }, AbortSignal.abort());
    expect(captured.id).toBe('call-42');
    expect(captured.aborted).toBe(true);
  });

  test('keeps promptSnippet when explicitly provided', () => {
    const harness = fakePi();
    registerNamespace(harness.pi, {
      name: 'demo',
      label: 'Demo',
      description: 'd',
      promptSnippet: 'use demo',
      promptGuidelines: ['be careful'],
      actions: [noParamsAction],
    });
    expect(harness.tool.promptSnippet).toBe('use demo');
    expect(harness.tool.promptGuidelines).toEqual(['be careful']);
  });
});

// ── Coercion ────────────────────────────────────────────────────────
//
// Regression cover for the failure that made these tools feel unstable: the
// model stringified scalars, strict validation rejected the call, and the
// round trip was wasted. `gh_release.list { limit: "20" }` and
// `gh_workflow.status { limit: "10", watch: "true" }` both used to fail with
// `/limit: must be number` and `/watch: must be boolean`.

describe('coercion', () => {
  /** Records the params an action actually received, so types are assertable. */
  const probe = defineAction({
    action: 'probe',
    summary: 'echoes the params it received',
    parameters: Type.Object({
      limit: Type.Optional(Type.Number({ default: 10 })),
      watch: Type.Optional(Type.Boolean({ default: false })),
      pr: Type.Optional(Type.String()),
      tags: Type.Optional(Type.Array(Type.String())),
      inputs: Type.Optional(Type.Record(Type.String(), Type.String())),
    }),
    async execute(_id, params) {
      return ok(JSON.stringify(params));
    },
  });

  const call = async (params: unknown): Promise<Record<string, unknown>> => {
    const { tool } = build([probe]);
    const result = await tool.execute('t1', { action: 'probe', params } as never);
    expect(result.isError).toBeUndefined();
    return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>;
  };

  test('coerces a stringified number', async () => {
    expect(await call({ limit: '20' })).toMatchObject({ limit: 20 });
  });

  test('coerces a stringified boolean', async () => {
    expect(await call({ watch: 'true' })).toMatchObject({ watch: true });
  });

  test('coerces the whole gh_workflow.status shape at once', async () => {
    expect(await call({ limit: '10', watch: 'true' })).toMatchObject({ limit: 10, watch: true });
  });

  const BOOLEAN_VOCABULARY: [string, boolean][] = [
    ['true', true],
    ['yes', true],
    ['y', true],
    ['on', true],
    ['1', true],
    ['false', false],
    ['no', false],
    ['n', false],
    ['off', false],
    ['0', false],
  ];

  for (const [input, expected] of BOOLEAN_VOCABULARY) {
    test('reads the string "' + input + '" as boolean ' + String(expected), async () => {
      expect(await call({ watch: input })).toMatchObject({ watch: expected });
    });
  }

  test('coerces a numeric id into a string field', async () => {
    expect(await call({ pr: 402 })).toMatchObject({ pr: '402' });
  });

  test('splits a comma-separated string into an array, as the schema documents', async () => {
    expect(await call({ tags: 'bug, urgent' })).toMatchObject({ tags: ['bug', 'urgent'] });
  });

  test('coerces values inside a Type.Record to the declared value type', async () => {
    expect(await call({ inputs: { dryRun: true, retries: 3 } })).toMatchObject({
      inputs: { dryRun: 'true', retries: '3' },
    });
  });

  test('accepts a thousands separator', async () => {
    expect(await call({ limit: '1,000' })).toMatchObject({ limit: 1000 });
  });

  test('coerces a flattened call as well as a nested one', async () => {
    const { tool } = build([probe]);
    const flat = { action: 'probe', limit: '7', watch: 'true' } as never;
    const result = await tool.execute('t1', flat);
    expect(JSON.parse(result.content[0]?.text ?? '{}')).toMatchObject({ limit: 7, watch: true });
  });

  test('recovers params serialised as a JSON string instead of running on defaults', async () => {
    const { tool } = build([probe]);
    const stringified = { action: 'probe', params: '{"limit":9,"watch":"true"}' } as never;
    const result = await tool.execute('t1', stringified);
    expect(JSON.parse(result.content[0]?.text ?? '{}')).toMatchObject({ limit: 9, watch: true });
  });

  // The coercion must never become a rubber stamp. Each of these is a value
  // the walker cannot convert with certainty, so it has to reach validation
  // untouched and still fail.
  const UNCOERCIBLE: [string, string][] = [
    ['a non-numeric string', 'lots'],
    ['an empty string, which Number() would call 0', ''],
    ['hex, which Number() would call 16', '0x10'],
    ['Infinity, which would slip past a naive isFinite check', 'Infinity'],
    ['a comma-joined digit soup', '1,2'],
  ];

  for (const [label, input] of UNCOERCIBLE) {
    test('still rejects ' + label + ' in a number field', async () => {
      const { tool } = build([probe]);
      const result = await tool.execute('t1', { action: 'probe', params: { limit: input } });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Invalid params');
    });
  }

  test('still rejects a boolean field given a non-boolean word', async () => {
    const { tool } = build([probe]);
    const result = await tool.execute('t1', { action: 'probe', params: { watch: 'maybe' } });
    expect(result.isError).toBe(true);
  });

  test('never coerces null — a required field given null must still fail', async () => {
    const required = defineAction({
      action: 'req',
      summary: 'requires a number',
      parameters: Type.Object({ n: Type.Number() }),
      async execute(_id, params) {
        return ok(`n=${params.n}`);
      },
    });
    const { tool } = build([required]);
    const result = await tool.execute('t1', { action: 'req', params: { n: null } } as never);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Invalid params');
  });

  test('an uncoercible value never reaches the action body', async () => {
    let called = false;
    const strict = defineAction({
      action: 'strict',
      summary: 'must not be reached',
      parameters: Type.Object({ n: Type.Number() }),
      async execute() {
        called = true;
        return ok('ran');
      },
    });
    const { tool } = build([strict]);
    await tool.execute('t1', { action: 'strict', params: { n: 'not a number' } });
    expect(called).toBe(false);
  });

  test('leaves values that already match the schema untouched', async () => {
    expect(await call({ limit: 5, watch: false, pr: 'main' })).toMatchObject({
      limit: 5,
      watch: false,
      pr: 'main',
    });
  });
});
