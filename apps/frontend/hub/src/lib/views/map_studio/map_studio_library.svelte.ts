// apps/frontend/hub/src/lib/views/map_studio/map_studio_library.svelte.ts
//
// C-508 — Drafts + community-publishing companion to the map studio VM.
//
// Extracted from `map_studio_view_model.svelte.ts` to keep both modules inside
// the source-size budget. This owns the owner-scoped draft list, the public
// community list, and the publish flow; the studio VM composes it and supplies
// accessors back into the editor/manifest so the document authority stays in
// one place.

import type { CommunityMapSummary, ContentPackTerrain, MapDraftSummary } from '@aikami/schemas';
import {
  createMapStudioClient,
  type MapStudioClientInterface,
} from '$lib/client/services/map_studio_client.ts';

/** Accessors and sinks the library needs from the host studio VM. */
export type MapStudioLibraryDeps = {
  /** Current native scene document text. */
  getDocument: () => string;
  /** Current scene id (used by the synthesized pack context). */
  getMapId: () => string | undefined;
  /** Replace the studio manifest with a loaded document. */
  loadDocument: (document: string) => void;
  /** Pack terrain definitions available to the studio. */
  getTerrains: () => readonly ContentPackTerrain[];
  /** Error sink (operation name + thrown error). */
  onError: (operation: string, error: unknown) => void;
  /** Editor error sink (human-readable message, or undefined to clear). */
  setEditorError: (message: string | undefined) => void;
  /** Injected client for tests. */
  client?: MapStudioClientInterface;
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export class MapStudioLibrary {
  drafts = $state<readonly MapDraftSummary[]>([]);
  draftsBusy = $state(false);
  draftName = $state('');
  selectedDraftId = $state<string | undefined>(undefined);
  communityMaps = $state<readonly CommunityMapSummary[]>([]);
  publishTitle = $state('');
  publishing = $state(false);
  publishStatus = $state<string | undefined>(undefined);

  private readonly _deps: MapStudioLibraryDeps;
  private _client: MapStudioClientInterface | undefined;

  constructor(deps: MapStudioLibraryDeps) {
    this._deps = deps;
  }

  setDraftName(name: string): void {
    this.draftName = name;
  }

  setPublishTitle(title: string): void {
    this.publishTitle = title;
  }

  async refreshDrafts(): Promise<void> {
    this.draftsBusy = true;
    try {
      this.drafts = await this._ensureClient().listDrafts();
    } catch (error) {
      // Drafts require a session; a signed-out visitor simply has none.
      this.drafts = [];
      this._deps.onError('refreshDrafts', error);
    } finally {
      this.draftsBusy = false;
    }
  }

  async refreshCommunityMaps(): Promise<void> {
    try {
      this.communityMaps = await this._ensureClient().listCommunityMaps();
    } catch (error) {
      this.communityMaps = [];
      this._deps.onError('refreshCommunityMaps', error);
    }
  }

  /** Fetches one community map's native scene document text. */
  async getCommunityDocument(slug: string): Promise<string> {
    const doc = await this._ensureClient().getCommunityMap(slug);
    return doc.document;
  }

  async saveDraft(): Promise<void> {
    const name = this.draftName.trim();
    if (!name) {
      this._deps.setEditorError('Enter a draft name first.');
      return;
    }
    this.draftsBusy = true;
    try {
      const client = this._ensureClient();
      if (this.selectedDraftId) {
        await client.updateDraft(this.selectedDraftId, {
          name,
          document: this._deps.getDocument(),
        });
      } else {
        const created = await client.createDraft({ name, document: this._deps.getDocument() });
        this.selectedDraftId = created.id;
      }
      await this.refreshDrafts();
      this._deps.setEditorError(undefined);
      this.publishStatus = `Saved draft "${name}".`;
    } catch (error) {
      this._deps.onError('saveDraft', error);
      this._deps.setEditorError(`Could not save draft: ${errorMessage(error)}`);
    } finally {
      this.draftsBusy = false;
    }
  }

  async loadDraft(id: string): Promise<void> {
    this.draftsBusy = true;
    try {
      const draft = await this._ensureClient().getDraft(id);
      this.selectedDraftId = id;
      this.draftName = draft.name;
      this._deps.loadDocument(draft.document);
    } catch (error) {
      this._deps.onError('loadDraft', error);
      this._deps.setEditorError(`Could not load draft: ${errorMessage(error)}`);
    } finally {
      this.draftsBusy = false;
    }
  }

  async deleteDraft(id: string): Promise<void> {
    this.draftsBusy = true;
    try {
      await this._ensureClient().deleteDraft(id);
      if (this.selectedDraftId === id) {
        this.selectedDraftId = undefined;
      }
      await this.refreshDrafts();
    } catch (error) {
      this._deps.onError('deleteDraft', error);
      this._deps.setEditorError(`Could not delete draft: ${errorMessage(error)}`);
    } finally {
      this.draftsBusy = false;
    }
  }

  async publishScene(): Promise<void> {
    const title = this.publishTitle.trim();
    if (!title) {
      this._deps.setEditorError('Enter a title to publish.');
      return;
    }
    this.publishing = true;
    this.publishStatus = undefined;
    try {
      const result = await this._ensureClient().publish({
        title,
        document: this._deps.getDocument(),
        packContext: this._packContext(),
      });
      this._deps.setEditorError(undefined);
      this.publishStatus = `Published "${title}" (revision ${result.revision}).`;
      await this.refreshCommunityMaps();
    } catch (error) {
      this._deps.onError('publishScene', error);
      this._deps.setEditorError(`Publish failed: ${errorMessage(error)}`);
    } finally {
      this.publishing = false;
    }
  }

  /**
   * Source-pack context for the server's `validatePack` gate. Built from the
   * pack terrain definitions the page loaded; omitted when none are available
   * (the document gate still runs). No atlas is included because the studio
   * does not carry the pack's atlas provenance, and a false provenance claim
   * would be worse than skipping the frame-existence check.
   */
  private _packContext():
    | { manifest: unknown; mapFiles: Record<string, string>; mapId: string }
    | undefined {
    const terrains = this._deps.getTerrains();
    if (terrains.length === 0) {
      return undefined;
    }
    const mapId = this._deps.getMapId() ?? 'community-map';
    const file = `${mapId}.scene.json`;
    return {
      manifest: {
        id: 'community',
        name: 'Community Map',
        version: '1.0.0',
        updatedAt: new Date().toISOString(),
        startingMapId: mapId,
        maps: { [mapId]: { file, name: mapId } },
        npcs: {},
        items: {},
        dialogues: {},
        terrains,
      },
      mapFiles: { [mapId]: file },
      mapId,
    };
  }

  private _ensureClient(): MapStudioClientInterface {
    if (!this._client) {
      this._client = this._deps.client ?? createMapStudioClient('/api');
    }
    return this._client;
  }
}
