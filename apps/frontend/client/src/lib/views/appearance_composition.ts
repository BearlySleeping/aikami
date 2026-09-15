// apps/frontend/client/src/lib/views/appearance_composition.ts
// Shared production wiring for every appearance entry point (C-529).
//
// Mirrors `hud_preference_composition.ts`: the singleton is constructed at
// import time — which restores the stored selection and applies it — and every
// ViewModel receives it as a typed capability rather than importing `$services`
// itself.

import { appearancePreferenceService } from '$services';

/** Appearance authority (mode + theme id/version + installed theme bytes). */
export const configuredAppearancePreferenceService = appearancePreferenceService;
