// apps/frontend/client/src/lib/views/lorebook/lorebook_sandbox_view_model.test.ts
//
// Unit tests for LorebookSandboxViewModel — keyword scanning, token budgeting,
// and Active Context panel state. The scanner is an injected capability.

import { describe, expect, mock, test } from 'bun:test';
import type { KeywordMatch, LorebookEntry } from '$types';
import {
  createLorebookSandboxViewModel,
  type LorebookSandboxScannerCapabilities,
} from './lorebook_sandbox_view_model.svelte';

// The shared preload installs a `window` polyfill without `location`, which
// BaseDevViewModel reads to detect the screenshot harness.
Object.assign(globalThis.window, { location: { search: '' } });

const entry: LorebookEntry = {
  id: 'entry-1',
  keywords: ['goblin'],
  content: 'A goblin',
  priority: 1,
  constant: false,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const match: KeywordMatch = { entry, matchReason: 'matched: goblin', matchedKeyword: 'goblin' };

const createScanner = (
  overrides: Partial<LorebookSandboxScannerCapabilities> = {},
): LorebookSandboxScannerCapabilities => ({
  scanKeywords: mock(() => [match]),
  ...overrides,
});

const createViewModel = (scanner: LorebookSandboxScannerCapabilities = createScanner()) =>
  createLorebookSandboxViewModel({ className: 'LorebookSandboxViewModelTest', scanner });

describe('LorebookSandboxViewModel — scanning', () => {
  test('delegates scanning to the injected scanner', () => {
    const scanKeywords = mock(() => [match]);
    const viewModel = createViewModel(createScanner({ scanKeywords }));

    expect(viewModel.scanResults).toEqual([match]);
    expect(scanKeywords).toHaveBeenCalledWith({
      entries: expect.any(Array),
      message: viewModel.scannerInput,
    });
  });

  test('returns no matches for empty input', () => {
    const scanKeywords = mock(() => [match]);
    const viewModel = createViewModel(createScanner({ scanKeywords }));

    viewModel.setScannerInput('   ');

    expect(viewModel.scanResults).toEqual([]);
    expect(scanKeywords).not.toHaveBeenCalled();
  });

  test('sums the byte size of matched entries', () => {
    const viewModel = createViewModel();

    expect(viewModel.tokenBudget).toBe(new TextEncoder().encode('A goblin').length);
  });
});

describe('LorebookSandboxViewModel — panels', () => {
  test('opens and closes the active-context drawer', () => {
    const viewModel = createViewModel();

    viewModel.openActiveContext();
    expect(viewModel.activeContextOpen).toBe(true);

    viewModel.closeActiveContext();
    expect(viewModel.activeContextOpen).toBe(false);
  });

  test('clears generated entries without saving', () => {
    const viewModel = createViewModel();

    viewModel.clearGeneratedEntries();

    expect(viewModel.generatedEntries).toEqual([]);
  });

  test('resetAll restores defaults', () => {
    const viewModel = createViewModel();
    viewModel.setScannerInput('changed');
    viewModel.openActiveContext();

    viewModel.resetAll();

    expect(viewModel.scannerInput).toBe('I see a goblin in the forest near Eldoria.');
    expect(viewModel.activeContextOpen).toBe(false);
  });
});
