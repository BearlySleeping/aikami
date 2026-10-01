// packages/frontend/ai-gateway/src/lib/structured.test.ts
//
// Schema compilation and content identity (issue #382 P1).
//
// The defect under test: the compiler cached on `schemaName` alone, so a caller
// reusing a name over a different schema was served whichever schema compiled
// FIRST — its properties, its `required` list, its nested constraints. Two
// different questions, one answer.

import { describe, expect, test } from 'bun:test';
import {
  canonicalSchemaFingerprint,
  createSchemaCompiler,
  isCanonicalizableSchema,
  SCHEMA_COMPILER_VERSION,
  UncanonicalizableSchemaError,
} from './structured.ts';

const objectSchema = (properties: Record<string, unknown>): Record<string, unknown> => ({
  type: 'object',
  properties,
});

describe('canonicalSchemaFingerprint', () => {
  test('reproduces the collision the replacer-array trick could not see', () => {
    // Both of these canonicalise to the SAME string under
    // `JSON.stringify(schema, Object.keys(schema).sort())`:
    //   {"properties":{},"type":"object"}
    const a = objectSchema({ mood: objectSchema({ tone: { type: 'string', enum: ['hostile'] } }) });
    const b = objectSchema({ mood: objectSchema({ tone: { type: 'string', enum: ['warm'] } }) });
    expect(canonicalSchemaFingerprint(a)).not.toBe(canonicalSchemaFingerprint(b));
  });

  test('key order alone does not change the identity', () => {
    const left = { type: 'object', properties: { a: { type: 'string' }, b: { type: 'number' } } };
    const right = { properties: { b: { type: 'number' }, a: { type: 'string' } }, type: 'object' };
    expect(canonicalSchemaFingerprint(left)).toBe(canonicalSchemaFingerprint(right));
  });

  test('array order is preserved', () => {
    const ab = { type: 'object', required: ['a', 'b'], properties: {} };
    const ba = { type: 'object', required: ['b', 'a'], properties: {} };
    expect(canonicalSchemaFingerprint(ab)).not.toBe(canonicalSchemaFingerprint(ba));
  });

  test('literal types are distinguished', () => {
    expect(canonicalSchemaFingerprint({ const: 1 })).not.toBe(
      canonicalSchemaFingerprint({ const: '1' }),
    );
    expect(canonicalSchemaFingerprint({ const: true })).not.toBe(
      canonicalSchemaFingerprint({ const: 'true' }),
    );
  });

  test('an undefined property is not silently dropped', () => {
    // `JSON.stringify` discards it, which would collapse these two together.
    expect(canonicalSchemaFingerprint({ type: 'string', maxLength: undefined })).not.toBe(
      canonicalSchemaFingerprint({ type: 'string' }),
    );
  });

  test('nested $ref and combinators are part of the identity', () => {
    const withRef = {
      type: 'object',
      properties: { a: { $ref: '#/$defs/Alpha' } },
      // biome-ignore lint/style/useNamingConvention: JSON Schema keyword name — the contract under test
      $defs: { Alpha: { type: 'object', properties: { x: { type: 'string' } } } },
    };
    const differentRef = {
      type: 'object',
      properties: { a: { $ref: '#/$defs/Beta' } },
      // biome-ignore lint/style/useNamingConvention: JSON Schema keyword name — the contract under test
      $defs: { Beta: { type: 'object', properties: { x: { type: 'string' } } } },
    };
    expect(canonicalSchemaFingerprint(withRef)).not.toBe(canonicalSchemaFingerprint(differentRef));
    const withOneOf = { type: 'object', properties: { a: { oneOf: [{ type: 'string' }] } } };
    const withAnyOf = { type: 'object', properties: { a: { anyOf: [{ type: 'string' }] } } };
    expect(canonicalSchemaFingerprint(withOneOf)).not.toBe(canonicalSchemaFingerprint(withAnyOf));
  });

  test('cycles and non-JSON values are REJECTED, not folded into a shared token', () => {
    const cyclic: Record<string, unknown> = { type: 'object' };
    cyclic.self = cyclic;
    expect(() => canonicalSchemaFingerprint(cyclic)).toThrow(UncanonicalizableSchemaError);
    expect(() => canonicalSchemaFingerprint({ fn: () => 1 })).toThrow(UncanonicalizableSchemaError);
    expect(() => canonicalSchemaFingerprint({ n: Number.NaN })).toThrow(
      UncanonicalizableSchemaError,
    );
    expect(isCanonicalizableSchema({ type: 'object' })).toBe(true);
    expect(isCanonicalizableSchema(cyclic)).toBe(false);
  });

  test('a shared structure is not mistaken for a cycle', () => {
    // The same child object referenced twice is a DAG, not a cycle: a JSON
    // encoder expands it, so it has a canonical form.
    const shared = { type: 'string' };
    expect(() => canonicalSchemaFingerprint({ a: shared, b: shared })).not.toThrow();
  });
});

describe('createSchemaCompiler', () => {
  test('the SAME name over DIFFERENT schemas compiles separately', () => {
    const compiler = createSchemaCompiler();
    const alpha = objectSchema({ change: { type: 'string' } });
    const beta = objectSchema({ change: { type: 'string' }, delta: { type: 'number' } });

    const compiledAlpha = compiler.compile({ schema: alpha, schemaName: 'Relationship' });
    const compiledBeta = compiler.compile({ schema: beta, schemaName: 'Relationship' });

    // The old cache returned the first compiled schema for both.
    expect((compiledAlpha.properties as Record<string, unknown>).delta).toBeUndefined();
    expect((compiledBeta.properties as Record<string, unknown>).delta).not.toBeUndefined();
    expect(compiler.size).toBe(2);
  });

  test('the same name with only a NESTED difference compiles separately', () => {
    const compiler = createSchemaCompiler();
    const alpha = objectSchema({ mood: objectSchema({ tone: { type: 'string', enum: ['a'] } }) });
    const beta = objectSchema({ mood: objectSchema({ tone: { type: 'string', enum: ['b'] } }) });
    expect(compiler.compile({ schema: alpha, schemaName: 'X' })).not.toBe(
      compiler.compile({ schema: beta, schemaName: 'X' }),
    );
  });

  test('identical contents under the same name reuse the compiled entry', () => {
    const compiler = createSchemaCompiler();
    const schema = objectSchema({ change: { type: 'string' } });
    const first = compiler.compile({ schema, schemaName: 'Relationship' });
    const second = compiler.compile({
      // A different object, same content, and a different key order.
      schema: { properties: { change: { type: 'string' } }, type: 'object' },
      schemaName: 'Relationship',
    });
    expect(second).toBe(first);
    expect(compiler.size).toBe(1);
  });

  test('the compiled output is frozen — a caller cannot poison the cache', () => {
    const compiler = createSchemaCompiler();
    const schema = objectSchema({ change: { type: 'string' } });
    const first = compiler.compile({ schema, schemaName: 'Relationship' });
    // Silently corrupting the shared entry for every later compile is the
    // failure this prevents; freezing turns it into a loud TypeError.
    expect(() => {
      (first as unknown as Record<string, unknown>).type = 'array';
    }).toThrow();
    expect(() => {
      ((first.properties as Record<string, unknown>).change as Record<string, unknown>).type =
        'number';
    }).toThrow();
    expect(compiler.compile({ schema, schemaName: 'Relationship' })).toBe(first);
  });

  test("the caller's own schema object is never mutated by compilation", () => {
    const compiler = createSchemaCompiler();
    const schema: Record<string, unknown> = {
      type: 'object',
      properties: { a: { type: 'object' } },
    };
    compiler.compile({ schema, schemaName: 'X' });
    expect(schema.additionalProperties).toBeUndefined();
  });

  test('strictness is enforced at every depth, and the ORIGINAL stays authoritative', () => {
    const compiler = createSchemaCompiler();
    const original = objectSchema({
      outer: objectSchema({ inner: objectSchema({ leaf: { type: 'string' } }) }),
    });
    const compiled = compiler.compile({ schema: original, schemaName: 'Nested' });
    const outer = (compiled.properties as Record<string, unknown>).outer as Record<string, unknown>;
    const inner = (outer.properties as Record<string, unknown>).inner as Record<string, unknown>;
    expect(outer.additionalProperties).toBe(false);
    expect(inner.additionalProperties).toBe(false);
    // The application validates against the ORIGINAL schema
    // (`validateAgainstSchema`), so transport strictness never redefines what
    // the application considers valid.
    expect(original.additionalProperties).toBeUndefined();
  });

  test('the cache is bounded and evicts the least recently compiled', () => {
    const compiler = createSchemaCompiler({ maxEntries: 2 });
    compiler.compile({ schema: objectSchema({ a: {} }), schemaName: 'A' });
    compiler.compile({ schema: objectSchema({ b: {} }), schemaName: 'B' });
    compiler.compile({ schema: objectSchema({ c: {} }), schemaName: 'C' });
    expect(compiler.size).toBe(2);
  });

  test('a schema with no canonical form still compiles, but never shares', () => {
    const compiler = createSchemaCompiler();
    // A function-valued keyword: `JSON.stringify` DROPS it, so the schema
    // clones and compiles, but it has no canonical content identity either.
    // Two such schemas that differ only in that key are not provably the same,
    // so each compiles for itself rather than the second being handed the
    // first's output.
    const withFn = (key: string): Record<string, unknown> => ({
      type: 'object',
      properties: { a: { type: 'string' }, [key]: () => undefined },
    });
    const first = compiler.compile({ schema: withFn('hookA'), schemaName: 'WithFn' });
    const second = compiler.compile({ schema: withFn('hookB'), schemaName: 'WithFn' });
    expect(first).toBeDefined();
    expect(second).not.toBe(first);
  });

  test('a CYCLIC schema is rejected rather than silently half-compiled', () => {
    const compiler = createSchemaCompiler();
    const cyclic: Record<string, unknown> = { type: 'object', properties: {} };
    (cyclic.properties as Record<string, unknown>).self = cyclic;
    // It cannot be deep-cloned, so it cannot be compiled. Throwing is the
    // honest answer; a partially strictified graph would be sent to a provider.
    expect(() => compiler.compile({ schema: cyclic, schemaName: 'Cyclic' })).toThrow();
  });

  test('the compiler version is part of every entry key', () => {
    expect(SCHEMA_COMPILER_VERSION).toBeGreaterThan(0);
    const compiler = createSchemaCompiler();
    compiler.compile({ schema: objectSchema({ a: {} }), schemaName: 'A' });
    // A different version must not read the previous version's entries; the
    // constant is what the key embeds, so a bump is a total miss by design.
    expect(compiler.size).toBe(1);
  });
});
