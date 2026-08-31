// apps/frontend/client/src/lib/views/settings/attribution/attribution_view_model.test.ts
//
// Contract: C-381 AC-1 — attribution screen displays provenance

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { AttributionViewModel } from './attribution_view_model.svelte.ts';

describe('AttributionViewModel — C-381 AC-1', () => {
  let vm: AttributionViewModel;

  beforeEach(() => {
    vm = AttributionViewModel.create({ className: 'AttributionViewModel' });
  });

  test('starts with empty entries and unknown pack name', () => {
    expect(vm.entries).toBeDefined();
    expect(vm.entries).toHaveLength(0);
    expect(vm.packName).toBe('');
  });

  test('exposes backToMenu method', () => {
    expect(typeof vm.backToMenu).toBe('function');
  });

  test('implements BaseViewModelInterface', () => {
    expect(vm).toHaveProperty('initialize');
    expect(vm).toHaveProperty('dispose');
    expect(vm).toHaveProperty('backToMenu');
  });
});
