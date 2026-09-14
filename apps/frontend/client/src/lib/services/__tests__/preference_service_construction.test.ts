// apps/frontend/client/src/lib/services/__tests__/preference_service_construction.test.ts
//
// C-527 AC-6 — construction-time restore of the persisted UI preferences.
//
// 🔴 Why this file exists and why it imports DYNAMICALLY.
//
// The regression this guards: both preference services restored their value
// only in an `initialize()` that a caller had to remember to invoke. The game
// composition root called it; the `/settings` route never did, so the standalone
// settings page showed the in-memory default (`auto`) on every visit while the
// chosen value sat in localStorage. The stored value was honoured in-game and
// silently ignored on the other Production Path.
//
// The fix moves the restore into the CONSTRUCTOR, so there is no call site to
// forget. Proving that needs a genuinely FRESH construction — the singleton is
// built at module load, long before a test can seed storage. Bun isolates each
// test FILE, so if this file never statically imports the service, the dynamic
// `import()` below is the module's first evaluation and therefore a real
// constructor run. (Do not add a static import of either service here: it would
// hoist the module load above the `localStorage.setItem` and make the assertion
// vacuous.)
//
// No exported factory is involved: a test-only factory export has no production
// caller and is rejected by `scripts:guard-orphaned-capability`.

import { describe, expect, test } from 'bun:test';

const MOTION_KEY = 'aikami:motion:preference';
const QUEST_OVERLAY_KEY = 'aikami:quest-overlay:visible';

describe('C-527 preference services restore at construction', () => {
  test('a freshly loaded motion service adopts the stored selection', async () => {
    localStorage.setItem(MOTION_KEY, 'reduce');

    const { motionPreferenceService } = await import(
      '../settings/motion_preference_service.svelte.ts'
    );

    expect(motionPreferenceService.preference).toBe('reduce');
  });

  test('a freshly loaded quest-overlay service adopts the stored visibility', async () => {
    localStorage.setItem(QUEST_OVERLAY_KEY, '0');

    const { questOverlayService } = await import('../game/quest_overlay_service.svelte.ts');

    // Before the fix this returned `true` on every reload: the service had an
    // `initialize()` that read the key and nothing ever called it.
    expect(questOverlayService.visible).toBe(false);
  });
});
