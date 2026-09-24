// scripts/src/lib/agents/subagents/events.ts
//
// Folds the `pi --mode json` event stream into run progress: usage, the last
// activity line, the final assistant text, and a human-readable pane log.
// Pure reducer — unit tested against recorded events.

import type { SubagentUsage } from './types.ts';

export type StreamState = {
  usage: SubagentUsage;
  sessionId?: string;
  activity?: string;
  /** Text of the most recent assistant message that had text content. */
  lastText: string;
  model?: string;
  errored?: string;
};

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

const oneLine = (s: string, max = 100): string => {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** Short, readable summary of a tool call's arguments. */
export const describeToolCall = (name: string, args: unknown): string => {
  if (!isObj(args)) {
    return name;
  }
  const primary =
    str(args.command) ?? str(args.path) ?? str(args.pattern) ?? str(args.url) ?? str(args.action);
  return primary ? `${name} ${oneLine(primary, 80)}` : name;
};

const assistantText = (message: Json): string => {
  const content = message.content;
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .filter((c): c is Json => isObj(c) && c.type === 'text')
    .map((c) => str(c.text) ?? '')
    .join('')
    .trim();
};

export type Reduction = { state: StreamState; log?: string };

const addUsage = (usage: SubagentUsage, raw: unknown): SubagentUsage => {
  const u = isObj(raw) ? raw : {};
  return {
    ...usage,
    turns: usage.turns + 1,
    inputTokens: usage.inputTokens + num(u.input),
    outputTokens: usage.outputTokens + num(u.output),
    cacheReadTokens: usage.cacheReadTokens + num(u.cacheRead),
    cost: usage.cost + (isObj(u.cost) ? num(u.cost.total) : 0),
  };
};

const onMessageEnd = (state: StreamState, event: Json): Reduction => {
  const message = event.message;
  if (!isObj(message) || message.role !== 'assistant') {
    return { state };
  }
  const text = assistantText(message);
  const errored =
    message.stopReason === 'error' ? (str(message.errorMessage) ?? 'model error') : state.errored;
  return {
    state: {
      ...state,
      usage: addUsage(state.usage, message.usage),
      model: str(message.model) ?? state.model,
      lastText: text || state.lastText,
      errored,
    },
    log: text ? `\n${text}\n` : undefined,
  };
};

const onToolStart = (state: StreamState, event: Json): Reduction => {
  const activity = describeToolCall(str(event.toolName) ?? 'tool', event.args);
  return {
    state: { ...state, activity, usage: { ...state.usage, toolCalls: state.usage.toolCalls + 1 } },
    log: `  ▸ ${activity}`,
  };
};

const HANDLERS: Record<string, (state: StreamState, event: Json) => Reduction> = {
  session: (state, event) => ({ state: { ...state, sessionId: str(event.id) ?? state.sessionId } }),
  tool_execution_start: onToolStart,
  tool_execution_end: (state, event) =>
    event.isError === true
      ? { state, log: `    ✗ ${str(event.toolName) ?? 'tool'} failed` }
      : { state },
  message_end: onMessageEnd,
};

/** Apply one parsed event. Returns the new state plus an optional pane log line. */
export const reduceEvent = (state: StreamState, event: unknown): Reduction => {
  const handler = isObj(event) && typeof event.type === 'string' ? HANDLERS[event.type] : undefined;
  return handler && isObj(event) ? handler(state, event) : { state };
};

export const parseLine = (line: string): unknown => {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
};
