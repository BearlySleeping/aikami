// packages/shared/types/src/lib/content_pack.ts
//
// Content Pack types — derived from TypeBox schemas in @aikami/schemas.
// Single source of truth for content pack data shapes.
// Contract: C-315 Define a Versioned Campaign Content Pack and Atomic Loader

import type {
  ContentPackItemEntrySchema,
  ContentPackManifestSchema,
  ContentPackMapEntrySchema,
  ContentPackNpcEntrySchema,
  ItemTypeSchema,
} from '@aikami/schemas';
import type { Static } from 'typebox';

/** A single map entry in a content pack manifest. */
export type ContentPackMapEntry = Static<typeof ContentPackMapEntrySchema>;

/** An NPC definition in a content pack manifest. */
export type ContentPackNpcEntry = Static<typeof ContentPackNpcEntrySchema>;

/** Supported item types. */
export type ItemType = Static<typeof ItemTypeSchema>;

/** An item definition in a content pack manifest. */
export type ContentPackItemEntry = Static<typeof ContentPackItemEntrySchema>;

/** Top-level content pack manifest. */
export type ContentPackManifest = Static<typeof ContentPackManifestSchema>;
