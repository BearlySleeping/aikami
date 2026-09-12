// apps/frontend/hub/src/lib/views/map_studio/map_studio_view_model.svelte.ts
//
// Map studio ViewModel. The preview renders through the same unified scene
// loader the game uses; C-507 adds a pure engine `SceneEditor` over a
// validated `SceneDocument` (tools, snapshot undo/redo, native export) whose
// edits feed the SAME preview as an in-memory frames tilemap. No network call
// is a boot dependency — the studio opens with the embedded sample rendering.

import type {
  SceneEditorEditResult,
  SceneEditorInterface,
  SceneEditorSelection,
  TilemapTileset,
} from '@aikami/frontend/engine';
import { BaseViewModel } from '@aikami/frontend/services';
import type { MapPreviewViewModelInterface } from '@aikami/frontend-preview';
import type { AssetResolver, SceneDocument } from '@aikami/types';
import { createCdnAssetResolver } from '$lib/client/services/cdn_asset_resolver.ts';
import type { MapStudioPageData } from '$types';
import {
  cellFromCanvasPoint,
  groundFrames as deriveGroundFrames,
  placementFrames as derivePlacementFrames,
  sceneExtentLabel as deriveSceneExtentLabel,
  terrainIds as deriveTerrainIds,
  type EditorSelection,
  type EditorToolKind,
  hitTestSelection,
  isCellInBounds,
  parseAtlasFrames,
} from './map_editor_utils.ts';
import { MapStudioLibrary } from './map_studio_library.svelte.ts';
import type { MapEditorEngine, PublishedMapOption } from './map_studio_types.ts';
import { SAMPLE_MANIFEST_TEXT } from './sample_manifest.ts';

// Re-exported as explicit aliases (not `export ... from`) because the MVVM
// guard matches the `export type XxxViewModelOptions =` declaration form.
export type HubMapStudioViewModelOptions =
  import('./map_studio_types.ts').HubMapStudioViewModelOptions;
export type HubMapStudioViewModelInterface =
  import('./map_studio_types.ts').HubMapStudioViewModelInterface;
export type { MapEditorEngine, PublishedMapOption };

// ── Types ────────────────────────────────────────────────────────────────

// ── Helpers ──────────────────────────────────────────────────────────────

/** Turn a catalog tag into a short label: `maps:sandbox_combat` → `sandbox combat`. */
const tagToLabel = (tag: string): string => {
  const tail = tag.includes(':') ? tag.slice(tag.indexOf(':') + 1) : tag;
  return tail.replace(/[_-]+/g, ' ');
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// ── ViewModel ────────────────────────────────────────────────────────────

export class HubMapStudioViewModel
  extends BaseViewModel<HubMapStudioViewModelOptions>
  implements HubMapStudioViewModelInterface
{
  canvasElement = $state<HTMLCanvasElement | undefined>(undefined);
  canvasWidth = $state(768);
  canvasHeight = $state(576);
  manifestText = $state<string>(SAMPLE_MANIFEST_TEXT);
  studioError = $state<string | undefined>(undefined);
  editorError = $state<string | undefined>(undefined);
  previewReady = $state(false);
  loadingMapTag = $state<string | undefined>(undefined);
  editing = $state(false);
  tool = $state<EditorToolKind>('select');
  paintFrame = $state('');
  placeFrame = $state('');
  placeComponent = $state('prop');
  transitionTargetMap = $state('');

  /** C-508 drafts + community publishing, composed companion. */
  private readonly _library: MapStudioLibrary;

  /** Preview VM handle — created on canvas attach, never in the server bundle. */
  private _preview = $state<MapPreviewViewModelInterface | undefined>(undefined);
  private _resolver: AssetResolver | undefined;
  private _resolverBuilt = false;
  /** Monotonic token identifying the newest published-map load. */
  private _loadRequestId = 0;

  /** Visual editor state (C-507). */
  private _editor: SceneEditorInterface | undefined;
  /**
   * Reactive revision bumped on every editor-state change. Editor-derived
   * getters read it via `_liveEditor()`, so template reads re-compute after
   * edits, undo/redo and selection — the `_editor` reference alone is not
   * reactive.
   */
  private _editorRevision = $state(0);
  private _engine: MapEditorEngine | undefined;
  private _sourceTilesets: TilemapTileset[] = [];

  private readonly _data: MapStudioPageData;
  private readonly _injectedEngine: MapEditorEngine | undefined;

  constructor(options: HubMapStudioViewModelOptions) {
    super(options);
    this._data = options.data;
    this._injectedEngine = options.editorEngine;
    this._library = new MapStudioLibrary({
      getDocument: () => this.manifestText,
      getMapId: () => this._editor?.document.id,
      loadDocument: (document) => this.setManifestText(document),
      getTerrains: () => this._data.terrains,
      onError: (operation, error) => this.error(operation, error),
      setEditorError: (message) => {
        this.editorError = message;
      },
    });
  }

  get previewError(): string | undefined {
    return this._preview?.errorMessage;
  }

  get publishedMaps(): readonly PublishedMapOption[] {
    const curated = this._data.mapEntries.map((entry) => ({
      tag: entry.tag,
      label: tagToLabel(entry.tag),
    }));
    // Community maps are served by the hub (C-508), not the static catalog,
    // and are addressed with a `community:` prefix so the loader can branch.
    const community = this.communityMaps.map((map) => ({
      tag: `community:${map.slug}`,
      label: `${map.title} · r${map.revision}`,
    }));
    return [...curated, ...community].sort((a, b) => a.label.localeCompare(b.label));
  }

  // ── Drafts/publishing state (C-508, delegated) ───────────────────

  drafts = $derived.by(() => this._library.drafts);
  draftsBusy = $derived.by(() => this._library.draftsBusy);
  draftName = $derived.by(() => this._library.draftName);
  selectedDraftId = $derived.by(() => this._library.selectedDraftId);
  communityMaps = $derived.by(() => this._library.communityMaps);
  publishTitle = $derived.by(() => this._library.publishTitle);
  publishing = $derived.by(() => this._library.publishing);
  publishStatus = $derived.by(() => this._library.publishStatus);

  // ── Editor-derived state (C-507) ─────────────────────────────────

  get editorReady(): boolean {
    return this._liveEditor() !== undefined;
  }

  get selection(): EditorSelection {
    const selection = this._liveEditor()?.selection;
    return selection ? { kind: selection.kind, id: selection.id } : undefined;
  }

  get canUndo(): boolean {
    return this._liveEditor()?.canUndo ?? false;
  }

  get canRedo(): boolean {
    return this._liveEditor()?.canRedo ?? false;
  }

  get dirty(): boolean {
    return this._liveEditor()?.dirty ?? false;
  }

  get exportable(): boolean {
    const editor = this._liveEditor();
    return editor !== undefined && editor.validate().length === 0;
  }

  get sceneExtentLabel(): string {
    const doc = this._liveEditor()?.document;
    return doc ? deriveSceneExtentLabel(doc) : '—';
  }

  get groundFrames(): readonly string[] {
    const doc = this._liveEditor()?.document;
    return doc ? deriveGroundFrames(doc) : [];
  }

  get terrainIds(): readonly string[] {
    const doc = this._liveEditor()?.document;
    return doc ? deriveTerrainIds(doc) : [];
  }

  get placementFrames(): readonly string[] {
    const doc = this._liveEditor()?.document;
    return doc ? derivePlacementFrames(doc) : [];
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  override async initialize(): Promise<void> {
    this.registerEffectRoot(() => {
      // Manifest edits flow into the live preview without a teardown.
      $effect(() => {
        this._preview?.setManifestText(this.manifestText);
      });
      // The View binds the canvas with `bind:this`; mounting happens here so
      // the View itself stays logicless.
      $effect(() => {
        const canvas = this.canvasElement;
        if (canvas) {
          void this._mountPreview(canvas);
        }
      });
    });
    const initialized = await super.initialize();
    // Community listings are public; drafts 401 when signed out (handled).
    void this.refreshCommunityMaps();
    void this.refreshDrafts();
    return initialized;
  }

  override async dispose(): Promise<void> {
    await this._preview?.dispose();
    this._preview = undefined;
    this._editor = undefined;
    this.previewReady = false;
    return await super.dispose();
  }

  // ── Actions ──────────────────────────────────────────────────────

  setManifestText(text: string): void {
    // Supersede any in-flight published-map load: this edit is newer.
    this._loadRequestId++;
    this.manifestText = text;
    this.studioError = undefined;
    this._discardEditor();
  }

  resetToSample(): void {
    this.setManifestText(SAMPLE_MANIFEST_TEXT);
  }

  formatManifest(): void {
    try {
      const parsed: unknown = JSON.parse(this.manifestText);
      this.setManifestText(JSON.stringify(parsed, undefined, 2));
    } catch {
      // Invalid JSON — leave the text untouched so the preview error stands.
    }
  }

  async loadManifestFile(file: File): Promise<void> {
    try {
      this.setManifestText(await file.text());
    } catch (error) {
      this.error('loadManifestFile', error);
      this.studioError = `Could not read "${file.name}".`;
    }
  }

  async loadPublishedMap(tag: string): Promise<void> {
    // Community maps are hub-served documents, not catalog assets (C-508).
    if (tag.startsWith('community:')) {
      const slug = tag.slice('community:'.length);
      this.loadingMapTag = tag;
      try {
        const document = await this._library.getCommunityDocument(slug);
        this.setManifestText(document);
      } catch (error) {
        this.error('loadCommunityMap', error);
        this.studioError = `Failed to load community map "${slug}".`;
      } finally {
        this.loadingMapTag = undefined;
      }
      return;
    }

    this.loadingMapTag = tag;
    // Token identifying THIS request. A fetch that resolves after the user has
    // edited, reset, or picked a different map must not overwrite that newer
    // state, so every write below is gated on the token still being current.
    const requestId = ++this._loadRequestId;
    const isCurrent = (): boolean => this._loadRequestId === requestId;

    try {
      const resolver = await this._ensureResolver();
      if (!isCurrent()) {
        return;
      }
      if (!resolver) {
        this.studioError = 'Catalog is unavailable — cannot load published maps.';
        return;
      }
      const url = resolver.resolve(tag);
      if (!url) {
        this.studioError = `Cannot resolve map "${tag}" in the catalog.`;
        return;
      }
      try {
        const response = await fetch(url);
        if (!isCurrent()) {
          return;
        }
        if (!response.ok) {
          this.studioError = `Failed to fetch "${tag}" (HTTP ${response.status}).`;
          return;
        }
        const text = await response.text();
        if (!isCurrent()) {
          return;
        }
        this.setManifestText(text);
      } finally {
        resolver.release(url);
      }
    } catch (error) {
      if (!isCurrent()) {
        return;
      }
      this.error('loadPublishedMap', error);
      this.studioError = `Failed to load "${tag}".`;
    } finally {
      // Only the current request may clear the spinner — an older one
      // finishing late would hide a newer request's progress.
      if (isCurrent()) {
        this.loadingMapTag = undefined;
      }
    }
  }

  // ── Visual editing (C-507) ───────────────────────────────────────

  async toggleEditing(): Promise<void> {
    if (this._editor) {
      this.editing = !this.editing;
      if (this._preview) {
        this._preview.setShowCollision(this.editing && this.tool.startsWith('collide'));
      }
      return;
    }
    await this._startEditing();
  }

  setTool(tool: EditorToolKind): void {
    this.tool = tool;
    this.editorError = undefined;
    if (this._preview) {
      this._preview.setShowCollision(this.editing && tool.startsWith('collide'));
    }
  }

  setPaintFrame(frame: string): void {
    this.paintFrame = frame;
  }

  setPlaceFrame(frame: string): void {
    this.placeFrame = frame;
  }

  setPlaceComponent(component: string): void {
    this.placeComponent = component;
  }

  setTransitionTargetMap(targetMap: string): void {
    this.transitionTargetMap = targetMap;
  }

  handleCanvasPointer(event: PointerEvent): void {
    const editor = this._editor;
    if (!this.editing || !editor) {
      return;
    }
    const doc = editor.document;
    const tileSize = doc.extent.tileSize;
    const { x, y } = cellFromCanvasPoint(event.offsetX, event.offsetY, tileSize);
    if (!isCellInBounds(doc, x, y)) {
      return;
    }
    event.preventDefault();
    this.editorError = undefined;

    switch (this.tool) {
      case 'select':
        this._handleSelect(editor, x, y, tileSize);
        return;
      case 'paint':
        this._applyResult(editor.paintGround(x, y, this._paintValue(doc)));
        return;
      case 'erase':
        this._applyResult(editor.paintGround(x, y, 0));
        return;
      case 'collide-block':
        this._applyResult(editor.toggleCollision(x, y, true));
        return;
      case 'collide-unblock':
        this._applyResult(editor.toggleCollision(x, y, false));
        return;
      case 'place':
        if (!this.placeFrame) {
          this.editorError = 'Pick a frame to place first.';
          return;
        }
        this._applyResult(
          editor.addPlacement({
            component: this.placeComponent || 'prop',
            frame: this.placeFrame,
            x: x * tileSize,
            y: y * tileSize,
          }),
        );
        return;
      case 'transition':
        if (!this.transitionTargetMap) {
          this.editorError = 'Enter a target map id first.';
          return;
        }
        this._applyResult(
          editor.addTransition({
            x: x * tileSize,
            y: y * tileSize,
            targetMap: this.transitionTargetMap,
          }),
        );
        return;
      case 'delete': {
        const hit = hitTestSelection(doc, x, y);
        if (hit?.kind === 'placement') {
          this._applyResult(editor.removePlacement(hit.id));
        } else if (hit?.kind === 'transition') {
          this._applyResult(editor.removeTransition(hit.id));
        } else {
          this.editorError = 'Nothing to delete here.';
        }
        return;
      }
    }
  }

  undo(): void {
    if (this._editor?.undo()) {
      this.editorError = undefined;
      this._applyEditorToPreview();
    }
  }

  redo(): void {
    if (this._editor?.redo()) {
      this.editorError = undefined;
      this._applyEditorToPreview();
    }
  }

  exportScene(): void {
    const editor = this._editor;
    if (!editor) {
      return;
    }
    try {
      const text = editor.serialize();
      const id = editor.document.id || 'scene';
      this._download(`${id}.scene.json`, text);
      this.editorError = undefined;
    } catch (error) {
      this.error('exportScene', error);
      this.editorError = `Export failed: ${errorMessage(error)}`;
    }
  }

  // ── Drafts + community publishing (C-508, delegated) ─────────────

  setDraftName(name: string): void {
    this._library.setDraftName(name);
  }

  setPublishTitle(title: string): void {
    this._library.setPublishTitle(title);
  }

  refreshDrafts(): Promise<void> {
    return this._library.refreshDrafts();
  }

  refreshCommunityMaps(): Promise<void> {
    return this._library.refreshCommunityMaps();
  }

  saveDraft(): Promise<void> {
    return this._library.saveDraft();
  }

  loadDraft(id: string): Promise<void> {
    return this._library.loadDraft(id);
  }

  deleteDraft(id: string): Promise<void> {
    return this._library.deleteDraft(id);
  }

  publishScene(): Promise<void> {
    return this._library.publishScene();
  }

  // ── Editor internals ─────────────────────────────────────────────

  private async _startEditing(): Promise<void> {
    try {
      const engine = await this._resolveEngine();
      this._sourceTilesets = engine.sceneTilesetsFromManifest(this.manifestText);
      const editor = engine.createSceneEditorFromManifest(this.manifestText, {
        sceneId: 'studio',
        assetLock: 'pack:emberwatch',
        baseTerrain: this._baseTerrain(),
      });
      this._editor = editor;
      this.editing = true;
      this.editorError = undefined;
      this.paintFrame = deriveGroundFrames(editor.document)[0] ?? '';
      this.placeFrame = derivePlacementFrames(editor.document)[0] ?? '';
      this._syncCanvasToScene();
      this._applyEditorToPreview();
      this._preview?.setShowCollision(this.tool.startsWith('collide'));
    } catch (error) {
      this.error('startEditing', error);
      this.editorError = `Could not start editing: ${errorMessage(error)}`;
      this.editing = false;
    }
  }

  /** Injected engine (tests) or the PixiJS-bearing engine, loaded on demand. */
  private async _resolveEngine(): Promise<MapEditorEngine> {
    if (this._engine) {
      return this._engine;
    }
    if (this._injectedEngine) {
      this._engine = this._injectedEngine;
      return this._engine;
    }
    // Dynamic so the engine (and PixiJS) never enters the hub server bundle.
    const mod = await import('@aikami/frontend/engine');
    this._engine = {
      createSceneEditorFromManifest: mod.createSceneEditorFromManifest,
      sceneTilesetsFromManifest: mod.sceneTilesetsFromManifest,
      sceneDocumentToTilemap: mod.sceneDocumentToTilemap,
    };
    return this._engine;
  }

  /** The editor with a reactive dependency on `_editorRevision`. */
  private _liveEditor(): SceneEditorInterface | undefined {
    // The comparison is always false; reading the signal is the point.
    if (this._editorRevision < 0) {
      return undefined;
    }
    return this._editor;
  }

  /** Marks editor-derived state dirty so template getters re-compute. */
  private _bumpEditor(): void {
    this._editorRevision += 1;
  }

  /** Drops the edit session (external manifest replacement). */
  private _discardEditor(): void {
    if (!this._editor && !this.editing) {
      return;
    }
    this._editor = undefined;
    this.editing = false;
    this.editorError = undefined;
    this._bumpEditor();
    this._preview?.setTilemap(undefined);
    this._preview?.setShowCollision(false);
  }

  private _handleSelect(
    editor: SceneEditorInterface,
    x: number,
    y: number,
    tileSize: number,
  ): void {
    const hit = hitTestSelection(editor.document, x, y);
    if (hit) {
      editor.select(hit as SceneEditorSelection);
      this._bumpEditor();
      return;
    }
    const current = editor.selection;
    if (current?.kind === 'placement') {
      // Click an empty cell to move the selected placement there.
      this._applyResult(editor.movePlacement(current.id, x * tileSize, y * tileSize));
    } else {
      editor.select(undefined);
      this._bumpEditor();
    }
  }

  private _paintValue(doc: SceneDocument): string | 0 {
    if (doc.surface.mode === 'terrain') {
      return this.paintFrame || doc.surface.defaultTerrain;
    }
    return this.paintFrame || 0;
  }

  private _applyResult(result: SceneEditorEditResult): void {
    if (!result.ok) {
      this.editorError = result.reason;
      return;
    }
    if (result.changed) {
      this._applyEditorToPreview();
    }
  }

  private _syncCanvasToScene(): void {
    const doc = this._editor?.document;
    if (!doc) {
      return;
    }
    const max = 4096;
    this.canvasWidth = Math.min(doc.extent.width * doc.extent.tileSize, max);
    this.canvasHeight = Math.min(doc.extent.height * doc.extent.tileSize, max);
  }

  /**
   * Reflects the edited document in the live preview. Baked surfaces are
   * handed to the preview as an in-memory frames tilemap (real lock textures
   * preserved); terrain surfaces fall back to native text.
   */
  private _applyEditorToPreview(): void {
    const editor = this._editor;
    const engine = this._engine;
    if (!editor || !engine) {
      return;
    }
    this._bumpEditor();
    const doc = editor.document;
    try {
      // Baked and terrain both compile through the in-memory tilemap path: the
      // tilemap forwards the terrain channel and the preview compiles it with
      // the pack terrains from page data (C-507 gap closed).
      this._preview?.setTilemap(engine.sceneDocumentToTilemap(doc, this._sourceTilesets));
      // Keep the textarea/export view in sync with the edited document.
      this.manifestText = editor.serialize();
    } catch (error) {
      this.editorError = `Could not render edit: ${errorMessage(error)}`;
    }
  }

  private _download(filename: string, text: string): void {
    if (typeof document === 'undefined') {
      return;
    }
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  /**
   * Mounts the preview against the View-bound canvas.
   *
   * Idempotent: the reaction re-runs whenever `canvasElement` changes, and
   * the preview ViewModel is created once and merely re-bound afterwards.
   *
   * `@aikami/frontend-preview` is imported dynamically because it re-exports
   * the PixiJS engine — a static import would pull PixiJS into the hub's
   * Cloudflare Worker server bundle, which `server_bundle_purity.test.ts`
   * forbids.
   */
  private async _mountPreview(canvas: HTMLCanvasElement): Promise<void> {
    try {
      const resolver = await this._ensureResolver();
      if (!resolver) {
        this.studioError = 'Catalog is unavailable — assets cannot be resolved.';
        return;
      }

      if (!this._preview) {
        const { getMapPreviewViewModel } = await import('@aikami/frontend-preview');
        this._preview = getMapPreviewViewModel({
          className: 'HubMapStudioPreview',
          resolver,
          mapTag: 'studio:manifest',
          sceneId: 'studio',
          assetLock: 'pack:emberwatch',
          baseTerrain: this._baseTerrain(),
          terrains: this._data.terrains,
          manifestText: this.manifestText,
          width: canvas.width,
          height: canvas.height,
        });
        await this._preview.initialize();
        await this._loadAtlas();
      }

      this._preview.setCanvasElement(canvas);
      this.previewReady = true;
    } catch (error) {
      this.error('mountPreview', error);
      this.studioError = 'Could not mount the preview.';
    }
  }

  /** The pack's base terrain (lowest-precedence fill), if declared. */
  private _baseTerrain(): string | undefined {
    const terrains = this._data.terrains;
    const fill = terrains.find((terrain) => terrain.wang === 'fill') ?? terrains[0];
    return fill?.name;
  }

  /**
   * Loads the pack's atlas frame map and hands it to the preview so corner16
   * and packed frames sample their real source rects. Best-effort: missing
   * atlas context leaves the preview's grid fallback in place.
   */
  private async _loadAtlas(): Promise<void> {
    const descriptor = this._data.atlas;
    if (!descriptor) {
      return;
    }
    const resolver = await this._ensureResolver();
    if (!resolver) {
      return;
    }
    const imageUrl = resolver.resolve(descriptor.textureUrl) ?? descriptor.textureUrl;
    let frames: Record<string, { x: number; y: number; width: number; height: number }> = {};
    if (descriptor.spritesheetUrl) {
      const sheetUrl = resolver.resolve(descriptor.spritesheetUrl) ?? descriptor.spritesheetUrl;
      try {
        const response = await fetch(sheetUrl);
        if (response.ok) {
          frames = parseAtlasFrames(await response.json());
        }
      } catch (error) {
        this.error('loadAtlas', error);
      }
    }
    this._preview?.setAtlas({ imageUrl, frames });
  }

  /** Build the CDN resolver lazily (client-side only). */
  private async _ensureResolver(): Promise<AssetResolver | undefined> {
    if (this._resolverBuilt) {
      return this._resolver;
    }

    const entries = [...this._data.tilesetEntries, ...this._data.mapEntries];
    if (entries.length === 0 || !this._data.originUrl) {
      return undefined;
    }

    try {
      this._resolver = createCdnAssetResolver({
        originUrl: this._data.originUrl,
        entries,
        // Manifests reference tileset images by game-data path, not tag.
        resolveGameDataPaths: true,
      });
      // Only latch once construction succeeded: a transient failure must stay
      // retryable, otherwise one bad attempt disables the resolver for the
      // lifetime of the page.
      this._resolverBuilt = true;
    } catch (error) {
      this.error('ensureResolverBuilt', error);
      this._resolver = undefined;
      this._resolverBuilt = false;
    }
    return this._resolver;
  }
}

// ── Factory ──────────────────────────────────────────────────────────────

/**
 * Get or create the map studio ViewModel for this page.
 *
 * @param options - Page data plus the standard BaseViewModel options.
 * @returns The shared ViewModel instance.
 */
export const getHubMapStudioViewModel = (
  options: HubMapStudioViewModelOptions,
): HubMapStudioViewModelInterface => HubMapStudioViewModel.create(options);
