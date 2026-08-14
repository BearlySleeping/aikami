// packages/shared/types/src/lib/local_ai/model_manifest.ts

import type { ModelManifestSchema } from '@aikami/schemas';
import type { Static } from 'typebox';

export type ModelManifest = Static<typeof ModelManifestSchema>;
export type ModelManifestEntry = Static<typeof ModelManifestSchema>['entries'][number];
export type ManifestEntryModality = ModelManifestEntry['modality'];
export type ManifestEntryTier = ModelManifestEntry['tier'];
