// apps/frontend/client/src/lib/views/dev/combat/combat_debug_composition.ts
//
// Production wiring for the combat debug workspace. This is the only module in
// the feature that touches the real engine boot, the asset registry and the
// client roster builder; the ViewModel receives them as typed capabilities so
// unit tests never boot PixiJS or a worker.
//
// The live session is isolated: one GameWorld + worker + bridge per workspace,
// disposed with the ViewModel. It never touches the user's campaign, autosave,
// party preferences or normal game session.
//
// Contract: combat debug workspace (execution prompt §1, §2)

import { loadContentPack } from '@aikami/frontend/engine/sim';
import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import { assetTagResolver } from '$lib/services/assets/registry_resolver';
import { buildEncounterRosterFromContentPack } from '$lib/services/game/combat_encounter_roster.ts';
import { getCombatViewModel } from '$views/combat/combat_composition.ts';
import {
  type CombatDebugViewModelInterface,
  createCombatDebugViewModel,
} from './combat_debug_view_model.svelte.ts';
import { CombatDebugLiveSession } from './session/combat_debug_live_session.ts';
import type { CombatDebugSession } from './session/combat_debug_session_contract.ts';
import type { CombatDebugScenarioDefinition } from './types/combat_debug_types.ts';

/** The content pack the authored scenarios require. */
const DEBUG_CONTENT_PACK_ID = 'emberwatch';

/**
 * Builds the workspace ViewModel wired to the production engine, asset registry
 * and content-pack loader. The live session is ephemeral — no campaign or save
 * state is read or written.
 */
export const getCombatDebugViewModel = (
  options: BaseViewModelOptions,
): CombatDebugViewModelInterface =>
  createCombatDebugViewModel({
    ...options,
    readUrlSearch: () => (typeof window === 'undefined' ? '' : window.location.search),
    replaceUrl: (query: string) => {
      if (typeof window === 'undefined') {
        return;
      }
      const next = `${window.location.pathname}${query ? `?${query}` : ''}`;
      window.history.replaceState(window.history.state, '', next);
    },
    readCurrentUrl: () => (typeof window === 'undefined' ? '' : window.location.href),
    writeClipboard: async (text: string) => {
      if (typeof navigator === 'undefined' || navigator.clipboard === undefined) {
        throw new Error('Clipboard is unavailable.');
      }
      await navigator.clipboard.writeText(text);
    },
    announce: (message: string) => {
      if (typeof document === 'undefined') {
        return;
      }
      // A single polite live region owned by the workspace view; limited to
      // meaningful turn/decision changes so a trace stream cannot overwhelm a
      // screen reader.
      const region = document.getElementById('combat-debug-announcer');
      if (region) {
        region.textContent = message;
      }
    },
    createProductionCombatViewModel: (bridge) =>
      getCombatViewModel({ className: 'CombatDebugProductionCombatViewModel' }, () =>
        Promise.resolve(bridge),
      ),
    createLiveSession: (sessionOptions): CombatDebugSession =>
      new CombatDebugLiveSession({
        canvas: sessionOptions.canvas,
        scenario: sessionOptions.scenario,
        seed: sessionOptions.seed,
        observer: sessionOptions.observer,
        capabilities: {
          resolveTag: (url) => assetTagResolver(url),
          releaseUrl: () => {},
          startSyntheticEncounter: (startOptions) => {
            startOptions.send({
              type: 'COMBAT_START_ENCOUNTER',
              encounterId: startOptions.encounterId,
              seed: startOptions.seed,
              engine: 'v2',
              llmAgentsEnabled: false,
              roster: startOptions.roster,
            });
            return true;
          },
          loadContentPack: () =>
            loadContentPack({
              packId: DEBUG_CONTENT_PACK_ID,
              resolveTag: assetTagResolver,
            }),
          startAuthoredEncounter: (startOptions) => {
            const pack = startOptions.contentPack as Parameters<
              typeof buildEncounterRosterFromContentPack
            >[0]['contentPack'];
            const roster = buildEncounterRosterFromContentPack({
              contentPack: pack,
              encounterId: startOptions.encounterId,
              player: { combatantId: 'player', classIds: ['fighter'] },
              companion: { npcId: 'village_guard', classIds: ['fighter'] },
            });
            if (roster === undefined) {
              return false;
            }
            startOptions.send({
              type: 'COMBAT_START_ENCOUNTER',
              encounterId: startOptions.encounterId,
              seed: startOptions.seed,
              engine: 'v2',
              llmAgentsEnabled: false,
              roster,
            });
            return true;
          },
        },
      }),
  });

/** Re-exported so the route/typing consumers do not reach into session internals. */
export type { CombatDebugScenarioDefinition };
