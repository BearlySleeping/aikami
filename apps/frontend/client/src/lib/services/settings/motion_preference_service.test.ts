// apps/frontend/client/src/lib/services/settings/motion_preference_service.test.ts
//
// C-527 AC-6 — the persisted motion selection. Guards the two properties the
// effective policy depends on: an explicit choice round-trips through storage,
// and a stale/corrupt value degrades to `auto` rather than forcing motion.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createMotionPreferenceService,
  motionPreferenceService,
} from './motion_preference_service.svelte.ts';

const KEY = 'aikami:motion:preference';

describe('MotionPreferenceService', () => {
  beforeEach(() => {
    localStorage.removeItem(KEY);
    motionPreferenceService.setPreference('auto');
  });

  afterEach(() => {
    localStorage.removeItem(KEY);
    motionPreferenceService.setPreference('auto');
  });

  test('defaults to auto — the OS preference decides', () => {
    expect(motionPreferenceService.preference).toBe('auto');
  });

  test('an explicit selection updates state and persists', () => {
    motionPreferenceService.setPreference('reduce');
    expect(motionPreferenceService.preference).toBe('reduce');
    expect(localStorage.getItem(KEY)).toBe('reduce');

    motionPreferenceService.setPreference('full');
    expect(motionPreferenceService.preference).toBe('full');
    expect(localStorage.getItem(KEY)).toBe('full');
  });

  test('initialize restores a persisted selection', async () => {
    localStorage.setItem(KEY, 'reduce');
    await motionPreferenceService.initialize();
    expect(motionPreferenceService.preference).toBe('reduce');
  });

  test('initialize degrades a corrupt value to auto rather than throwing', async () => {
    localStorage.setItem(KEY, 'sideways');
    await motionPreferenceService.initialize();
    expect(motionPreferenceService.preference).toBe('auto');
  });

  test('setPreference ignores an unknown value without writing it', () => {
    motionPreferenceService.setPreference('reduce');
    motionPreferenceService.setPreference('sideways' as never);

    expect(motionPreferenceService.preference).toBe('reduce');
    expect(localStorage.getItem(KEY)).toBe('reduce');
  });

  // 🔴 The regression this guards: the restore used to live only in
  // `initialize()`, which the game composition root called — so the Settings
  // page (`/settings`), the OTHER entry point named by AC-6, showed the
  // in-memory default after every reload while the value sat in storage.
  describe('construction-time restore (every entry point, no call site to forget)', () => {
    test('a freshly constructed service adopts the stored selection', () => {
      localStorage.setItem(KEY, 'reduce');
      const service = createMotionPreferenceService({ className: 'MotionPreferenceServiceTest' });

      expect(service.preference).toBe('reduce');
    });

    test('a fresh service with nothing stored stays on auto', () => {
      localStorage.removeItem(KEY);
      const service = createMotionPreferenceService({ className: 'MotionPreferenceServiceTest' });

      expect(service.preference).toBe('auto');
    });

    test('a fresh service degrades a corrupt stored value to auto', () => {
      localStorage.setItem(KEY, 'sideways');
      const service = createMotionPreferenceService({ className: 'MotionPreferenceServiceTest' });

      expect(service.preference).toBe('auto');
    });
  });
});
