// packages/shared/types/src/lib/game/pack_index.ts
//
// Content pack index types — derived from TypeBox schemas in @aikami/schemas.
// Contract: C-345 Add a Campaign/Content-Pack Browser and a Second Adventure

import type { PackIndexEntrySchema, PackIndexSchema } from '@aikami/schemas';
import type { Static } from 'typebox';

/** A single entry in the content pack registry index. */
export type PackIndexEntry = Static<typeof PackIndexEntrySchema>;

/** Top-level pack registry index. */
export type PackIndex = Static<typeof PackIndexSchema>;
