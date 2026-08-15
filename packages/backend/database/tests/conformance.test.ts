// packages/backend/database/tests/conformance.test.ts
//
// C-394 AC-4.3: type-level conformance between Drizzle row types and the
// TypeBox catalog wire schemas.
//
// Direction: ROW → WIRE (one way, by design). Every field of every wire
// shape must exist on the row type with a compatible type — the wire shape
// is a projection of the row. The REVERSE is deliberately NOT enforced:
// adding an internal column to a Drizzle table must not require a schema
// change, because wire shapes omit internal ids and server-assigned
// timestamps.
//
// This is a PURE TYPE assertion (assignability helper) — it costs nothing at
// runtime and fails at `:typecheck`, which is where drift should surface.
// The `bun test` file exists so the compile-time gate is exercised by the
// test task too; the exported aliases are the gate itself.

import { describe, expect, test } from 'bun:test';
import { AccountPublicSchema, PackSummarySchema, PackVersionSchema } from '@aikami/schemas';
import type { Static } from 'typebox';
import type { AccountRow, PackRow, PackVersionRow } from '../src/index.ts';

// ── Assignability helper (type level) ───────────────────────────────────
// `ExpectExtends<Row, Wire>` is `true` when Row is assignable to Wire, else
// `false`. `Expect<T extends true>` turns a `false` into a hard typecheck
// error (TS2344) — so when the wire shape references a field the row lacks,
// or types it differently, `tsgo --noEmit` fails here.
//
// 🔴 `never` is deliberately avoided in the false branch: `never extends
// true` is vacuously true, so an alias that collapses to `never` would
// silently pass. `false` fails loudly instead.

type ExpectExtends<Row, Wire> = Row extends Wire ? true : false;
type Expect<T extends true> = T;

/**
 * Compile-time gate: each Drizzle row type must be assignable to its
 * corresponding TypeBox wire Static<> type. If a wire schema gains a field
 * the row lacks, or a field is typed differently, `tsgo --noEmit` fails here.
 * (Exported so noUnusedLocals keeps them; they are type-level only.)
 */
export type AccountConformance = Expect<
  ExpectExtends<AccountRow, Static<typeof AccountPublicSchema>>
>;
export type PackConformance = Expect<ExpectExtends<PackRow, Static<typeof PackSummarySchema>>>;
export type PackVersionConformance = Expect<
  ExpectExtends<PackVersionRow, Static<typeof PackVersionSchema>>
>;

describe('row → wire conformance (AC-4.3)', () => {
  test('wire shapes are object shapes carrying the catalog fields (runtime smoke)', () => {
    // Runtime smoke only — the real assertion is the typecheck of the
    // exported type aliases above.
    expect(AccountPublicSchema.type).toBe('object');
    expect(PackSummarySchema.type).toBe('object');
    expect(PackVersionSchema.type).toBe('object');
    expect(PackSummarySchema.properties.slug.type).toBe('string');
    expect(PackVersionSchema.properties.manifestHash.type).toBe('string');
  });
});
