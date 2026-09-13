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

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type { LibraryEntry, StudioRecipeOption } from '@aikami/types';
import type { GeneratedAssetOutcome, GeneratedAssetSaveOutcome } from '$types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A library row prepared for rendering — no formatting in the view. */
export type StudioLibraryRow = {
  tag: string;
  category: string;
  provenanceLabel: string;
  sizeLabel: string;
  ext: string;
  createdAtLabel: string;
};

/** A library mutation that may be refused (seed tag, save reference). */
export type StudioMutationOutcome = {
  deleted?: boolean;
  reason?: string;
  references: readonly string[];
};

/** The generation and library operations the studio consumes. */
export type StudioCapabilities = {
  /**
   * Recipe options with per-modality engine availability.
   *
   * Async because availability comes from an engine probe, not a constant.
   */
  listRecipeOptions(): Promise<readonly StudioRecipeOption[]>;
  /** Generates bytes for a recipe + prompt; nothing is persisted yet. */
  generate(options: {
    recipeId: string;
    prompt: string;
    negativePrompt?: string;
    npcId?: string;
    emotion?: string;
  }): Promise<GeneratedAssetOutcome>;
  /** Persists the last generated result for `tag`. */
  save(options: { tag: string }): Promise<GeneratedAssetSaveOutcome>;
  /** Aborts the in-flight generation, if any. */
  cancelGeneration(): void;
  /** Locally generated assets, newest first. */
  listLibrary(): Promise<LibraryEntry[]>;
  renameGenerated(options: { from: string; to: string }): Promise<LibraryEntry>;
  deleteGenerated(options: { tag: string; force?: boolean }): Promise<StudioMutationOutcome>;
  /** `PUBLIC_ASSET_GENERATION` — false makes every save a no-op. */
  isGenerationEnabled(): boolean;
};

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
  /** Whether the kill switch is on. */
  readonly generationEnabled: boolean;
  /** Whether the selected recipe can generate right now. */
  readonly canGenerate: boolean;
  /** Why generation is disabled, or an empty string when it is not. */
  readonly generateDisabledReason: string;
  /** Whether the selected recipe is NPC-bound (portrait family). */
  readonly isNpcBound: boolean;
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
  library = $state<readonly LibraryEntry[]>([]);
  isLibraryLoading = $state<boolean>(false);
  renameTarget = $state<LibraryEntry | undefined>(undefined);
  renameValue = $state<string>('');
  deleteTarget = $state<LibraryEntry | undefined>(undefined);
  deleteReferences = $state<readonly string[]>([]);

  constructor(options: StudioViewModelOptions) {
    super(options);
    this._capabilities = options.capabilities;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async initialize(): Promise<void> {
    this.recipes = await this._capabilities.listRecipeOptions();
    const firstAvailable = this.recipes.find((recipe) => recipe.engineAvailable);
    this.selectedRecipeId = (firstAvailable ?? this.recipes[0])?.recipeId ?? '';
    this.isReady = true;
    await this.refreshLibrary();
    await super.initialize();
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

  get isNpcBound(): boolean {
    return this.selectedRecipe?.category === 'portraits';
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
    if (!recipe.engineAvailable) {
      return `No ${recipe.modality} engine is reachable — start the local engine and reload.`;
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

  get libraryRows(): readonly StudioLibraryRow[] {
    return this.library.map((entry) => ({
      tag: entry.tag,
      category: entry.category,
      provenanceLabel: entry.provenance.source,
      sizeLabel: formatBytes(entry.sizeBytes),
      ext: entry.ext,
      createdAtLabel: entry.createdAt.length > 0 ? entry.createdAt : 'unknown',
    }));
  }

  // -----------------------------------------------------------------------
  // Draft actions
  // -----------------------------------------------------------------------

  selectRecipe(recipeId: string): void {
    this.selectedRecipeId = recipeId;
    this.generated = undefined;
    this.saveMessage = '';
    this.errorMessage = '';
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
    if (!this.canGenerate) {
      this.errorMessage = this.generateDisabledReason;
      return;
    }

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
      });
      this.generated = outcome;
      this.generationStatus = outcome.isDemo ? 'Complete (demo engine)' : 'Complete';
    } catch (error) {
      this.generated = undefined;
      this.generationStatus = 'Failed';
      this.errorMessage = toMessage(error);
      this.error('generate:failed', error);
    } finally {
      this.isGenerating = false;
    }
  }

  cancel(): void {
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
      const outcome = await this._capabilities.save({ tag });
      this.saveMessage = describeSave(outcome);
      if (outcome.registered) {
        this.generated = undefined;
        await this.refreshLibrary();
      }
    } catch (error) {
      this.errorMessage = toMessage(error);
      this.error('save:failed', error);
    } finally {
      this.isSaving = false;
    }
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

const toMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Human-readable byte size — the library shows provenance and size per entry. */
const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

/** A user-facing description of a save outcome — never a false success. */
const describeSave = (outcome: GeneratedAssetSaveOutcome): string => {
  if (outcome.registered) {
    if (outcome.unchanged) {
      return `Saved "${outcome.tag}" — identical bytes were already stored (version ${outcome.version ?? 1}).`;
    }
    return `Saved "${outcome.tag}" as version ${outcome.version ?? 1}.`;
  }
  if (outcome.reason === 'generation_disabled') {
    return 'Not saved: asset generation is disabled (PUBLIC_ASSET_GENERATION is off).';
  }
  if (outcome.reason === 'not_initialized') {
    return 'Not saved: the asset registry is still starting up — try again in a moment.';
  }
  return `Not saved${outcome.reason ? `: ${outcome.reason}` : ''}.`;
};

const describeDeleteRefusal = (reason: string | undefined): string => {
  if (reason === 'seed_tag') {
    return 'That asset belongs to the catalog and cannot be deleted here.';
  }
  if (reason === 'not_found') {
    return 'That asset is already gone.';
  }
  return `Delete failed${reason ? `: ${reason}` : ''}.`;
};
