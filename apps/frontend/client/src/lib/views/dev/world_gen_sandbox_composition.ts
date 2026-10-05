// apps/frontend/client/src/lib/views/dev/world_gen_sandbox_composition.ts
//
// Dev sandbox wiring for world generation.
//
// The sandbox supplies a DETERMINISTIC mock text capability instead of the
// production provider, and an in-memory draft store instead of the device
// database. Both are real collaborators driven through the same interfaces the
// production path uses, so the sandbox exercises the actual orchestration —
// cancellation, checkpoints, retries, run identity — rather than a stub of it.
//
// The mock still honours the AbortSignal it is handed: a sandbox that ignored
// the signal would hide exactly the bug the sandbox exists to surface.

import type { WorldGenDraft } from '@aikami/schemas';
import { routerService } from '$services';
import type {
  WorldGenDraftStore,
  WorldGenDraftTextCapabilities,
} from '../../services/worldgen/types/world_gen_draft_service.types.ts';
import {
  createWorldGenDraftService,
  type WorldGenDraftServiceInterface,
} from '../../services/worldgen/world_gen_draft_service.svelte.ts';
import type {
  WorldGenSandboxViewModelInterface,
  WorldGenSandboxViewModelOptions,
} from './world_gen_sandbox_view_model.svelte.ts';
import { createWorldGenSandboxViewModel } from './world_gen_sandbox_view_model.svelte.ts';

/** Sandbox options with the wired capabilities removed. */
export type WorldGenSandboxPublicOptions = Omit<
  WorldGenSandboxViewModelOptions,
  'router' | 'drafts'
> & {
  /** Query parameters driving the mock provider (see below). */
  searchParams?: { get(name: string): string | null };
};

const MOCK_STAGE_BY_SCHEMA_NAME = (schemaName: string): string =>
  schemaName.replace('WorldGenDraft_', '');

/** Deterministic per-stage payloads for the sandbox. */
const mockStagePayload = (stage: string, worldName: string): unknown => {
  switch (stage) {
    case 'setting':
      return {
        worldName,
        worldDescription:
          'A lantern-lit frontier town in a permanent twilight valley, where the ember-crowned mountains swallow the sun by midday.',
        themes: ['frontier', 'twilight'],
      };
    case 'cast':
      return {
        npcs: [
          {
            name: 'Maren',
            race: 'Human',
            class: 'Innkeeper',
            role: 'Quest Giver',
            description: 'A weathered innkeeper with a knowing smile.',
            personality: 'Hospitable but sharp-tongued.',
          },
          {
            name: 'Thorn',
            race: 'Elf',
            class: 'Ranger',
            role: 'Ally',
            description: 'A quiet ranger whose cloak is stitched with silverleaf.',
            personality: 'Speaks in short sentences.',
          },
        ],
      };
    case 'places':
      return {
        places: [
          { name: 'The Ember Market', description: 'Stalls of ember-baked bread.' },
          { name: 'Ashfall Bridge', description: 'A bridge of cooled volcanic glass.' },
        ],
      };
    case 'hudWidgets':
      return {
        hudWidgets: [
          { slot: 'top-left', label: 'Ember Compass', icon: 'compass', defaultVisibility: true },
        ],
      };
    case 'arcs':
      return {
        arcs: [
          {
            chapter: 'Chapter 1: The Fading Ward',
            description: 'Maren tasks the party with rekindling the wardstone.',
            objectives: ['Find the wardstone', 'Return to Maren'],
            questGiverNames: ['Maren'],
          },
        ],
      };
    default:
      return {};
  }
};

/** Deterministic mock provider honouring signal, deadline and delay. */
export const createSandboxTextCapability = (controls: {
  failAll: () => boolean;
  delayFor: (stage: string) => number;
  recordPrompt: (prompt: string) => void;
  worldName: () => string;
}): WorldGenDraftTextCapabilities => ({
  extractStructure: async (options) => {
    controls.recordPrompt(options.prompt);
    const stage = MOCK_STAGE_BY_SCHEMA_NAME(options.schemaName);
    const delay = controls.delayFor(stage);

    if (delay > 0) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, delay);
        options.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    }
    if (options.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    if (controls.failAll()) {
      throw new Error('Simulated provider failure');
    }
    return mockStagePayload(stage, controls.worldName());
  },
});

/** In-memory draft store — same interface, no device database. */
const createSandboxStore = (): WorldGenDraftStore & { rows: Map<string, WorldGenDraft> } => {
  const rows = new Map<string, WorldGenDraft>();
  return {
    rows,
    upsert: async (draft) => {
      rows.set(draft.draftId, draft);
    },
    get: async (draftId) => rows.get(draftId),
    latest: async (limit = 10) =>
      [...rows.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit),
  };
};

/** Builds the sandbox draft service around a mock provider. */
export const getSandboxDraftService = (
  controls: Parameters<typeof createSandboxTextCapability>[0],
  store: ReturnType<typeof createSandboxStore>,
): WorldGenDraftServiceInterface =>
  createWorldGenDraftService({
    className: 'WorldGenSandboxDraftService',
    text: createSandboxTextCapability(controls),
    resolveStore: async () => store,
  });

/**
 * Builds the dev sandbox wizard ViewModel.
 *
 * `searchParams` lets an E2E run drive the mock provider deterministically —
 * `wgDelay` (ms per stage), `wgDelayStage` (one stage) and `wgFail=1` (make
 * every stage fail). Without a controllable provider a browser test can only
 * race the happy path; with it, cancellation and navigation-away have a real
 * window to be observed.
 */
export const getWorldGenSandboxViewModel = (
  options: WorldGenSandboxPublicOptions,
): WorldGenSandboxViewModelInterface => {
  const store = createSandboxStore();
  const search = options.searchParams;
  const globalDelay = clampDelay(search?.get('wgDelay'));
  const focusedStage = search?.get('wgDelayStage');
  const focusedDelay = clampDelay(search?.get('wgDelay'));
  const shouldFail = search?.get('wgFail') === '1';

  // The controls read back off the VM, which only exists after construction;
  // they are resolved lazily through a holder the VM fills in below.
  const controls = {
    failAll: () => shouldFail || (holder.viewModel?.sandboxFailure ?? false),
    delayFor: (stage: string) => {
      if (focusedStage !== null && focusedStage !== undefined && stage === focusedStage) {
        return focusedDelay;
      }
      return globalDelay > 0 ? globalDelay : (holder.viewModel?.sandboxDelayFor(stage) ?? 0);
    },
    recordPrompt: (prompt: string) => holder.viewModel?.sandboxRecordPrompt(prompt),
    worldName: () => holder.viewModel?.draft?.setting?.worldName ?? 'Duskhollow',
  };
  const holder: { viewModel?: WorldGenSandboxViewModelInterface } = {};

  const viewModel = createWorldGenSandboxViewModel({
    ...options,
    router: routerService,
    drafts: getSandboxDraftService(controls, store),
  });
  holder.viewModel = viewModel;
  return viewModel;
};

/** Clamps a query-supplied delay into a sane, non-negative integer. */
const clampDelay = (raw: string | null | undefined): number => {
  if (raw === null || raw === undefined) {
    return 0;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.min(parsed, 10_000);
};
