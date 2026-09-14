// apps/frontend/client/src/lib/views/studio/studio_view_model.svelte.ts
//
// C-512: the Creator Studio ViewModel. Pick a recipe, write a prompt,
// generate against the local engine, review, save into the registry, and
// manage the local library.
//
// Dependencies arrive through typed capability options. This module never
// imports the `$services` barrel or a production singleton, so its tests inject
// fixtures; production wiring lives in ./studio_composition.ts.
//
// Contract: C-512 AC-1 / AC-4 / AC-5 / AC-6

import { STUDIO_EXPRESSION_PACK_EMOTIONS } from '@aikami/constants';

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type { LibraryEntry, StudioDraft, StudioRecipeOption } from '@aikami/types';
import type {
  GeneratedAssetOutcome,
  StudioAudioReview,
  StudioCapabilities,
  StudioLibraryRow,
  StudioPackRow,
} from '$types';
import {
  audioGenerationRefusal,
  buildLibraryRows,
  buildPackRows,
  buildStudioDraft,
  describeAudioCandidateLabel,
  isAudioRecipe,
} from './studio_audio_support.ts';
import { formatBytes, readFileAsDataUrl, toMessage } from './studio_file_support.ts';
import {
  describeDeleteRefusal,
  describePublishOutcome,
  describeSaveOutcome,
} from './studio_outcome_messages.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// The ViewModel's seam declarations live in `$types/studio.ts` — they describe
// data shapes, not behaviour, and a large declaration block in the unit that
// owns the studio's behaviour buries the behaviour. Re-exported so callers keep
// a single import site.
export type { StudioCapabilities, StudioLibraryRow, StudioPackRow };

// These two are declared HERE, not in `$types`: the ViewModel guard (M1/M2)
// requires the file to export its own `*ViewModelOptions` / `*ViewModelInterface`
// declarations, and a re-export is not a declaration.

export type StudioViewModelInterface = BaseViewModelInterface & {
  /** Every registered recipe, with engine availability resolved. */
  readonly recipes: readonly StudioRecipeOption[];
  /** The recipe the draft targets. */
  selectedRecipeId: string;
  /** The draft's positive prompt. */
  positivePrompt: string;
  /** The draft's negative prompt. */
  negativePrompt: string;
  /** NPC id for an NPC-bound draft (drives the resolver tag). */
  npcId: string;
  /** The last generated result, before saving. */
  readonly generated: GeneratedAssetOutcome | undefined;
  /** Whether a generation is in flight. */
  readonly isGenerating: boolean;
  /** Human-readable generation status. */
  readonly generationStatus: string;
  /** Whether a save is in flight. */
  readonly isSaving: boolean;
  /** The last save outcome message (success or refusal). */
  readonly saveMessage: string;
  /** The last error message, cleared on the next action. */
  readonly errorMessage: string;
  /** Whether the recipe list has been resolved. */
  readonly isReady: boolean;
  /** Whether every asynchronous initialization step has completed. */
  readonly isVisuallyReady: boolean;
  /** Whether the kill switch is on. */
  readonly generationEnabled: boolean;
  /** Whether the selected recipe can generate right now. */
  readonly canGenerate: boolean;
  /** Why generation is disabled, or an empty string when it is not. */
  readonly generateDisabledReason: string;
  /** Whether the community publish surface is enabled (kill switch). */
  readonly publishingEnabled: boolean;
  /** Whether a publish is in flight. */
  readonly isPublishing: boolean;
  /** The last publish outcome message. */
  readonly publishMessage: string;
  /** Publishes one library asset to the community namespace. */
  publishAsset(tag: string): Promise<void>;
  /** Whether the selected recipe is NPC-bound (portrait family). */
  readonly isNpcBound: boolean;
  /**
   * Recipes whose modality has no reachable engine, with the stated reason.
   *
   * C-513 AC-12: an unregistered engine must explain itself in the UI rather
   * than leaving a silently greyed-out option.
   */
  readonly unavailableRecipes: readonly { label: string; reason: string }[];
  /** The tag the next save will write. */
  readonly pendingTag: string;
  /** Locally generated assets, newest first. */
  readonly library: readonly LibraryEntry[];
  /** The library as display rows (formatting happens here, not in the view). */
  readonly libraryRows: readonly StudioLibraryRow[];
  /** Object URL of the generated result awaiting save, or an empty string. */
  readonly previewUrl: string;
  /** Whether a generated result is awaiting save. */
  readonly hasGenerated: boolean;
  /** The generated result's file extension, or an empty string. */
  readonly generatedExt: string;
  /** The generated result's engine id, or an empty string. */
  readonly generatedEngine: string;
  /** The generated result's seed, or an empty string when it was not fixed. */
  readonly generatedSeedLabel: string;
  /** C-521: audio recipes render the review panel, not an image preview. */
  readonly isAudioCandidate: boolean;
  /** C-521: the decoded-buffer review player, when audio review is wired. */
  readonly audioReview: StudioAudioReview | undefined;
  /** C-521: the review panel's tag/ext/engine summary. */
  readonly audioCandidateLabel: string;
  /** Whether the library is loading. */
  readonly isLibraryLoading: boolean;
  /** The entry being renamed, if any. */
  readonly renameTarget: LibraryEntry | undefined;
  /** The tag being renamed, or an empty string. */
  readonly renameTargetTag: string;
  /** Whether a rename is in progress. */
  readonly hasRenameTarget: boolean;
  /** The rename input value. */
  renameValue: string;
  /** The entry awaiting delete confirmation, if any. */
  readonly deleteTarget: LibraryEntry | undefined;
  /** The tag awaiting delete confirmation, or an empty string. */
  readonly deleteTargetTag: string;
  /** Whether a delete confirmation is open. */
  readonly hasDeleteTarget: boolean;
  /** Save ids referencing the delete target (the substring-scan guard). */
  readonly deleteReferences: readonly string[];
  /** Whether the delete target is referenced by a save. */
  readonly hasDeleteReferences: boolean;
  /** How many saves reference the delete target. */
  readonly deleteReferenceCount: number;
  /** Whether a reference face is loaded for expression consistency. */
  readonly hasReferenceImage: boolean;
  /** The loaded reference face's file name, or an empty string. */
  readonly referenceImageName: string;
  /** Data URL of the loaded reference face, or an empty string. */
  readonly referenceImagePreviewUrl: string;
  /** The expression pack's per-emotion rows. */
  readonly packRows: readonly StudioPackRow[];
  /** Whether a pack generation is in flight. */
  readonly isGeneratingPack: boolean;
  /** A one-line summary of the last pack run. */
  readonly packMessage: string;
  /** The current draft, as the shared `StudioDraft` shape. */
  readonly draft: StudioDraft;

  initialize(): Promise<void>;
  selectRecipe(recipeId: string): void;
  setPositivePrompt(value: string): void;
  setNegativePrompt(value: string): void;
  setNpcId(value: string): void;
  generate(): Promise<void>;
  cancel(): void;
  save(): Promise<void>;
  refreshLibrary(): Promise<void>;
  beginRename(tag: string): void;
  setRenameValue(value: string): void;
  cancelRename(): void;
  confirmRename(): Promise<void>;
  beginDelete(tag: string): void;
  cancelDelete(): void;
  confirmDelete(options?: { force?: boolean }): Promise<void>;
  setReferenceImageFile(file: File | undefined): Promise<void>;
  clearReferenceImage(): void;
  generatePack(): Promise<void>;
};

export type StudioViewModelOptions = BaseViewModelOptions & {
  capabilities: StudioCapabilities;
};

// ---------------------------------------------------------------------------
// ViewModel
// ---------------------------------------------------------------------------

export class StudioViewModel
  extends BaseViewModel<StudioViewModelOptions>
  implements StudioViewModelInterface
{
  private readonly _capabilities: StudioCapabilities;

  recipes = $state<readonly StudioRecipeOption[]>([]);
  selectedRecipeId = $state<string>('');
  positivePrompt = $state<string>('');
  negativePrompt = $state<string>('');
  npcId = $state<string>('');
  generated = $state<GeneratedAssetOutcome | undefined>(undefined);
  isGenerating = $state<boolean>(false);
  generationStatus = $state<string>('');
  isSaving = $state<boolean>(false);
  saveMessage = $state<string>('');
  errorMessage = $state<string>('');
  isReady = $state<boolean>(false);
  isVisuallyReady = $state<boolean>(false);
  library = $state<readonly LibraryEntry[]>([]);
  isLibraryLoading = $state<boolean>(false);
  renameTarget = $state<LibraryEntry | undefined>(undefined);
  renameValue = $state<string>('');
  deleteTarget = $state<LibraryEntry | undefined>(undefined);
  deleteReferences = $state<readonly string[]>([]);
  referenceImageName = $state<string>('');
  packStatus = $state<Readonly<Record<string, string>>>({});
  isGeneratingPack = $state<boolean>(false);
  packMessage = $state<string>('');
  isPublishing = $state<boolean>(false);
  publishMessage = $state<string>('');

  private readonly _draftId: string;
  private _activeGenerationToken: symbol | undefined;
  private _referenceImageDataUrl = $state<string>('');
  private _referenceImageReadToken: symbol | undefined;

  constructor(options: StudioViewModelOptions) {
    super(options);
    this._capabilities = options.capabilities;
    this._draftId = `studio-draft-${Math.random().toString(36).slice(2, 10)}`;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async initialize(): Promise<void> {
    // Deep-link safety: the registry + runtime engine config must be open
    // before anything reads a recipe's availability or the library.
    try {
      await this._capabilities.ensureReady();
    } catch (error) {
      this.warn('initialize:ensureReady-failed', error);
    }
    this.recipes = await this._capabilities.listRecipeOptions();
    const firstAvailable = this.recipes.find((recipe) => recipe.engineAvailable);
    this.selectedRecipeId = (firstAvailable ?? this.recipes[0])?.recipeId ?? '';
    this.isReady = true;
    await this.refreshLibrary();
    await super.initialize();
    this.isVisuallyReady = true;
  }

  // -----------------------------------------------------------------------
  // Derived state
  // -----------------------------------------------------------------------

  get generationEnabled(): boolean {
    return this._capabilities.isGenerationEnabled();
  }

  get selectedRecipe(): StudioRecipeOption | undefined {
    return this.recipes.find((recipe) => recipe.recipeId === this.selectedRecipeId);
  }

  get publishingEnabled(): boolean {
    return this._capabilities.isPublishingEnabled();
  }

  /** Publishes a library asset; the outcome is always surfaced, never silent. */
  async publishAsset(tag: string): Promise<void> {
    if (this.isPublishing) {
      return;
    }
    this.isPublishing = true;
    this.publishMessage = '';
    this.errorMessage = '';
    try {
      const entry = this.library.find((candidate) => candidate.tag === tag);
      const outcome = await this._capabilities.publish({
        tag,
        title: entry?.tag ?? tag,
      });
      this.publishMessage = describePublishOutcome(outcome);
    } catch (error) {
      this.publishMessage = '';
      this.errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      this.isPublishing = false;
    }
  }

  get isNpcBound(): boolean {
    return this.selectedRecipe?.category === 'portraits';
  }

  get unavailableRecipes(): readonly { label: string; reason: string }[] {
    return this.recipes
      .filter((recipe) => !recipe.engineAvailable && recipe.unavailableReason !== undefined)
      .map((recipe) => ({
        label: recipe.label,
        reason: recipe.unavailableReason as string,
      }));
  }

  get canGenerate(): boolean {
    return this.generateDisabledReason.length === 0;
  }

  get generateDisabledReason(): string {
    if (!this.generationEnabled) {
      return 'Asset generation is disabled (PUBLIC_ASSET_GENERATION is off).';
    }
    const recipe = this.selectedRecipe;
    if (!recipe) {
      return 'Pick an asset type first.';
    }
    // C-521 AC-6: the audio flag disables NEW generation only.
    const audioRefusal = audioGenerationRefusal({
      recipe,
      generationEnabled: this._capabilities.isAudioGenerationEnabled?.() ?? true,
    });
    if (audioRefusal !== undefined) {
      return audioRefusal;
    }
    if (!recipe.engineAvailable) {
      // C-513 AC-12: state the concrete reason the composition resolved, so an
      // unregistered audio engine explains itself instead of going silently
      // grey.
      return (
        recipe.unavailableReason ??
        `No ${recipe.modality} engine is reachable — start the local engine and reload.`
      );
    }
    if (this.positivePrompt.trim().length === 0) {
      return 'Write a prompt before generating.';
    }
    if (this.isNpcBound && this.npcId.trim().length === 0) {
      return 'NPC-bound assets need an NPC id so the game can resolve them.';
    }
    return '';
  }

  get pendingTag(): string {
    return this.generated?.tag ?? '';
  }

  get hasGenerated(): boolean {
    return this.generated !== undefined;
  }

  get previewUrl(): string {
    return this.generated?.previewUrl ?? '';
  }

  get generatedExt(): string {
    return this.generated?.ext ?? '';
  }

  get generatedEngine(): string {
    return this.generated?.engine ?? '';
  }

  get generatedSeedLabel(): string {
    return this.generated?.seed === undefined ? 'engine-chosen' : String(this.generated.seed);
  }

  /** C-521: the recipe's modality decides preview vs audio panel. */
  get isAudioCandidate(): boolean {
    return isAudioRecipe(this.selectedRecipe);
  }

  /** C-521: the decoded-buffer review player (audio modality only). */
  get audioReview(): StudioAudioReview | undefined {
    return this._capabilities.audioReview;
  }

  /** C-521: the review panel's tag/ext/engine summary. */
  get audioCandidateLabel(): string {
    return describeAudioCandidateLabel(this.generated);
  }

  get renameTargetTag(): string {
    return this.renameTarget?.tag ?? '';
  }

  get hasRenameTarget(): boolean {
    return this.renameTarget !== undefined;
  }

  get deleteTargetTag(): string {
    return this.deleteTarget?.tag ?? '';
  }

  get hasDeleteTarget(): boolean {
    return this.deleteTarget !== undefined;
  }

  get hasDeleteReferences(): boolean {
    return this.deleteReferences.length > 0;
  }

  get deleteReferenceCount(): number {
    return this.deleteReferences.length;
  }

  get hasReferenceImage(): boolean {
    return this._referenceImageDataUrl.length > 0;
  }

  get referenceImagePreviewUrl(): string {
    return this._referenceImageDataUrl;
  }

  get packRows(): readonly StudioPackRow[] {
    return buildPackRows({ npcId: this.npcId, packStatus: this.packStatus });
  }

  get draft(): StudioDraft {
    return buildStudioDraft({
      id: this._draftId,
      recipeId: this.selectedRecipeId,
      npcId: this.npcId,
      positivePrompt: this.positivePrompt,
      negativePrompt: this.negativePrompt,
      initImageTag: this.initImageTag,
      generated: this.generated,
      updatedAt: new Date().toISOString(),
    });
  }

  /** Stable label for the loaded reference face — a payload, never a tag. */
  get initImageTag(): string {
    return this.referenceImageName.length > 0 ? `upload:${this.referenceImageName}` : '';
  }

  get libraryRows(): readonly StudioLibraryRow[] {
    return buildLibraryRows({ library: this.library, formatBytes });
  }

  // -----------------------------------------------------------------------
  // Draft actions
  // -----------------------------------------------------------------------

  selectRecipe(recipeId: string): void {
    this.selectedRecipeId = recipeId;
    this.generated = undefined;
    this.saveMessage = '';
    this.errorMessage = '';
    // C-521: a new recipe means a new candidate; release the previous buffer.
    this._capabilities.audioReview?.reset();
  }

  setPositivePrompt(value: string): void {
    this.positivePrompt = value;
  }

  setNegativePrompt(value: string): void {
    this.negativePrompt = value;
  }

  setNpcId(value: string): void {
    this.npcId = value;
  }

  async generate(): Promise<void> {
    if (this.isGenerating || this.isGeneratingPack) {
      return;
    }
    if (!this.canGenerate) {
      this.errorMessage = this.generateDisabledReason;
      return;
    }

    const generationToken = Symbol('studio-generation');
    this._activeGenerationToken = generationToken;
    this.errorMessage = '';
    this.saveMessage = '';
    this.isGenerating = true;
    this.generationStatus = 'Generating…';

    try {
      const outcome = await this._capabilities.generate({
        recipeId: this.selectedRecipeId,
        prompt: this.positivePrompt,
        negativePrompt: this.negativePrompt.length > 0 ? this.negativePrompt : undefined,
        npcId: this.isNpcBound ? this.npcId.trim() : undefined,
        ...(this.hasReferenceImage && this.isNpcBound
          ? { initImage: this._referenceImageDataUrl }
          : {}),
      });
      if (this._activeGenerationToken !== generationToken) {
        return;
      }
      this.generated = outcome;
      this.generationStatus = outcome.isDemo ? 'Complete (demo engine)' : 'Complete';
      if (isAudioRecipe(this.selectedRecipe)) {
        // C-521 AC-4: decode the candidate for the review panel. The service
        // owns the fetch — a ViewModel never touches the object URL.
        await this._capabilities.audioReview?.load({ url: outcome.previewUrl });
      }
    } catch (error) {
      if (this._activeGenerationToken !== generationToken) {
        return;
      }
      this.generated = undefined;
      this.generationStatus = 'Failed';
      this.errorMessage = toMessage(error);
      this.error('generate:failed', error);
    } finally {
      if (this._activeGenerationToken === generationToken) {
        this._activeGenerationToken = undefined;
        this.isGenerating = false;
      }
    }
  }

  cancel(): void {
    this._activeGenerationToken = undefined;
    this._capabilities.cancelGeneration();
    this.isGenerating = false;
    this.generationStatus = '';
  }

  async save(): Promise<void> {
    const tag = this.pendingTag;
    if (tag.length === 0) {
      this.errorMessage = 'Generate an asset before saving.';
      return;
    }

    this.isSaving = true;
    this.errorMessage = '';
    this.saveMessage = '';

    try {
      let outcome = await this._capabilities.save({ tag });
      if (!outcome.registered && outcome.reason === 'not_initialized') {
        // A deep-linked studio can race the registry init. Retry once after
        // opening it rather than reporting a failure the user cannot act on.
        this.debug('save:retry-after-registry-init');
        await this._capabilities.ensureReady();
        outcome = await this._capabilities.save({ tag });
      }
      this.saveMessage = describeSaveOutcome(outcome);
      if (outcome.registered) {
        if (this.generated?.tag === tag) {
          this.generated = undefined;
        }
        await this.refreshLibrary();
      }
    } catch (error) {
      this.errorMessage = toMessage(error);
      this.error('save:failed', error);
    } finally {
      this.isSaving = false;
    }
  }

  async setReferenceImageFile(file: File | undefined): Promise<void> {
    if (!file) {
      return;
    }
    const readToken = Symbol('studio-reference-image-read');
    this._referenceImageReadToken = readToken;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      if (this._referenceImageReadToken !== readToken) {
        return;
      }
      this._referenceImageDataUrl = dataUrl;
      this.referenceImageName = file.name;
      this.errorMessage = '';
    } catch (error) {
      if (this._referenceImageReadToken !== readToken) {
        return;
      }
      this.errorMessage = `Could not read "${file.name}": ${toMessage(error)}`;
    } finally {
      if (this._referenceImageReadToken === readToken) {
        this._referenceImageReadToken = undefined;
      }
    }
  }

  clearReferenceImage(): void {
    this._referenceImageReadToken = undefined;
    this._referenceImageDataUrl = '';
    this.referenceImageName = '';
  }

  /**
   * Generates and registers one asset per pack emotion (AC-3).
   *
   * Each emotion is registered under `expressionAssetTag({ npcId, emotion })`
   * — the tag the runtime resolver looks up — and every generation reuses the
   * loaded reference face so the set stays consistent. A failure on one
   * emotion is recorded on its row and does not abort the pack.
   */
  async generatePack(): Promise<void> {
    if (this.isGenerating || this.isGeneratingPack) {
      return;
    }
    if (!this.isNpcBound) {
      this.errorMessage =
        'Expression packs need an NPC-bound recipe (Character Portrait / NPC Expression).';
      return;
    }
    if (!this.canGenerate) {
      this.errorMessage = this.generateDisabledReason;
      return;
    }

    const npcId = this.npcId.trim();
    const selectedRecipeId = this.selectedRecipeId;
    const positivePrompt = this.positivePrompt;
    const negativePrompt = this.negativePrompt;
    const hasReferenceImage = this.hasReferenceImage;
    const referenceImageDataUrl = this._referenceImageDataUrl;
    this.errorMessage = '';
    this.saveMessage = '';
    this.packMessage = '';
    this.isGeneratingPack = true;
    this.packStatus = Object.fromEntries(
      STUDIO_EXPRESSION_PACK_EMOTIONS.map((emotion) => [emotion.id, 'Pending']),
    );

    let saved = 0;
    try {
      for (const emotion of STUDIO_EXPRESSION_PACK_EMOTIONS) {
        this._setPackStatus(emotion.id, 'Generating…');
        try {
          const outcome = await this._capabilities.generate({
            recipeId: selectedRecipeId,
            prompt: `${positivePrompt}, ${emotion.prompt}`,
            ...(negativePrompt.length > 0 ? { negativePrompt } : {}),
            npcId,
            emotion: emotion.id,
            ...(hasReferenceImage ? { initImage: referenceImageDataUrl } : {}),
          });
          this._setPackStatus(emotion.id, 'Saving…');
          let result = await this._capabilities.save({ tag: outcome.tag });
          if (!result.registered && result.reason === 'not_initialized') {
            this.debug('generatePack:save-retry-after-registry-init', { emotion: emotion.id });
            await this._capabilities.ensureReady();
            result = await this._capabilities.save({ tag: outcome.tag });
          }
          if (result.registered) {
            saved += 1;
            this._setPackStatus(emotion.id, result.unchanged ? 'Saved (unchanged)' : 'Saved');
          } else {
            this._setPackStatus(emotion.id, `Not saved (${result.reason ?? 'unknown'})`);
          }
        } catch (error) {
          this._setPackStatus(emotion.id, 'Failed');
          this.warn('generatePack:emotion-failed', { emotion: emotion.id, error: String(error) });
        }
      }
    } finally {
      this.isGeneratingPack = false;
      this.packMessage = `Pack for "${npcId}": ${saved}/${STUDIO_EXPRESSION_PACK_EMOTIONS.length} emotions saved.`;
      await this.refreshLibrary();
    }
  }

  private _setPackStatus(emotion: string, status: string): void {
    this.packStatus = { ...this.packStatus, [emotion]: status };
  }

  // -----------------------------------------------------------------------
  // Library
  // -----------------------------------------------------------------------

  async refreshLibrary(): Promise<void> {
    this.isLibraryLoading = true;
    try {
      this.library = await this._capabilities.listLibrary();
    } catch (error) {
      this.errorMessage = toMessage(error);
      this.warn('refreshLibrary:failed', error);
    } finally {
      this.isLibraryLoading = false;
    }
  }

  beginRename(tag: string): void {
    const entry = this.library.find((item) => item.tag === tag);
    if (!entry) {
      return;
    }
    this.renameTarget = entry;
    this.renameValue = entry.tag;
    this.deleteTarget = undefined;
    this.deleteReferences = [];
  }

  setRenameValue(value: string): void {
    this.renameValue = value;
  }

  cancelRename(): void {
    this.renameTarget = undefined;
    this.renameValue = '';
  }

  async confirmRename(): Promise<void> {
    const target = this.renameTarget;
    if (!target) {
      return;
    }
    const to = this.renameValue.trim();
    if (to.length === 0 || to === target.tag) {
      this.cancelRename();
      return;
    }

    this.errorMessage = '';
    try {
      await this._capabilities.renameGenerated({ from: target.tag, to });
      this.cancelRename();
      await this.refreshLibrary();
    } catch (error) {
      this.errorMessage = toMessage(error);
      this.error('confirmRename:failed', error);
    }
  }

  beginDelete(tag: string): void {
    const entry = this.library.find((item) => item.tag === tag);
    if (!entry) {
      return;
    }
    this.deleteTarget = entry;
    this.deleteReferences = [];
    this.renameTarget = undefined;
  }

  cancelDelete(): void {
    this.deleteTarget = undefined;
    this.deleteReferences = [];
  }

  async confirmDelete(options: { force?: boolean } = {}): Promise<void> {
    const target = this.deleteTarget;
    if (!target) {
      return;
    }

    this.errorMessage = '';
    try {
      const outcome = await this._capabilities.deleteGenerated({
        tag: target.tag,
        force: options.force,
      });
      if (!outcome.deleted && outcome.reason === 'save_reference') {
        // Keep the dialog open with the references so the user can confirm.
        this.deleteReferences = outcome.references;
        return;
      }
      if (!outcome.deleted) {
        this.errorMessage = describeDeleteRefusal(outcome.reason);
        return;
      }
      this.cancelDelete();
      await this.refreshLibrary();
    } catch (error) {
      this.errorMessage = toMessage(error);
      this.error('confirmDelete:failed', error);
    }
  }
}

/**
 * Testable factory — no production imports. Production wiring lives in
 * ./studio_composition.ts.
 */
export const createStudioViewModel = (options: StudioViewModelOptions): StudioViewModelInterface =>
  StudioViewModel.create(options);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
