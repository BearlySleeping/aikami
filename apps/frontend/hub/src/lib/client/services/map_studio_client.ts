// apps/frontend/hub/src/lib/client/services/map_studio_client.ts
//
// C-508 — Client for the hub's map-studio drafts + community publishing
// endpoints. Mirrors the backup_client factory pattern: same-origin fetch
// wrappers with `credentials: 'include'` and consistent error handling.

import type {
  CommunityMapSummary,
  MapDraft,
  MapDraftSummary,
  PublishCommunityMapResult,
} from '@aikami/schemas';
import { toAppError } from '@aikami/utils';

/** A published community map plus its native scene document. */
export type CommunityMapDocument = CommunityMapSummary & { document: string };

/** Input for creating or updating a draft. */
export type DraftUpsert = { name?: string; document?: string };

/** Optional pack context forwarded to the server's `validatePack` gate. */
export type PublishPackContext = {
  manifest: unknown;
  atlasFrames?: string[];
  mapFiles?: Record<string, string>;
  mapId?: string;
};

/** Input for publishing a community map. */
export type PublishMapInput = {
  title: string;
  document: string;
  slug?: string;
  packContext?: PublishPackContext;
};

export type MapStudioClientInterface = {
  listDrafts(): Promise<MapDraftSummary[]>;
  createDraft(input: Required<DraftUpsert>): Promise<MapDraft>;
  getDraft(id: string): Promise<MapDraft>;
  updateDraft(id: string, input: DraftUpsert): Promise<MapDraft>;
  deleteDraft(id: string): Promise<void>;
  publish(input: PublishMapInput): Promise<PublishCommunityMapResult>;
  listCommunityMaps(): Promise<CommunityMapSummary[]>;
  getCommunityMap(slug: string): Promise<CommunityMapDocument>;
};

const toAppErrorFromResponse = async (response: Response): Promise<Error> => {
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
    issues?: unknown;
  };
  return toAppError({
    errorType: 'internal',
    errorMessage:
      body.message ?? body.error ?? `Map studio request failed (HTTP ${response.status})`,
  });
};

/**
 * Map-studio client backed by the hub's session-gated draft endpoints and the
 * public community-map namespace.
 *
 * @param hubBase The `/api` base (same origin, e.g. '' or window.location.origin).
 */
export const createMapStudioClient = (hubBase: string): MapStudioClientInterface => {
  const json = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${hubBase}${path}`, { credentials: 'include', ...init });
    if (!response.ok) {
      throw await toAppErrorFromResponse(response);
    }
    return (await response.json()) as T;
  };

  const send = async <T>(path: string, method: string, body: unknown): Promise<T> =>
    json<T>(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  return {
    listDrafts: () => json<MapDraftSummary[]>('/maps/drafts'),
    createDraft: (input) => send<MapDraft>('/maps/drafts', 'POST', input),
    getDraft: (id) => json<MapDraft>(`/maps/drafts/${encodeURIComponent(id)}`),
    updateDraft: (id, input) =>
      send<MapDraft>(`/maps/drafts/${encodeURIComponent(id)}`, 'PUT', input),
    deleteDraft: async (id) => {
      await json<unknown>(`/maps/drafts/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    publish: (input) => send<PublishCommunityMapResult>('/maps/community', 'POST', input),
    listCommunityMaps: () => json<CommunityMapSummary[]>('/maps/community'),
    getCommunityMap: (slug) =>
      json<CommunityMapDocument>(`/maps/community/${encodeURIComponent(slug)}`),
  };
};
