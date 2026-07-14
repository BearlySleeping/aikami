// apps/frontend/client/src/lib/views/gallery/gallery_view_model.svelte.ts
//
// ViewModel for the unified image gallery panel. Displays per-chat image
// thumbnails in a masonry grid, supports full-res expansion via modal, and
// allows deletion of individual images.
//
// Contract: C-242 Image Generation Pipeline

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { GalleryImage } from '@aikami/types';
import { galleryService } from '$services';

export type GalleryViewModelInterface = BaseViewModelInterface & {
  /** Images for the current chat, most recent first. */
  readonly images: GalleryImage[];
  /** Currently expanded image for full-res modal. Null if none. */
  expandedImageUrl: string | null;
  /** Total image count across all chats. */
  readonly totalCount: number;
  /** Set the chat ID to display images for. */
  setChatId(chatId: string): void;
  /** Expand an image to full-res. */
  expandImage(url: string): void;
  /** Close the full-res modal. */
  closeExpand(): void;
  /** Delete an image from the gallery. */
  deleteImage(id: string): void;
  /** Delete the currently expanded image. */
  deleteExpanded(): void;
};

export type GalleryViewModelOptions = BaseViewModelOptions & {
  /** Initial chat ID to display. */
  chatId?: string;
};

export class GalleryViewModel
  extends BaseViewModel<GalleryViewModelOptions>
  implements GalleryViewModelInterface
{
  private _chatId = $state<string>('');
  expandedImageUrl = $state<string | null>(null);

  constructor(options: GalleryViewModelOptions) {
    super(options);
    this._chatId = options.chatId ?? '';
  }

  get images(): GalleryImage[] {
    if (!this._chatId) {
      return [];
    }
    return galleryService.getImagesForChat(this._chatId);
  }

  get totalCount(): number {
    return galleryService.totalCount;
  }

  setChatId(chatId: string): void {
    this._chatId = chatId;
  }

  expandImage(url: string): void {
    this.expandedImageUrl = url;
  }

  closeExpand(): void {
    this.expandedImageUrl = null;
  }

  deleteImage(id: string): void {
    if (this.expandedImageUrl) {
      const image = this.images.find((img) => img.id === id);
      if (image?.url === this.expandedImageUrl) {
        this.expandedImageUrl = null;
      }
    }
    galleryService.removeImage(id);
  }

  deleteExpanded(): void {
    const url = this.expandedImageUrl;
    if (!url) {
      return;
    }
    const image = this.images.find((img) => img.url === url);
    if (image) {
      this.deleteImage(image.id);
    }
  }
}

export const getGalleryViewModel = (options: GalleryViewModelOptions): GalleryViewModelInterface =>
  GalleryViewModel.create(options);
