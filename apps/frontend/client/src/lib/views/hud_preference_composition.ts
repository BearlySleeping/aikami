// apps/frontend/client/src/lib/views/hud_preference_composition.ts
// Shared production wiring for every HUD customization entry point.

import { featureFlags } from '@aikami/frontend/configs';
import { hudPreferenceService } from '$services';

hudPreferenceService.setEditorEnabled(featureFlags.hudCustomization);

/** HUD preference authority configured with the build-time customization switch. */
export const configuredHudPreferenceService = hudPreferenceService;
