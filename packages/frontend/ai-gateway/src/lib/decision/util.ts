// packages/frontend/ai-gateway/src/lib/decision/util.ts
//
// Deterministic identity helpers shared by the compiler, the cache and the
// adapters. Everything here is pure and synchronous: the module runs in the
// browser, in tests and in scripts, and must behave identically in all three.

/** 64-bit FNV-1a, rendered as 16 lowercase hex characters. */
const fnv1a64 = (input: string): string => {
  let hash = 0xcbf2_9ce4_8422_2325n;
  const prime = 0x0000_0100_0000_01b3n;
  const mask = 0xffff_ffff_ffff_ffffn;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
};

/**
 * JSON with object keys sorted, so two structurally identical schemas
 * fingerprint identically regardless of property declaration order.
 */
export const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : 1));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(',')}}`;
};

/**
 * Content fingerprint of a schema.
 *
 * Content-based on purpose: renaming a schema constant must not invalidate a
 * plan, and editing one option must invalidate every plan that contains it.
 */
export const schemaFingerprint = (schema: unknown): string => fnv1a64(stableStringify(schema));

/** True for property names that must never be written through an assignment. */
export const safeSegment = (segment: string): boolean =>
  segment !== '__proto__' && segment !== 'constructor' && segment !== 'prototype';

/**
 * Encodes a property path as a single wire-safe token.
 *
 * Question keys travel as JSON object keys in every dialect we know, so they
 * are restricted to `[A-Za-z0-9_]`. The readable prefix helps a human reading a
 * benchmark trace; the digest suffix makes the key unique for paths that
 * sanitize to the same string.
 */
export const questionKeyFor = (path: readonly string[]): string => {
  const readable = path
    .map((segment) => segment.replace(/[^A-Za-z0-9]/g, '_'))
    .join('__')
    .slice(0, 48);
  return `${readable || 'root'}__${fnv1a64(JSON.stringify(path))}`;
};

/**
 * Encodes a path for lookup in a policy's instruction maps.
 *
 * Uses the same encoding as {@link questionKeyFor} minus the digest, so policy
 * metadata reads as `command__kind` rather than as an opaque token.
 */
export const pathKeyFor = (path: readonly string[]): string =>
  path.map((segment) => segment.replace(/[^A-Za-z0-9]/g, '_')).join('__');

/** UTF-8 byte length, used to enforce context limits before dispatch. */
export const utf8ByteLength = (value: string): number => new TextEncoder().encode(value).length;
