// scripts/src/lib/ops/__tests__/guards_allowlist.test.ts
//
// Tests for the dynamic-import allowlist shared by M9 and S12.
//
// 🔴 The bug these exist for: the allowlist used to be a list of UNANCHORED
// regular expressions, so `/@aikami\/frontend\/engine/` was satisfied by
// `@aikami/frontend/engine-evil` and `/eruda/` by `evil-eruda-wrapper`. An
// allowlist that a substring can satisfy is not an allowlist — it is a naming
// convention, and an agent can satisfy a naming convention by renaming a
// dependency.

import { describe, expect, test } from 'bun:test';
import {
  hasQueryMarker,
  isAllowlistedSpecifier,
  isPackageOrSubpath,
  isWithinScope,
  matchesEntry,
  modulePathOf,
  packageEntry,
  queryEntry,
  queryOf,
  SHARED_ALLOWLIST,
  scopeEntry,
  VIEW_MODEL_ALLOWLIST,
} from '../guards/allowlist.ts';

describe('modulePathOf / queryOf', () => {
  test('splits the query and hash off a specifier', () => {
    expect(modulePathOf('pixi.js?raw')).toBe('pixi.js');
    expect(modulePathOf('./x.ts?worker&type=module')).toBe('./x.ts');
    expect(modulePathOf('./x.ts#frag')).toBe('./x.ts');
    expect(modulePathOf('pixi.js')).toBe('pixi.js');
  });

  test('extracts the query without its leading ?', () => {
    expect(queryOf('./x.ts?worker&type=module')).toBe('worker&type=module');
    expect(queryOf('pixi.js')).toBe('');
  });
});

describe('isPackageOrSubpath — exact package or an explicit subpath', () => {
  test('matches the package itself', () => {
    expect(isPackageOrSubpath('onnxruntime-web', 'onnxruntime-web')).toBe(true);
  });

  test('matches an explicit subpath', () => {
    expect(isPackageOrSubpath('onnxruntime-web/wasm', 'onnxruntime-web')).toBe(true);
    expect(isPackageOrSubpath('@aikami/frontend/engine/foo', '@aikami/frontend/engine')).toBe(true);
  });

  test('does NOT match a package whose name merely starts with it', () => {
    expect(isPackageOrSubpath('@aikami/frontend/engine-evil', '@aikami/frontend/engine')).toBe(
      false,
    );
    expect(isPackageOrSubpath('onnxruntime-web-extras', 'onnxruntime-web')).toBe(false);
    expect(isPackageOrSubpath('evil-eruda-wrapper', 'eruda')).toBe(false);
    expect(isPackageOrSubpath('not-eruda', 'eruda')).toBe(false);
  });

  test('ignores the query when matching', () => {
    expect(isPackageOrSubpath('pixi.js?raw', 'pixi.js')).toBe(true);
  });
});

describe('isWithinScope', () => {
  test('matches the scope root and its packages', () => {
    expect(isWithinScope('@tauri-apps/api', '@tauri-apps')).toBe(true);
    expect(isWithinScope('@tauri-apps', '@tauri-apps')).toBe(true);
    expect(isWithinScope('@tauri-apps/plugin-opener', '@tauri-apps')).toBe(true);
  });

  test('does NOT match a scope whose name merely starts with it', () => {
    expect(isWithinScope('@tauri-apps-evil/api', '@tauri-apps')).toBe(false);
    expect(isWithinScope('@tauri-apps2/api', '@tauri-apps')).toBe(false);
  });
});

describe('hasQueryMarker', () => {
  test('matches the marker as a whole parameter group', () => {
    expect(hasQueryMarker('./x.ts?worker&type=module', 'worker&type=module')).toBe(true);
    expect(hasQueryMarker('./x.ts?raw&worker&type=module', 'worker&type=module')).toBe(true);
    expect(hasQueryMarker('./x.ts?worker&type=module&inline', 'worker&type=module')).toBe(true);
  });

  test('does NOT match a marker that is a substring of a longer parameter', () => {
    expect(hasQueryMarker('./x.ts?worker&type=modules', 'worker&type=module')).toBe(false);
    expect(hasQueryMarker('./x.ts?notworker&type=module', 'worker&type=module')).toBe(false);
  });

  test('does not match when there is no query at all', () => {
    expect(hasQueryMarker('./x.ts', 'worker&type=module')).toBe(false);
  });
});

describe('matchesEntry', () => {
  test('dispatches on the entry kind', () => {
    expect(matchesEntry('eruda', packageEntry('eruda'))).toBe(true);
    expect(matchesEntry('@tauri-apps/api', scopeEntry('@tauri-apps'))).toBe(true);
    expect(matchesEntry('./w.ts?worker&type=module', queryEntry('worker&type=module'))).toBe(true);
  });
});

describe('isAllowlistedSpecifier — the shared list', () => {
  test('accepts the documented packages and their subpaths', () => {
    for (const specifier of [
      '@aikami/frontend/engine',
      '@aikami/frontend/engine/game_world',
      'onnxruntime-web',
      'onnxruntime-web/wasm',
      'kokoro-js',
      'pixi.js',
      'eruda',
      '@tauri-apps/api/core',
      './worker.ts?worker&type=module',
    ]) {
      expect(isAllowlistedSpecifier(specifier, SHARED_ALLOWLIST), specifier).toBe(true);
    }
  });

  test('rejects look-alike packages', () => {
    for (const specifier of [
      '@aikami/frontend/engine-evil',
      '@aikami/frontend/engine_evil',
      'onnxruntime-web-extras',
      'evil-eruda-wrapper',
      'eruda2',
      '@tauri-apps-evil/api',
      'pixi.js-extra',
      '$services',
      '$lib/services/assets/asset_manager.svelte',
    ]) {
      expect(isAllowlistedSpecifier(specifier, SHARED_ALLOWLIST), specifier).toBe(false);
    }
  });

  test('a non-literal dynamic import is never allowlisted', () => {
    // An unverifiable specifier is not an accepted one.
    expect(isAllowlistedSpecifier('', SHARED_ALLOWLIST)).toBe(false);
  });

  test('the ViewModel list adds frontend-preview and keeps the shared entries', () => {
    expect(isAllowlistedSpecifier('@aikami/frontend-preview', VIEW_MODEL_ALLOWLIST)).toBe(true);
    expect(isAllowlistedSpecifier('@aikami/frontend-preview/map', VIEW_MODEL_ALLOWLIST)).toBe(true);
    expect(isAllowlistedSpecifier('@aikami/frontend-preview-evil', VIEW_MODEL_ALLOWLIST)).toBe(
      false,
    );
    for (const specifier of ['onnxruntime-web', 'eruda', 'pixi.js']) {
      expect(isAllowlistedSpecifier(specifier, VIEW_MODEL_ALLOWLIST), specifier).toBe(true);
    }
  });
});
