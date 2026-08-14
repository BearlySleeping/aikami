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
    const result = await tool.execute('t1', { action: 'echo', params: { message: 42 } });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Invalid params');
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
