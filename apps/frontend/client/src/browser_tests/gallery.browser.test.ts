// apps/frontend/client/src/browser_tests/gallery.browser.test.ts
//
// Real-runes coverage for the migrated gallery ViewModel. The Bun suite uses
// plain fixtures; this lane runs the ViewModel in Chromium with the real Svelte
// compiler against a reactive gallery fixture.

import type { GalleryImage } from '@aikami/types';
import { flushSync } from 'svelte';
import { afterEach, describe, expect, test } from 'vitest';
import { createGalleryViewModel } from '../lib/views/gallery/gallery_view_model.svelte';
import { createReactiveGalleryHarness } from '../lib/views/gallery/testing/gallery_reactive_fixtures.svelte';

const disposables: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(disposables.splice(0).map((dispose) => dispose()));
});

const image = (id: string): GalleryImage => ({
  id,
  chatId: 'chat-1',
  url: `https://example.com/${id}.png`,
  prompt: 'a scene',
  imageType: 'illustration',
  generatedAt: '2026-01-01T00:00:00.000Z',
});

describe('GalleryViewModel — reactive gallery (real runes)', () => {
  test('images and total count follow the reactive capability', () => {
    const harness = createReactiveGalleryHarness();
    const viewModel = createGalleryViewModel({
      className: 'GalleryViewModel',
      gallery: harness.gallery,
      chatId: 'chat-1',
    });
    disposables.push(() => viewModel.dispose());

    expect(viewModel.images).toEqual([]);
    expect(viewModel.totalCount).toBe(0);

    harness.setChatImages('chat-1', [image('img-1')]);
    harness.setTotalCount(1);
    flushSync();

    expect(viewModel.images).toHaveLength(1);
    expect(viewModel.totalCount).toBe(1);

    viewModel.deleteImage('img-1');
    flushSync();

    expect(viewModel.images).toEqual([]);
    expect(viewModel.totalCount).toBe(0);
  });
});
