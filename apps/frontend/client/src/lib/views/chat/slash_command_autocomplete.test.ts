// apps/frontend/client/src/lib/views/chat/slash_command_autocomplete.test.ts
//
// Unit tests for the SlashCommandAutocomplete sub-service (C-425).
// Verifies completion computation, keyboard navigation, apply/dismiss
// behaviour, and that applying delegates to the injected onApply callback
// rather than reaching back into a parent ViewModel.
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json \
//     src/lib/views/chat/slash_command_autocomplete.test.ts

import { describe, expect, test } from 'bun:test';

import {
  getSlashCommandAutocomplete,
  type SlashCommandAutocompleteInterface,
} from './slash_command_autocomplete.svelte.ts';

const createAutocomplete = (
  onApply: (commandName: string) => void = () => {},
): SlashCommandAutocompleteInterface =>
  getSlashCommandAutocomplete({ className: 'SlashCommandAutocompleteTest', onApply });

describe('SlashCommandAutocomplete (C-425)', () => {
  describe('update', () => {
    test('shows completions for a bare slash prefix', () => {
      const ac = createAutocomplete();
      ac.update('/');
      expect(ac.visible).toBe(true);
      expect(ac.completions.length).toBeGreaterThan(0);
      expect(ac.selectedIndex).toBe(0);
    });

    test('filters completions by prefix', () => {
      const ac = createAutocomplete();
      ac.update('/imp');
      expect(ac.visible).toBe(true);
      expect(ac.completions.length).toBe(1);
      expect(ac.completions[0]?.name).toBe('impersonate');
    });

    test('hides completions for non-slash input', () => {
      const ac = createAutocomplete();
      ac.update('hello');
      expect(ac.visible).toBe(false);
      expect(ac.completions).toHaveLength(0);
      expect(ac.selectedIndex).toBe(-1);
    });

    test('hides completions once a space is typed (full command)', () => {
      const ac = createAutocomplete();
      ac.update('/roll 2d6');
      expect(ac.visible).toBe(false);
      expect(ac.completions).toHaveLength(0);
    });
  });

  describe('navigate', () => {
    test('wraps down past the last completion', () => {
      const ac = createAutocomplete();
      ac.update('/');
      const count = ac.completions.length;
      ac.navigate(1);
      expect(ac.selectedIndex).toBe(1);
      // Jump to the end, then wrap to 0.
      ac.navigate(count - 1);
      expect(ac.selectedIndex).toBe(0);
    });

    test('wraps up past the first completion', () => {
      const ac = createAutocomplete();
      ac.update('/');
      ac.navigate(-1);
      expect(ac.selectedIndex).toBe(ac.completions.length - 1);
    });

    test('is a no-op when there are no completions', () => {
      const ac = createAutocomplete();
      ac.update('hello');
      ac.navigate(1);
      expect(ac.selectedIndex).toBe(-1);
    });
  });

  describe('apply', () => {
    test('delegates the command name to onApply and dismisses', () => {
      const applied: string[] = [];
      const ac = createAutocomplete((name) => applied.push(name));
      ac.update('/imp');
      ac.apply();
      expect(applied).toEqual(['impersonate']);
      expect(ac.visible).toBe(false);
      expect(ac.completions).toHaveLength(0);
      expect(ac.selectedIndex).toBe(-1);
    });

    test('is a no-op when the popup is not visible', () => {
      const applied: string[] = [];
      const ac = createAutocomplete((name) => applied.push(name));
      ac.update('hello');
      ac.apply();
      expect(applied).toHaveLength(0);
    });
  });

  describe('selectAndApply', () => {
    test('selects the given index and applies it', () => {
      const applied: string[] = [];
      const ac = createAutocomplete((name) => applied.push(name));
      ac.update('/');
      ac.selectAndApply(1);
      expect(applied).toHaveLength(1);
      expect(ac.visible).toBe(false);
    });
  });

  describe('dismiss', () => {
    test('clears all completion state', () => {
      const ac = createAutocomplete();
      ac.update('/');
      expect(ac.visible).toBe(true);
      ac.dismiss();
      expect(ac.visible).toBe(false);
      expect(ac.completions).toHaveLength(0);
      expect(ac.selectedIndex).toBe(-1);
    });
  });
});
