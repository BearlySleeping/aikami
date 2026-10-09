// packages/frontend/ai-gateway/src/lib/native_format.ts
//
// Native schema-constrained output for Ollama's `/api/chat`.
//
// Measured on Ollama 0.34.3 (`docs/research/audits/382-native-transport-plan.md`):
// passing a JSON Schema object as `format` returned a 200 whose whole body
// parsed and conformed to the schema. The native structured path is therefore
// real on the measured surface, and the previous code — which sent the schema
// only as a system-prompt instruction and then parsed the prose — was leaving a
// guarantee on the table.
//
// Three constraints shape this module:
//
//   - ORIGINAL VALIDATION STAYS AUTHORITATIVE. `format` is a decoder-side
//     constraint, not a contract. A provider can honour the shape and still
//     return a value the TypeBox schema rejects, and the domain check is the
//     thing that must decide. Nothing here replaces `schemaCheck`.
//
//   - CAPABILITY IS A POLICY, NOT A PROBE. Ollama answers 200 to fields it does
//     not understand, so a runtime either supports native `format` or ignores
//     it, and the response cannot tell you which. That makes "did it work" a
//     question only a VALIDATION failure can answer — so an unsupported
//     capability must be declared up front, and a failure must fall back
//     exactly once.
//
//   - NO RETRY STORM. A 400 must not become an unbounded text retry. The
//     fallback is a single, differently-shaped attempt, and the attempt that
//     produced it is still accounted for because the provider billed it.

import type { AiTextUsage } from './gateway_types.ts';

/**
 * Whether the measured runtime accepts a native `format` schema.
 *
 * Supplied by the composition root rather than discovered, precisely because a
 * provider that ignores an unknown field cannot be probed for support. Absent
 * means "not declared", which is treated as unsupported — the conservative
 * direction, since guessing wrong in the other direction silently produces
 * unconstrained prose that then fails schema validation.
 */
export type NativeFormatCapability = (provider: string) => boolean;

/** The body fragment a native structured request carries. */
export type NativeFormatRequest = {
  /** `true` when `format` was included. */
  readonly constrained: boolean;
  /** The body fragment, or `{}` when unconstrained. */
  readonly body: Record<string, unknown>;
  /** Why the request is unconstrained, when it is. */
  readonly reason?: 'capability-not-declared' | 'empty-schema';
};

/** A JSON-Schema-shaped object that is safe to hand to a provider. */
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Builds the native `format` fragment for one structured request.
 *
 * The schema is passed through as compiled by the shared `SchemaCompiler`
 * (owned by another lane, reused unchanged) so the strict
 * `additionalProperties: false` enforcement the OpenAI-compatible path already
 * gets applies here too, rather than being re-derived and drifting.
 */
export const buildNativeFormat = (options: {
  provider: string;
  compiledSchema: Record<string, unknown>;
  supportsNativeFormat?: NativeFormatCapability;
}): NativeFormatRequest => {
  const { provider, compiledSchema, supportsNativeFormat } = options;

  // An empty schema object is not a constraint; sending it as `format` would
  // be a request that looks constrained and is not.
  if (Object.keys(compiledSchema).length === 0) {
    return { constrained: false, body: {}, reason: 'empty-schema' };
  }
  if (!(supportsNativeFormat?.(provider) ?? false)) {
    return { constrained: false, body: {}, reason: 'capability-not-declared' };
  }
  return {
    constrained: true,
    body: { format: isPlainObject(compiledSchema) ? compiledSchema : {} },
  };
};

/** How a native structured attempt ended. */
export type NativeStructuredOutcome =
  /** The provider rejected the request shape. One differently-shaped retry is due. */
  | { kind: 'unsupported'; status: number }
  /** A 2xx whose body was not JSON at all. */
  | { kind: 'non-json' }
  /** A 2xx that parsed and validated. */
  | { kind: 'ok'; usage?: AiTextUsage; partial?: boolean }
  /** The body parsed but failed the original schema. Validation decides. */
  | { kind: 'invalid'; usage?: AiTextUsage; partial?: boolean };

/**
 * Whether an HTTP status is one that may mean "this provider does not support
 * the shape I sent".
 *
 * Narrow on purpose. Broadening this to every 400 would turn a genuine
 * malformed-request bug into a silent retry against a paid provider, which is
 * the "do not broaden all HTTP 400s into an unlimited text retry" failure.
 * Only 400 and 422 — the two statuses that specifically mean "this request
 * shape is unacceptable" — qualify.
 */
export const isSchemaShapeRejection = (status: number): boolean => status === 400 || status === 422;

/**
 * How many differently-shaped attempts a single structured request may make.
 *
 * One. A structured request that has already been re-shaped once and is still
 * failing has told us what it is going to tell us; a third attempt spends the
 * budget to learn nothing.
 */
export const NATIVE_STRUCTURED_FALLBACK_BUDGET = 1;
