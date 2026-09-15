// apps/frontend/client/src/lib/types/theme_appearance.ts
//
// C-529 AC-2 — the appearance picker's view of a selectable theme.
//
// Lives in `$types` rather than in the service module because a service file may
// only export its own singleton, options type and interface
// (`guard-service-conventions` S10). `AppearancePreferenceService.themeOptions`
// produces these and the Interface settings ViewModel consumes them, so the
// shape belongs to neither of them exclusively.

import type { ThemeVariant } from '@aikami/schemas';

/** One entry in the appearance picker. */
export type AppearanceThemeOption = {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly isBuiltIn: boolean;
  /** Variants the option can render from its own bytes. */
  readonly variants: readonly ThemeVariant[];
};
