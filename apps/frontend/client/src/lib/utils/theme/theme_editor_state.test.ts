// apps/frontend/client/src/lib/utils/theme/theme_editor_state.test.ts

import { describe, expect, test } from 'bun:test';
import { duplicateBuiltInTheme, setDraftVariantFromJson } from './theme_editor_state.ts';

describe('C-529 theme editor JSON shape validation', () => {
  test('rejects null tokens and missing required profile fields without replacing the draft', () => {
    const draft = duplicateBuiltInTheme();
    for (const value of [
      { profileVersion: 1, variant: 'light', tokens: null },
      { variant: 'light', tokens: {} },
      { profileVersion: 1, variant: 'sepia', tokens: {} },
    ]) {
      const result = setDraftVariantFromJson(draft, 'light', JSON.stringify(value));
      expect(result.draft).toBe(draft);
      expect(result.issues[0]?.code).toBe('editor.invalid-shape');
    }
  });

  test('keeps valid token files on the compiler-backed draft path', () => {
    const draft = duplicateBuiltInTheme();
    const result = setDraftVariantFromJson(
      draft,
      'light',
      JSON.stringify({
        profileVersion: 1,
        variant: 'light',
        tokens: { 'color.primary': { $type: 'color', $value: '#123456' } },
      }),
    );
    expect(result.draft).not.toBe(draft);
    expect(result.issues).toEqual([]);
  });
});
