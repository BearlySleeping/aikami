// apps/frontend/client/src/lib/views/dev/image_gen/image_gen_view_model.svelte.ts
//
// Dev sandbox ViewModel for the Image Generation Pipeline (C-242).
// Integrates style profile editor, prompt compiler test area with live
// output, contextual trigger simulator, and gallery viewer.
//
// Contract: C-242 Image Generation Pipeline

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type {
  ContextualTriggerEvent,
  GalleryImage,
  ImageStyleProfile,
  ImageType,
} from '@aikami/types';
import { compileImagePrompt } from '$lib/services/image/prompt_compiler';
import { contextualTriggerService, galleryService, styleProfileService } from '$services';

// ── Tab definitions ────────────────────────────────────────────────────

export const IMAGE_GEN_TABS = ['profiles', 'compiler', 'triggers', 'gallery'] as const;
export type ImageGenTab = (typeof IMAGE_GEN_TABS)[number];

const TAB_META = [
  { key: 'profiles' as const, label: 'Profiles' },
  { key: 'compiler' as const, label: 'Compiler' },
  { key: 'triggers' as const, label: 'Triggers' },
  { key: 'gallery' as const, label: 'Gallery' },
];

// ── Interface ──────────────────────────────────────────────────────────

export type ImageGenViewModelInterface = BaseViewModelInterface & {
  // Tabs
  readonly tabs: readonly { key: ImageGenTab; label: string }[];
  activeTab: ImageGenTab;

  // Profiles (delegated)
  readonly profiles: readonly ImageStyleProfile[];
  readonly activeProfile: ImageStyleProfile | undefined;
  get activeProfileId(): string;
  set activeProfileId(value: string);
  cloneProfile(id: string): void;
  deleteProfile(id: string): void;
  startEditingProfile(id: string): void;
  editingProfile: ImageStyleProfile | undefined;
  get isEditing(): boolean;
  saveProfile(): void;
  cancelEditing(): void;
  updateEditingField(field: keyof ImageStyleProfile, value: string): void;
  updatePerImageTag(imageType: string, value: string): void;
  get activeProfilePerImageTags(): readonly (readonly [string, string])[];

  // Prompt compiler test area
  compilerBasePrompt: string;
  compilerImageType: ImageType;
  compilerResultPositive: string;
  compilerResultNegative: string;
  runCompiler(): void;

  // Contextual trigger simulator
  triggerEvent: ContextualTriggerEvent;
  triggerContext: string;
  triggerCharacterName: string;
  triggerEnabled: boolean;
  triggerResultPositive: string;
  triggerResultNegative: string;
  fireTrigger(): Promise<void>;

  // Gallery
  galleryChatId: string;
  galleryImages: GalleryImage[];
  galleryExpandedUrl: string | null;
  setGalleryChatId(chatId: string): void;
  expandGalleryImage(url: string): void;
  closeGalleryExpand(): void;
  deleteGalleryImage(id: string): void;
  addMockGalleryImage(): void;
};

export type ImageGenViewModelOptions = BaseViewModelOptions & {};

// ── Implementation ──────────────────────────────────────────────────────

export class ImageGenViewModel
  extends BaseViewModel<ImageGenViewModelOptions>
  implements ImageGenViewModelInterface
{
  // Tabs
  readonly tabs = TAB_META;
  activeTab = $state<ImageGenTab>('profiles');

  // Profile editor state
  editingProfile = $state<ImageStyleProfile | undefined>();
  editingName = $state('');
  editingPositiveTags = $state('');
  editingNegativeTags = $state('');

  // Compiler test area
  compilerBasePrompt = $state('a dark forest with glowing mushrooms');
  compilerImageType = $state<ImageType>('background');
  compilerResultPositive = $state('');
  compilerResultNegative = $state('');

  // Trigger simulator
  triggerEvent = $state<ContextualTriggerEvent>('location_changed');
  triggerContext = $state('The Crystal Caverns');
  triggerCharacterName = $state('');
  triggerEnabled = $state(true);
  triggerResultPositive = $state('');
  triggerResultNegative = $state('');

  // Gallery
  galleryChatId = $state('dev-sandbox');
  galleryExpandedUrl = $state<string | null>(null);

  // ── Profiles (delegated) ─────────────────────────────────────────────

  get profiles(): readonly ImageStyleProfile[] {
    return styleProfileService.profiles;
  }

  get activeProfile(): ImageStyleProfile | undefined {
    return styleProfileService.activeProfile;
  }

  get activeProfileId(): string {
    return styleProfileService.activeProfileId;
  }

  set activeProfileId(value: string) {
    styleProfileService.setActiveProfile(value);
  }

  get isEditing(): boolean {
    return this.editingProfile !== undefined;
  }

  cloneProfile(id: string): void {
    const cloned = styleProfileService.cloneProfile(id);
    if (cloned) {
      this.editingProfile = { ...cloned };
      styleProfileService.setActiveProfile(cloned.id);
    }
  }

  deleteProfile(id: string): void {
    styleProfileService.deleteProfile(id);
    if (this.editingProfile?.id === id) {
      this.editingProfile = undefined;
    }
  }

  startEditingProfile(id: string): void {
    const source = this.profiles.find((p) => p.id === id);
    if (!source) {
      return;
    }
    if (source.isBuiltIn) {
      const cloned = styleProfileService.cloneProfile(id);
      if (cloned) {
        this.editingProfile = { ...cloned };
        styleProfileService.setActiveProfile(cloned.id);
      }
    } else {
      this.editingProfile = { ...source };
    }
  }

  saveProfile(): void {
    if (!this.editingProfile) {
      return;
    }
    styleProfileService.saveProfile(this.editingProfile);
    this.editingProfile = undefined;
  }

  cancelEditing(): void {
    this.editingProfile = undefined;
  }

  updateEditingField(field: keyof ImageStyleProfile, value: string): void {
    if (!this.editingProfile) {
      return;
    }
    this.editingProfile = { ...this.editingProfile, [field]: value };
  }

  updatePerImageTag(imageType: string, value: string): void {
    if (!this.editingProfile) {
      return;
    }
    this.editingProfile = {
      ...this.editingProfile,
      perImageTags: { ...this.editingProfile.perImageTags, [imageType]: value },
    };
  }

  get activeProfilePerImageTags(): readonly (readonly [string, string])[] {
    const profile = this.activeProfile;
    if (!profile) {
      return [];
    }
    return Object.entries(profile.perImageTags).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0,
    );
  }

  // ── Compiler ─────────────────────────────────────────────────────────

  runCompiler(): void {
    const profile = this.activeProfile;
    if (!profile) {
      this.compilerResultPositive = '(no profile selected)';
      this.compilerResultNegative = '';
      return;
    }
    const result = compileImagePrompt({
      basePrompt: this.compilerBasePrompt,
      profile,
      imageType: this.compilerImageType,
    });
    this.compilerResultPositive = result.positive;
    this.compilerResultNegative = result.negative;
  }

  // ── Triggers ─────────────────────────────────────────────────────────

  async fireTrigger(): Promise<void> {
    contextualTriggerService.enabled = this.triggerEnabled;
    const result = await contextualTriggerService.fireTrigger({
      event: this.triggerEvent,
      context: this.triggerContext,
      characterName: this.triggerCharacterName || undefined,
    });
    if (result) {
      this.triggerResultPositive = result.positive;
      this.triggerResultNegative = result.negative;
    } else {
      this.triggerResultPositive = '(debounced or disabled)';
      this.triggerResultNegative = '';
    }
  }

  // ── Gallery ───────────────────────────────────────────────────────────

  get galleryImages(): GalleryImage[] {
    return galleryService.getImagesForChat(this.galleryChatId);
  }

  setGalleryChatId(chatId: string): void {
    this.galleryChatId = chatId;
  }

  expandGalleryImage(url: string): void {
    this.galleryExpandedUrl = url;
  }

  closeGalleryExpand(): void {
    this.galleryExpandedUrl = null;
  }

  deleteGalleryImage(id: string): void {
    if (this.galleryExpandedUrl) {
      const image = this.galleryImages.find((img) => img.id === id);
      if (image?.url === this.galleryExpandedUrl) {
        this.galleryExpandedUrl = null;
      }
    }
    galleryService.removeImage(id);
  }

  addMockGalleryImage(): void {
    galleryService.addImage({
      chatId: this.galleryChatId,
      url: `https://placehold.co/300x200?text=Image+${Date.now()}`,
      prompt: 'Mock image for testing the gallery panel',
      imageType: 'background',
    });
  }
}

export const getImageGenViewModel = (
  options: ImageGenViewModelOptions,
): ImageGenViewModelInterface => ImageGenViewModel.create(options);
