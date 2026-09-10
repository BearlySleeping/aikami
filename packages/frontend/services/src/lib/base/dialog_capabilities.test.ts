// packages/frontend/services/src/lib/base/dialog_capabilities.test.ts
//
// The base package must stay import-safe (no dialog at import time) while
// failing loudly when a dialog helper is used before the app bootstrap
// registers an implementation. setDialogCapabilities returns the previous
// value so tests can restore scoped state.

import { describe, expect, it } from 'bun:test';
import {
  type DialogCapabilities,
  getDialogCapabilities,
  setDialogCapabilities,
} from './dialog_capabilities.ts';

describe('dialog capabilities bridge', () => {
  it('throws when used before registration', () => {
    const previous = setDialogCapabilities(undefined);
    try {
      expect(() => getDialogCapabilities()).toThrow(/not registered/i);
    } finally {
      setDialogCapabilities(previous);
    }
  });

  it('registers an implementation and restores the previous one', () => {
    const fake: DialogCapabilities = {
      showSnackbar: () => {},
      showConditionalSnackbar: () => {},
      setAppLoading: () => {},
      open: async () => undefined,
    };

    const previous = setDialogCapabilities(fake);
    try {
      expect(getDialogCapabilities()).toBe(fake);
    } finally {
      setDialogCapabilities(previous);
    }
  });
});
