// packages/shared/schemas/src/lib/catalog/pack.ts
//
// Catalog API-boundary wire shape for a pack (C-394).
//
// A pack row is catalog identity + ownership; its *content* lives in the
// static index (D-14). The summary omits the internal uuid and timestamps —
// it is what a browse/submission consumer (C-396/C-398) can safely read.

import { type Static, Type } from 'typebox';

/** Postgres enum of pack visibility states (packs.visibility). */
export const PackVisibilitySchema = Type.Union(
  [
    Type.Literal('draft'),
    Type.Literal('public'),
    Type.Literal('unlisted'),
    Type.Literal('removed'),
  ],
  { description: 'Visibility state of a pack' },
);

export type PackVisibility = Static<typeof PackVisibilitySchema>;

/**
 * Read shape of a pack as exposed on the wire.
 *
 * `ownerAccountId` is the stable account uuid the pack belongs to — the
 * ownership link later contracts (moderation, submissions, ratings) hang off.
 */
export const PackSummarySchema = Type.Object({
  /** Url-safe, immutable-once-published slug — unique, NOT NULL in storage. */
  slug: Type.String({ description: 'Url-safe pack slug, unique per catalog' }),
  /** Visibility state. */
  visibility: PackVisibilitySchema,
  /** Owning account (accounts.id) — RESTRICT FK in storage. */
  ownerAccountId: Type.String({ description: 'Stable account id that owns the pack' }),
});

export type PackSummary = Static<typeof PackSummarySchema>;
