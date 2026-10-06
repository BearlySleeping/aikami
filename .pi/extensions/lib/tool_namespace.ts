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
// 🔴 Coercion: the model stringifies scalars constantly — `"limit": "10"`,
// `"watch": "true"`, `"pr": 402`, `"addLabels": "bug,urgent"`. Strict
// validation turned each of those into a hard error and a wasted round trip
// (`❌ Invalid params for gh_release.list: /limit: must be number`), which is
// the single largest source of instability in this file: the model was
// sending exactly what the schema's own `description` asked for and being
// punished for it. `coerceToSchema` walks the action schema and repairs the
// unambiguous cases BEFORE validation. It never invents a value — an
// uncoercible input is passed through untouched so the original precise
// error still fires — and `null` is never coerced, so a missing required
// field still fails loudly.
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
): NamespaceAction =>
  // guard-ignore lint/type-safety/casting: Generic type erasure — NamespaceAction<TParams> -> NamespaceAction is a subtype widening
  action as unknown as NamespaceAction;

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
  // guard-ignore lint/type-safety/casting: TypeBox schema internals — accessing properties/required fields
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

/** Narrows a tool-call payload to a plain object without asserting through it. */
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Formats TypeBox validation errors into a short, actionable message. */
const _formatErrors = (schema: TSchema, params: unknown, limit = 4): string => {
  const errors = [...Value.Errors(schema, params)].slice(0, limit);
  if (errors.length === 0) {
    return 'params did not match the expected schema';
  }
  return errors.map((e) => `${e.instancePath || '(root)'}: ${e.message}`).join('; ');
};

/** Renders a received value compactly, so a rejected param is self-diagnosing. */
const _describeValue = (value: unknown): string => {
  const text = typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value));
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
};

/**
 * Appends what was actually received for each failing path.
 *
 * Without this the model sees `must be number` and has to guess whether it
 * sent nothing, `null`, or a string — and the guess is wrong often enough to
 * cost another round trip. Truncated hard: an error message is the one place
 * a large accidental payload (a whole PR body) can leak into the transcript.
 */
const _formatReceived = (params: unknown, paths: string[]): string => {
  if (!isPlainObject(params)) {
    return '';
  }
  const shown = paths
    .map((path) => {
      const key = path.replace(/^\//, '').split('/')[0] ?? '';
      if (!key || !(key in params)) {
        return undefined;
      }
      return `  ${key}: ${_describeValue(params[key])}`;
    })
    .filter((line): line is string => Boolean(line));
  return shown.length > 0 ? `\nReceived:\n${shown.join('\n')}` : '';
};

// ── Coercion ────────────────────────────────────────────────────────

/** A TypeBox schema node — plain JSON Schema; the walk reads its keyword fields. */
type SchemaNode = Record<string, unknown>;

/** Boolean vocabularies. Deliberately closed — never "any non-empty string is true". */
const TRUTHY = new Set(['true', 'yes', 'y', 'on', '1']);
const FALSY = new Set(['false', 'no', 'n', 'off', '0']);

/** Well-formed thousands separators ("1,000"). "1,2" is rejected — ambiguous. */
const THOUSANDS = /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;

/**
 * Plain decimal / scientific notation only.
 *
 * Rejects the traps `Number()` silently accepts: `''` → 0, `'0x10'` → 16,
 * `'Infinity'` → Infinity. A limit that silently becomes 0 is a hang, not a
 * helpful default.
 */
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

const asNumber = (raw: string): number | undefined => {
  const text = raw.trim();
  if (text === '') {
    return undefined;
  }
  const normalized = THOUSANDS.test(text) ? text.replace(/,/g, '') : text;
  if (!DECIMAL.test(normalized)) {
    return undefined;
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : undefined;
};

const asBoolean = (raw: string): boolean | undefined => {
  const text = raw.trim().toLowerCase();
  if (TRUTHY.has(text)) {
    return true;
  }
  if (FALSY.has(text)) {
    return false;
  }
  return undefined;
};

/** Picks the first union branch that the (already coerced) value satisfies. */
const _coerceUnion = (value: unknown, branches: SchemaNode[]): unknown => {
  for (const branch of branches) {
    const candidate = _coerceValue(value, branch);
    // guard-ignore lint/type-safety/casting: a union branch is a TypeBox schema object; Value.Check needs the TSchema brand
    if (Value.Check(branch as TSchema, candidate)) {
      return candidate;
    }
  }
  return value;
};

/** Rewrites one value toward the type its schema declares. */
type ScalarCoercer = (value: unknown) => unknown;

const COERCE_NUMBER: ScalarCoercer = (value) =>
  typeof value === 'string' ? (asNumber(value) ?? value) : value;

const COERCE_BOOLEAN: ScalarCoercer = (value) => {
  if (typeof value === 'string') {
    return asBoolean(value) ?? value;
  }
  if (typeof value === 'number' && (value === 0 || value === 1)) {
    return value !== 0;
  }
  return value;
};

const COERCE_STRING: ScalarCoercer = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return String(value);
  }
  return value;
};

/** A lookup table rather than a branch ladder, so adding a type is one line. */
const SCALAR_COERCERS: Record<string, ScalarCoercer> = {
  number: COERCE_NUMBER,
  integer: COERCE_NUMBER,
  boolean: COERCE_BOOLEAN,
  string: COERCE_STRING,
};

/** Maps a value onto an enum, allowing a numeric id where the enum is strings. */
const _coerceEnum = (value: unknown, allowed: unknown[]): unknown => {
  if (allowed.includes(value)) {
    return value;
  }
  const text = typeof value === 'string' ? value : String(value);
  return allowed.find((candidate) => String(candidate) === text) ?? value;
};

/** Coerces an array, or the comma-joined string an array field often arrives as. */
const _coerceArrayLike = (value: unknown, schema: SchemaNode): unknown => {
  const items = schema.items as SchemaNode | undefined;
  if (Array.isArray(value)) {
    return items ? value.map((item) => _coerceValue(item, items)) : value;
  }
  // `gh_pr.edit` documents addLabels as "comma-separated or array" but only
  // Type.Array was ever accepted, so the documented form errored.
  if (typeof value !== 'string') {
    return value;
  }
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  if (parts.length === 0) {
    return value;
  }
  return items ? parts.map((part) => _coerceValue(part, items)) : parts;
};

/** The value schemas a Type.Record declares, for its undeclared keys. */
const _recordValueSchemas = (schema: SchemaNode): SchemaNode[] => {
  const patterns = Object.values(
    (schema.patternProperties as Record<string, SchemaNode> | undefined) ?? {},
  );
  const additional = schema.additionalProperties;
  return isPlainObject(additional) ? [...patterns, additional] : patterns;
};

/**
 * Coerces undeclared keys against a Type.Record's value schema.
 *
 * `gh_workflow.run.inputs` wants string values and says so in its own
 * description, but a model sending `{ dryRun: true }` was rejected outright.
 */
const _coerceRecordValues = (
  out: Record<string, unknown>,
  declared: Record<string, SchemaNode> | undefined,
  valueSchemas: SchemaNode[],
): Record<string, unknown> => {
  for (const key of Object.keys(out)) {
    if (declared?.[key]) {
      continue;
    }
    for (const valueSchema of valueSchemas) {
      const candidate = _coerceValue(out[key], valueSchema);
      // guard-ignore lint/type-safety/casting: record value schemas are TypeBox schemas; Value.Check needs the TSchema brand
      if (Value.Check(valueSchema as TSchema, candidate)) {
        out[key] = candidate;
        break;
      }
    }
  }
  return out;
};

/** Coerces declared properties, then a Type.Record's undeclared keys. */
const _coerceObject = (
  value: Record<string, unknown>,
  schema: SchemaNode,
): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...value };
  const properties = schema.properties as Record<string, SchemaNode> | undefined;
  for (const [key, propertySchema] of Object.entries(properties ?? {})) {
    if (key in out) {
      out[key] = _coerceValue(out[key], propertySchema);
    }
  }
  const valueSchemas = _recordValueSchemas(schema);
  return valueSchemas.length > 0 ? _coerceRecordValues(out, properties, valueSchemas) : out;
};

/** A primitive: union → enum → declared type. */
const _coerceScalar = (value: unknown, schema: SchemaNode): unknown => {
  const branches = (schema.anyOf ?? schema.oneOf) as SchemaNode[] | undefined;
  if (Array.isArray(branches) && branches.length > 0) {
    return _coerceUnion(value, branches);
  }
  const allowed = schema.enum;
  if (Array.isArray(allowed)) {
    return _coerceEnum(value, allowed);
  }
  const type = schema.type;
  const coercer = typeof type === 'string' ? SCALAR_COERCERS[type] : undefined;
  return coercer ? coercer(value) : value;
};

/** Rewrites a single value toward the type its schema declares. */
const _coerceValue = (value: unknown, schema: SchemaNode): unknown => {
  // `null` is an explicit "I have no value" and a required field given it must
  // still fail. Coercing it to "null"/0/false would manufacture data.
  if (value === null || value === undefined) {
    return value;
  }
  // Dispatch on the SCHEMA, not just the value, for arrays: the array branch
  // must claim a plain string before the scalar branches hand it back
  // untouched, or the documented comma-separated form silently stops working.
  if (Array.isArray(value) || (schema.type === 'array' && typeof value === 'string')) {
    return _coerceArrayLike(value, schema);
  }
  if (isPlainObject(value)) {
    return _coerceObject(value, schema);
  }
  return _coerceScalar(value, schema);
};

/**
 * Repairs the unambiguous type mismatches a model produces against an action
 * schema. Anything it cannot convert with certainty is returned unchanged, so
 * a genuinely wrong call still fails validation with its original error.
 */
export const coerceToSchema = (schema: TSchema, params: unknown): unknown =>
  _coerceValue(params, schema as SchemaNode);

/**
 * Recovers `params` arriving as a serialised JSON string.
 *
 * Without this the dispatcher saw a string, treated it as "not nested", fell
 * back to an empty object, and ran the action on DEFAULTS — a silent
 * no-op that looks like success. Only well-formed objects are parsed, so a
 * malformed string still surfaces as the validation error it deserves.
 */
const parseParamsContainer = (value: unknown): unknown => {
  if (typeof value !== 'string') {
    return value;
  }
  const text = value.trim();
  if (!text.startsWith('{')) {
    return value;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : value;
  } catch {
    return value;
  }
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
          'Arguments for the chosen action, as a NESTED object — e.g. ' +
          '{ "action": "review_decision", "params": { "decision": "merge", "summary": "..." } }. ' +
          "Do NOT put the action's own fields (decision, summary, etc.) at the top level " +
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
      '🔴 Call shape: { action: "<name>", params: { ...that action\'s fields } } — ' +
      'the fields below are ALWAYS nested inside `params`, never alongside `action`.\n\n' +
      `Actions:\n${_buildActionIndex(options.actions)}`,
    ...(options.promptSnippet ? { promptSnippet: options.promptSnippet } : {}),
    ...(options.promptGuidelines ? { promptGuidelines: options.promptGuidelines } : {}),
    parameters: NAMESPACE_PARAMS,
    async execute(toolCallId, rawParams, signal, onUpdate, ctx) {
      // guard-ignore lint/type-safety/casting: pi hands the tool args through unvalidated; the dispatcher narrows them itself below
      const envelope = (isPlainObject(rawParams) ? rawParams : {}) as Record<string, unknown>;
      const action = byAction.get(String(envelope.action ?? ''));
      if (!action) {
        return {
          content: [
            {
              type: 'text',
              text:
                `❌ Unknown action "${String(envelope.action ?? '')}" for ${options.name}. ` +
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
      const { action: _actionKey, params: nestedParams, ...flatRest } = envelope;
      const parsedNested = parseParamsContainer(nestedParams);
      const hasNested = isPlainObject(parsedNested) && Object.keys(parsedNested).length > 0;
      const rawActionParams = hasNested ? parsedNested : flatRest;

      // Repair the scalar/array type slips the schema's own descriptions
      // invite (stringified numbers and booleans, numeric ids, comma-joined
      // arrays) before defaults and validation, so an action body still sees
      // exactly what a standalone registered tool would have handed it.
      const coerced = coerceToSchema(action.parameters, rawActionParams);

      // Apply schema defaults so actions can rely on them exactly as they
      // would when registered standalone.
      const params = Value.Default(action.parameters, coerced);

      if (!Value.Check(action.parameters, params)) {
        const expected = summarizeSchema(action.parameters);
        const failures = [...Value.Errors(action.parameters, params)];
        return {
          content: [
            {
              type: 'text',
              text:
                `❌ Invalid params for ${options.name}.${action.action}: ` +
                `${_formatErrors(action.parameters, params)}.\n` +
                `Expected (nested under "params"): ${expected || '(no parameters)'}\n` +
                `Call shape: { "action": "${action.action}", "params": { ... } }` +
                // guard-ignore lint/type-safety/casting: error instances are TypeBox's internal shape, only instancePath is read
                _formatReceived(
                  params,
                  failures.map((f) => f.instancePath),
                ),
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
