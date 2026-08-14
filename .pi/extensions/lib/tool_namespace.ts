// .pi/extensions/lib/tool_namespace.ts
//
// Tool namespacing — collapses a family of related tools into ONE registered
// tool with an `action` discriminator.
//
// 🔴 Why this exists: every registered tool pins its full JSON Schema, its
// description, its promptSnippet and its promptGuidelines into the system
// prompt on EVERY turn of EVERY session. 26 `gh_*` tools cost ~3.4k tokens
// whether or not the session ever touches GitHub.
//
// A namespace pays for one schema (`{ action, params }`) plus a compact
// prose index of the actions — roughly a 4-5x reduction — without losing
// validation: each action keeps its original TypeBox schema and `params` is
// checked against it at dispatch time via TypeBox's Value module. A bad call
// gets a precise error listing the expected parameters, which is the same
// feedback the model would have received from schema validation.
//
// Action `execute` keeps pi's native ToolDefinition.execute signature, so
// existing tool bodies move into a namespace unchanged.

import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import type { Static, TSchema } from 'typebox';
import { Type } from 'typebox';
import { Value } from 'typebox/value';

// ── Types ──────────────────────────────────────────────────────────

export type NamespaceAction<TParams extends TSchema = TSchema> = {
  /** Action name as the model calls it, e.g. "list". Kebab/snake, no spaces. */
  action: string;
  /** One-line summary rendered into the dispatcher description. Keep it terse. */
  summary: string;
  /** TypeBox schema for this action's params — validated at dispatch. */
  parameters: TParams;
  /** Identical signature to pi's ToolDefinition.execute. */
  execute(
    toolCallId: string,
    params: Static<TParams>,
    signal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback<unknown> | undefined,
    ctx: ExtensionContext,
  ): Promise<AgentToolResult<unknown>>;
};

/**
 * Identity helper that preserves each action's parameter type.
 *
 * Actions are stored in a `NamespaceAction[]`, which erases the generic to
 * `TSchema` and leaves `params` typed `unknown` inside execute. Wrapping the
 * literal in `defineAction` infers `TParams` at the call site first, so the
 * body sees fully typed params — the same inference pi gives registerTool.
 */
export const defineAction = <TParams extends TSchema>(
  action: NamespaceAction<TParams>,
): NamespaceAction => action as unknown as NamespaceAction;

export type NamespaceOptions = {
  /** Registered tool name, e.g. "gh_pr". */
  name: string;
  /** Human-readable label for the UI. */
  label: string;
  /** Lead sentence — what the whole family does. The action index is appended. */
  description: string;
  /** Optional; omit on rarely-used namespaces to keep them out of the prompt. */
  promptSnippet?: string;
  /** Optional; each bullet is always-on prompt cost. Prefer none. */
  promptGuidelines?: string[];
  actions: NamespaceAction[];
};

// ── Schema summarisation ───────────────────────────────────────────

/** Renders a TypeBox schema node as a compact type hint: `string`, `a|b`, `number[]`. */
const _typeHint = (schema: Record<string, unknown>): string => {
  const enumValues = schema.enum as unknown[] | undefined;
  if (Array.isArray(enumValues) && enumValues.length > 0) {
    return enumValues.join('|');
  }

  const type = schema.type;
  if (type === 'array') {
    const items = schema.items as Record<string, unknown> | undefined;
    return `${items ? _typeHint(items) : 'any'}[]`;
  }
  if (type === 'object') {
    return 'object';
  }
  if (typeof type === 'string') {
    return type;
  }
  // Unions (anyOf) and everything else collapse to a generic hint.
  if (Array.isArray(schema.anyOf)) {
    return (schema.anyOf as Record<string, unknown>[]).map(_typeHint).join('|');
  }
  return 'any';
};

/**
 * Renders a TypeBox object schema as a one-line parameter index:
 * `pr:string, state?:open|closed, limit?:number`.
 *
 * Required params come first so the reader hits them before the optionals.
 * Returns an empty string for schemas with no properties.
 */
export const summarizeSchema = (schema: TSchema): string => {
  const node = schema as unknown as {
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  };
  const properties = node.properties;
  if (!properties) {
    return '';
  }

  const required = new Set(node.required ?? []);
  const entries = Object.entries(properties);
  const render = ([key, value]: [string, Record<string, unknown>]): string =>
    `${key}${required.has(key) ? '' : '?'}:${_typeHint(value)}`;

  return [
    ...entries.filter(([k]) => required.has(k)).map(render),
    ...entries.filter(([k]) => !required.has(k)).map(render),
  ].join(', ');
};

/** Builds the prose action index appended to a namespace description. */
const _buildActionIndex = (actions: NamespaceAction[]): string =>
  actions
    .map((a) => {
      const params = summarizeSchema(a.parameters);
      return `• ${a.action} — ${a.summary}${params ? ` [${params}]` : ''}`;
    })
    .join('\n');

// ── Validation ─────────────────────────────────────────────────────

/** Formats TypeBox validation errors into a short, actionable message. */
const _formatErrors = (schema: TSchema, params: unknown, limit = 4): string => {
  const errors = [...Value.Errors(schema, params)].slice(0, limit);
  if (errors.length === 0) {
    return 'params did not match the expected schema';
  }
  return errors.map((e) => `${e.instancePath || '(root)'}: ${e.message}`).join('; ');
};

// ── Registration ───────────────────────────────────────────────────

const NAMESPACE_PARAMS = Type.Object({
  action: Type.String({
    description: 'Which action to run — see the action list in the description.',
  }),
  params: Type.Optional(
    Type.Object(
      {},
      {
        additionalProperties: true,
        description:
          "Arguments for the chosen action, as a NESTED object — e.g. " +
          '{ "action": "review_decision", "params": { "decision": "merge", "summary": "..." } }. ' +
          'Do NOT put the action\'s own fields (decision, summary, etc.) at the top level ' +
          'alongside `action` — they must be inside this `params` object or they are silently dropped.',
      },
    ),
  ),
});

/**
 * Registers a family of actions as a single pi tool.
 *
 * Dispatch applies TypeBox defaults, then validates against the action's own
 * schema before calling it — so an action body sees exactly what it would
 * have seen as a standalone registered tool.
 */
export const registerNamespace = (pi: ExtensionAPI, options: NamespaceOptions): void => {
  const byAction = new Map(options.actions.map((a) => [a.action, a]));
  const actionNames = options.actions.map((a) => a.action);

  pi.registerTool({
    name: options.name,
    label: options.label,
    description:
      `${options.description}\n\n` +
      "🔴 Call shape: { action: \"<name>\", params: { ...that action's fields } } — " +
      'the fields below are ALWAYS nested inside `params`, never alongside `action`.\n\n' +
      `Actions:\n${_buildActionIndex(options.actions)}`,
    ...(options.promptSnippet ? { promptSnippet: options.promptSnippet } : {}),
    ...(options.promptGuidelines ? { promptGuidelines: options.promptGuidelines } : {}),
    parameters: NAMESPACE_PARAMS,
    async execute(toolCallId, rawParams, signal, onUpdate, ctx) {
      const action = byAction.get(rawParams.action);
      if (!action) {
        return {
          content: [
            {
              type: 'text',
              text:
                `❌ Unknown action "${rawParams.action}" for ${options.name}. ` +
                `Valid actions: ${actionNames.join(', ')}.`,
            },
          ],
          isError: true,
          details: { error: 'unknown_action', validActions: actionNames },
        } as AgentToolResult<unknown>;
      }

      // 🔴 Models sometimes flatten the call — { action, ...fields } instead
      // of { action, params: { ...fields } } — despite the schema and prose
      // both saying to nest. Because `NAMESPACE_PARAMS` allows additional
      // top-level properties (needed so the outer schema doesn't reject a
      // flat call outright), that flattened form used to sail through this
      // dispatcher with `rawParams.params` silently `undefined`, defaulting
      // to `{}`, and fail deep inside the action's OWN schema with a message
      // ("must have required properties x, y") that gives no hint the real
      // problem is the nesting — so a model reading its own error and
      // retrying never converges. Recover the flattened shape here instead:
      // prefer a genuinely nested `params`, and only fall back to "the rest
      // of rawParams" when nothing was nested.
      const { action: _actionKey, params: nestedParams, ...flatRest } = rawParams as Record<
        string,
        unknown
      >;
      const hasNested =
        nestedParams !== undefined &&
        typeof nestedParams === 'object' &&
        nestedParams !== null &&
        Object.keys(nestedParams).length > 0;
      const rawActionParams = hasNested ? nestedParams : flatRest;

      // Apply schema defaults so actions can rely on them exactly as they
      // would when registered standalone.
      const params = Value.Default(action.parameters, rawActionParams);

      if (!Value.Check(action.parameters, params)) {
        const expected = summarizeSchema(action.parameters);
        return {
          content: [
            {
              type: 'text',
              text:
                `❌ Invalid params for ${options.name}.${action.action}: ` +
                `${_formatErrors(action.parameters, params)}.\n` +
                `Expected (nested under "params"): ${expected || '(no parameters)'}\n` +
                `Call shape: { "action": "${action.action}", "params": { ... } }`,
            },
          ],
          isError: true,
          details: { error: 'invalid_params', action: action.action, expected },
        } as AgentToolResult<unknown>;
      }

      return action.execute(toolCallId, params, signal, onUpdate, ctx);
    },
  });
};
