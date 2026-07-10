// apps/frontend/client/src/lib/services/image/gallery_service.svelte.ts
//
// Per-chat image gallery that stores generated image metadata (URLs, prompts,
// timestamps, character names). Provides add/remove/query operations scoped
// to a chat ID. Used by the unified gallery panel across combat, exploration,
// and NPC interactions.
//
// Contract: C-242 Image Generation Pipeline

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { GalleryImage, ImageType } from '@aikami/types';

export type GalleryServiceInterface = BaseFrontendClassInterface & {
  /**
   * Returns all gallery images for a given chat ID, most recent first.
   * @param chatId - The chat/encounter ID to query.
   */
  getImagesForChat(chatId: string): GalleryImage[];
  /**
   * Adds a generated image to the gallery for a given chat.
   * @param options - Image metadata.
   */
  addImage(options: {
    chatId: string;
    url: string;
    prompt: string;
    imageType: ImageType;
    characterName?: string;
  }): GalleryImage;
  /**
   * Removes an image from the gallery by ID.
   * @param id - The image ID to remove.
   */
  removeImage(id: string): void;
  /**
   * Returns the total image count across all chats.
   */
  get totalCount(): number;
};

export type GalleryServiceOptions = BaseFrontendClassOptions & {
  /** Maximum number of images to retain per chat. */
  maxPerChat?: number;
};

// ── Implementation ──────────────────────────────────────────────────────

const DEFAULT_MAX_PER_CHAT = 100;

export class GalleryService
  extends BaseFrontendClass<GalleryServiceOptions>
  implements GalleryServiceInterface
{
  /** All gallery images across all chats. */
  private _images: GalleryImage[] = $state([]);

  private readonly _maxPerChat: number;

  constructor(options: GalleryServiceOptions) {
    super(options);
    this._maxPerChat = options.maxPerChat ?? DEFAULT_MAX_PER_CHAT;
  }

  getImagesForChat(chatId: string): GalleryImage[] {
    return this._images
      .filter((img) => img.chatId === chatId)
      .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  }

  addImage(options: {
    chatId: string;
    url: string;
    prompt: string;
    imageType: ImageType;
    characterName?: string;
  }): GalleryImage {
    const image: GalleryImage = {
      id: `gallery-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      chatId: options.chatId,
      url: options.url,
      prompt: options.prompt,
      imageType: options.imageType,
      generatedAt: new Date().toISOString(),
      characterName: options.characterName,
    };

    this._images = [...this._images, image];

    // Enforce per-chat cap
    const chatImages = this._images.filter((img) => img.chatId === options.chatId);
    if (chatImages.length > this._maxPerChat) {
      const oldest = chatImages[chatImages.length - 1];
      this._images = this._images.filter((img) => img.id !== oldest.id);
      this.debug('addImage: evicted oldest', { chatId: options.chatId, evicted: oldest.id });
    }

    return image;
  }

  removeImage(id: string): void {
    this._images = this._images.filter((img) => img.id !== id);
  }

  get totalCount(): number {
    return this._images.length;
  }
}

export const galleryService: GalleryServiceInterface = GalleryService.create({
  className: 'GalleryService',
});
