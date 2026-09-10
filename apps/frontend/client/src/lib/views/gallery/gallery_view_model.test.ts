// apps/frontend/client/src/lib/views/gallery/gallery_view_model.test.ts
//
// Unit tests for GalleryViewModel — per-chat images, full-res expansion, and
// deletion. Exercises the ViewModel through feature-owned fixtures — no global
// `$services` barrel mock.
//
// Contract: C-242 Image Generation Pipeline

import { describe, expect, mock, test } from 'bun:test';
import { BaseViewModel } from '@aikami/frontend/services/base';
import type { GalleryImage } from '@aikami/types';
import { createGalleryViewModel, type GalleryCapabilities } from './gallery_view_model.svelte';
import { createGalleryCapabilities } from './testing/gallery_fixtures.ts';

const makeImage = (overrides: Partial<GalleryImage> = {}): GalleryImage => ({
  id: 'img-1',
  chatId: 'chat-1',
  url: 'https://example.com/img-1.png',
  prompt: 'a scene',
  imageType: 'illustration',
  generatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const createViewModel = (
  gallery: GalleryCapabilities = createGalleryCapabilities(),
  chatId?: string,
) => createGalleryViewModel({ className: 'GalleryViewModelTest', gallery, chatId });

describe('GalleryViewModel — images', () => {
  test('returns no images until a chat is selected', () => {
    const getImagesForChat = mock(() => [makeImage()]);
    const viewModel = createViewModel(createGalleryCapabilities({ getImagesForChat }));

    expect(viewModel.images).toEqual([]);
    expect(getImagesForChat).not.toHaveBeenCalled();
  });

  test('reads images for the selected chat', () => {
    const image = makeImage({ id: 'img-1' });
    const getImagesForChat = mock((_chatId: string) => [image]);
    const viewModel = createViewModel(createGalleryCapabilities({ getImagesForChat }), 'chat-1');

    expect(viewModel.images).toEqual([image]);
    expect(getImagesForChat).toHaveBeenCalledWith('chat-1');
  });

  test('setChatId switches the selected chat', () => {
    const getImagesForChat = mock((chatId: string) =>
      chatId === 'chat-2' ? [makeImage({ id: 'img-2', chatId: 'chat-2' })] : [],
    );
    const viewModel = createViewModel(createGalleryCapabilities({ getImagesForChat }), 'chat-1');

    viewModel.setChatId('chat-2');

    expect(viewModel.images).toHaveLength(1);
    expect(viewModel.images[0].id).toBe('img-2');
  });

  test('reports the total count from the capability', () => {
    const viewModel = createViewModel(createGalleryCapabilities({ totalCount: 7 }));

    expect(viewModel.totalCount).toBe(7);
  });
});

describe('GalleryViewModel — expansion', () => {
  test('expandImage and closeExpand manage the modal URL', () => {
    const viewModel = createViewModel();

    viewModel.expandImage('https://example.com/full.png');
    expect(viewModel.expandedImageUrl).toBe('https://example.com/full.png');

    viewModel.closeExpand();
    expect(viewModel.expandedImageUrl).toBeNull();
  });
});

describe('GalleryViewModel — deletion', () => {
  test('deleteImage removes the image and closes the modal when it was expanded', () => {
    const image = makeImage({ id: 'img-1', url: 'https://example.com/img-1.png' });
    const removeImage = mock((_id: string) => {});
    const viewModel = createViewModel(
      createGalleryCapabilities({ getImagesForChat: () => [image], removeImage }),
      'chat-1',
    );
    viewModel.expandImage(image.url);

    viewModel.deleteImage('img-1');

    expect(removeImage).toHaveBeenCalledWith('img-1');
    expect(viewModel.expandedImageUrl).toBeNull();
  });

  test('deleteImage keeps the modal open when a different image is expanded', () => {
    const images = [
      makeImage({ id: 'img-1', url: 'https://example.com/img-1.png' }),
      makeImage({ id: 'img-2', url: 'https://example.com/img-2.png' }),
    ];
    const viewModel = createViewModel(
      createGalleryCapabilities({ getImagesForChat: () => images, removeImage: () => {} }),
      'chat-1',
    );
    viewModel.expandImage('https://example.com/img-2.png');

    viewModel.deleteImage('img-1');

    expect(viewModel.expandedImageUrl).toBe('https://example.com/img-2.png');
  });

  test('deleteExpanded removes the currently expanded image', () => {
    const image = makeImage({ id: 'img-1', url: 'https://example.com/img-1.png' });
    const removeImage = mock((_id: string) => {});
    const viewModel = createViewModel(
      createGalleryCapabilities({ getImagesForChat: () => [image], removeImage }),
      'chat-1',
    );
    viewModel.expandImage(image.url);

    viewModel.deleteExpanded();

    expect(removeImage).toHaveBeenCalledWith('img-1');
  });

  test('deleteExpanded is a no-op without an expanded image', () => {
    const removeImage = mock((_id: string) => {});
    const viewModel = createViewModel(createGalleryCapabilities({ removeImage }));

    viewModel.deleteExpanded();

    expect(removeImage).not.toHaveBeenCalled();
  });
});

describe('GalleryViewModel — real base class', () => {
  test('extends the production BaseViewModel', () => {
    expect(createViewModel()).toBeInstanceOf(BaseViewModel);
  });
});
