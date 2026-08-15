// packages/backend/database/src/lib/schema.ts
//
// C-394: server data plane schema — the hub catalog WRITE model.
//
// Three tables, deliberately the minimum later contracts (C-396 browse,
// C-398 submissions, C-399 ratings) can hang off without re-litigating
// identity and ownership:
//
//   accounts     — hub member identity (Firebase uid → stable uuid)
//   packs        — catalog identity + ownership + visibility
//   pack_versions— immutable published versions, content-addressed by
//                  manifestHash into the static index (D-14)
//
// Relationship to the read model: Postgres is the write model; the static
// catalog index is a DERIVED read model regenerated at publish time.
// Nothing browses by querying Postgres (I-8). No table here duplicates
// manifest data — only identifiers and hashes that *point at* index
// entries (D-14).
//
// Constraints are enforced IN THE DATABASE (unique + CHECK + RESTRICT FK),
// not merely in Drizzle's type layer — see migrations.

import { sql } from 'drizzle-orm';
import { check, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

// ── Enums ──────────────────────────────────────────────────────────────

/** packs.visibility — a Postgres enum, never a free text column. */
export const packVisibility = pgEnum('pack_visibility', ['draft', 'public', 'unlisted', 'removed']);

// ── Tables ─────────────────────────────────────────────────────────────

/**
 * A hub member. Maps a Firebase uid to a stable internal id.
 *
 * This is hub-owned account data, NOT player-owned game data — I-3 and D-5
 * still forbid the hub from reading anything from the device plane.
 *
 * Rows are created LAZILY: no row is written in the authentication path.
 * The first member action that needs an account creates-or-fetches it
 * (C-398 submissions are the first such writer; C-399 ratings must
 * create-or-fetch too — "an account row exists" is not a precondition).
 */
export const accounts = pgTable(
  'accounts',
  {
    /** Stable internal id — uuid, server-generated. */
    id: uuid('id').defaultRandom().primaryKey(),
    /** Verified Firebase uid from the session cookie — UNIQUE NOT NULL. */
    firebaseUid: text('firebase_uid').notNull(),
    /** Optional display name. */
    displayName: text('display_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // A firebaseUid can never be re-bound to a second account.
    uniqueIndex('accounts_firebase_uid_unique').on(table.firebaseUid),
  ],
);

/**
 * Catalog identity and ownership. The pack's *content* lives in the static
 * index; this row exists so a pack can be owned, moderated and versioned.
 */
export const packs = pgTable(
  'packs',
  {
    /** Stable internal id — uuid, server-generated. */
    id: uuid('id').defaultRandom().primaryKey(),
    /** Url-safe, immutable once published — UNIQUE NOT NULL. */
    slug: text('slug').notNull().unique(),
    /** Owner — RESTRICT FK to accounts.id (catalog rows are moderated, never cascaded away). */
    ownerAccountId: uuid('owner_account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    /** Visibility state — Postgres enum. */
    visibility: packVisibility('visibility').notNull().default('draft'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Slug pattern: lowercase alphanumerics separated by single hyphens.
    // Enforced in the DB via CHECK, not just Drizzle's type layer.
    check('packs_slug_url_safe', sql`${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`),
  ],
);

/**
 * An immutable published version. `manifestHash` is the content address that
 * joins this row to its entry in the static index — the only coupling
 * between the write model and the read model.
 */
export const packVersions = pgTable(
  'pack_versions',
  {
    /** Stable internal id — uuid, server-generated. */
    id: uuid('id').defaultRandom().primaryKey(),
    /** Parent pack — RESTRICT FK to packs.id. */
    packId: uuid('pack_id')
      .notNull()
      .references(() => packs.id, { onDelete: 'restrict' }),
    /** Semver, unique per pack. */
    version: text('version').notNull(),
    /** sha256 of the canonical manifest bytes. */
    manifestHash: text('manifest_hash').notNull(),
    /** Null while unpublished. */
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (table) => [
    // One pack cannot publish the same semver twice.
    uniqueIndex('pack_versions_pack_id_version_unique').on(table.packId, table.version),
  ],
);

// ── Row types (exported for repositories + the conformance test) ───────

export type AccountRow = typeof accounts.$inferSelect;
export type PackRow = typeof packs.$inferSelect;
export type PackVersionRow = typeof packVersions.$inferSelect;
