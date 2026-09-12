// apps/frontend/hub/src/lib/views/map_studio/map_studio_types.ts
//
// C-507/C-508 — The map studio ViewModel's public type surface, extracted so
// the ViewModel stays within the source-size budget. No runtime code lives
// here; the View and tests import these through the ViewModel module.

import type { SceneEditorInterface, TilemapData, TilemapTileset } from '@aikami/frontend/engine';
import type { BaseViewModelInterface, BaseViewModelOptions } from '@aikami/frontend/services';
import type { CommunityMapSummary, MapDraftSummary } from '@aikami/schemas';
import type { SceneDocument } from '@aikami/types';
import type { MapStudioPageData } from '$types';
import type { EditorSelection, EditorToolKind } from './map_editor_utils.ts';

/** A published map offered as an editable starting point. */
export type PublishedMapOption = {
  /** Catalog tag, e.g. `maps:sandbox_combat`. */
  readonly tag: string;
  /** Human-readable label for the picker. */
  readonly label: string;
};

/**
 * The engine capabilities the editor needs. Production resolves them with a
 * dynamic import; tests inject a double so no PixiJS/Svelte runtime loads.
 */
export type MapEditorEngine = {
  createSceneEditorFromManifest(
    text: string,
    options?: { sceneId?: string; assetLock?: string; baseTerrain?: string },
  ): SceneEditorInterface;
  sceneTilesetsFromManifest(text: string): TilemapTileset[];
  sceneDocumentToTilemap(doc: SceneDocument, tilesets: readonly TilemapTileset[]): TilemapData;
};

export type HubMapStudioViewModelOptions = BaseViewModelOptions & {
  data: MapStudioPageData;
  /** Test-only engine injection; production dynamically imports the engine. */
  editorEngine?: MapEditorEngine;
};

export type HubMapStudioViewModelInterface = BaseViewModelInterface & {
  /**
   * The preview canvas, bound by the View with `bind:this`. The ViewModel
   * reacts to it internally (see `initialize`), so the View stays logicless —
   * no `$effect` and no `onMount`, per the MVVM conventions.
   */
  canvasElement: HTMLCanvasElement | undefined;
  /** Canvas backing-store dimensions (grow to the scene while editing). */
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  /** Current manifest text (always defined — starts as the sample). */
  readonly manifestText: string;
  /** Scene-load failure reported by the preview, if any. */
  readonly previewError: string | undefined;
  /** Studio-level failure (resolver, fetch, file read). */
  readonly studioError: string | undefined;
  /** Editor-level failure (invalid edit, export). */
  readonly editorError: string | undefined;
  /** True once the preview canvas has mounted and initialized. */
  readonly previewReady: boolean;
  /** Published maps available as starting points. */
  readonly publishedMaps: readonly PublishedMapOption[];
  /** Tag currently being fetched, if any. */
  readonly loadingMapTag: string | undefined;

  /** Whether visual editing is active. */
  readonly editing: boolean;
  /** True once an editor document has been created. */
  readonly editorReady: boolean;
  /** Active tool. */
  readonly tool: EditorToolKind;
  /** Selected placement/transition (stable id), if any. */
  readonly selection: EditorSelection;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly dirty: boolean;
  readonly exportable: boolean;
  readonly sceneExtentLabel: string;
  readonly groundFrames: readonly string[];
  readonly terrainIds: readonly string[];
  readonly placementFrames: readonly string[];
  readonly paintFrame: string;
  readonly placeFrame: string;
  readonly placeComponent: string;
  readonly transitionTargetMap: string;

  /** Per-user drafts (C-508). Empty until refreshed / when signed out. */
  readonly drafts: readonly MapDraftSummary[];
  readonly draftsBusy: boolean;
  readonly draftName: string;
  readonly selectedDraftId: string | undefined;
  /** Published community maps served by the hub (C-508). */
  readonly communityMaps: readonly CommunityMapSummary[];
  readonly publishTitle: string;
  readonly publishing: boolean;
  readonly publishStatus: string | undefined;

  /** Replace the manifest text (re-renders through the live preview). */
  setManifestText(text: string): void;
  /** Restore the embedded sample manifest. */
  resetToSample(): void;
  /** Load a manifest from a local file. */
  loadManifestFile(file: File): Promise<void>;
  /** Fetch a published map from the catalog and load it as text. */
  loadPublishedMap(tag: string): Promise<void>;
  /** Format the current manifest as pretty JSON (no-op when invalid). */
  formatManifest(): void;

  /** Enter (or leave) visual edit mode. */
  toggleEditing(): Promise<void>;
  setTool(tool: EditorToolKind): void;
  setPaintFrame(frame: string): void;
  setPlaceFrame(frame: string): void;
  setPlaceComponent(component: string): void;
  setTransitionTargetMap(targetMap: string): void;
  /** Applies the active tool at a canvas pointer position. */
  handleCanvasPointer(event: PointerEvent): void;
  /** Moves the active cell with arrows and applies the tool with Enter/Space. */
  handleCanvasKeydown(event: KeyboardEvent): void;
  undo(): void;
  redo(): void;
  /** Downloads the edited scene as native `aikami.scene` JSON. */
  exportScene(): void;

  /** Set the draft name used by `saveDraft`. */
  setDraftName(name: string): void;
  /** Reload the signed-in user's drafts (no-op when signed out). */
  refreshDrafts(): Promise<void>;
  /** Save the current manifest as a new draft, or update the selected one. */
  saveDraft(): Promise<void>;
  /** Load a saved draft into the studio. */
  loadDraft(id: string): Promise<void>;
  /** Delete a saved draft. */
  deleteDraft(id: string): Promise<void>;
  /** Set the community-publish title. */
  setPublishTitle(title: string): void;
  /** Validate + publish the current manifest to the community namespace. */
  publishScene(): Promise<void>;
};
