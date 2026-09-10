// apps/frontend/client/src/lib/views/gallery/testing/gallery_reactive_fixtures.svelte.ts
//
// Reactive gallery double for the real-Svelte (Vitest Browser Mode) lane. The
// per-chat image map and total count are real `$state`, so a test can mutate
// them and observe the ViewModel's getters update.

import type { GalleryImage } from '@aikami/types';
import type { GalleryCapabilities } from '../gallery_view_model.svelte';

export type ReactiveGalleryHarness = {
  /** The capability object to inject into the ViewModel. */
  gallery: GalleryCapabilities;
  /** Replace the reactive images for a chat. */
  setChatImages(chatId: string, images: GalleryImage[]): void;
  /** Set the reactive total count. */
  setTotalCount(count: number): void;
};

/**
 * Creates a gallery double whose per-chat images and total count are real Svelte
 * `$state`.
 */
export const createReactiveGalleryHarness = (): ReactiveGalleryHarness => {
  let totalCount = $state(0);
  let byChat = $state<Record<string, GalleryImage[]>>({});

  const gallery: GalleryCapabilities = {
    get totalCount() {
      return totalCount;
    },
    getImagesForChat: (chatId) => byChat[chatId] ?? [],
    removeImage: (id) => {
      const next: Record<string, GalleryImage[]> = {};
      for (const [chat, images] of Object.entries(byChat)) {
        next[chat] = images.filter((image) => image.id !== id);
      }
      byChat = next;
      totalCount = Math.max(0, totalCount - 1);
    },
  };

  return {
    gallery,
    setChatImages: (chatId, images) => {
      byChat = { ...byChat, [chatId]: images };
    },
    setTotalCount: (count) => {
      totalCount = count;
    },
  };
};
