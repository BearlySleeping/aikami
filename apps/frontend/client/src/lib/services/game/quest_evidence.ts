// apps/frontend/client/src/lib/services/game/quest_evidence.ts
//
// Evidence lifecycle (C-495) — discovery at authored locations, presentation
// to the authored recipient NPC, and the discoverable-evidence projection the
// dialogue executor reads.
//
// Extracted from `quest_state_service` so that service stays the quest
// lifecycle orchestrator: everything here reads the manifest plus the
// campaign's single sampled truth and writes through the injected world-state
// accessors, and owns no state of its own.
//
// Contract: C-495 Emberwatch dramatic structure

import type { ContentPackLoaderInterface } from '@aikami/frontend/engine';
import type { CommittedNarrativeEvent } from '@aikami/types';
import { logger } from '$logger';
import {
  getTruthVariant,
  getTruthVariants,
  resolveEvidence,
  resolveEvidenceById,
} from './dramatic_structure_service';
import { narrativeEventService } from './narrative_event_service.svelte.ts';

/** A discovered evidence item as offered to the dialogue evidence picker. */
export type DiscoverableEvidence = {
  id: string;
  label: string;
  presentToNpcId: string;
};

/**
 * The quest-state accessors the evidence lifecycle reads and writes through.
 * Passed in per call so this module never reaches into the service instance,
 * and deliberately module-private: the service is the only constructor and a
 * caller passing a structural literal needs no name for it.
 */
type QuestEvidenceContext = {
  /** The loaded content pack, absent until `configure()` has run. */
  contentPackLoader: ContentPackLoaderInterface | undefined;
  /** The campaign's single sampled truth variant, when a campaign is active. */
  sampledTruthId: string | undefined;
  /** The active campaign id, when a campaign is active. */
  activeCampaignId: string | undefined;
  /** Live world-state flags; discovery and presentation flags live here. */
  worldStateFlags: Readonly<Record<string, boolean>>;
  /** Sets a world-state flag. Returns true when the flag was set. */
  setWorldStateFlag(flag: string): boolean;
};

/**
 * World-state flag naming for evidence. These strings are a content contract:
 * a pack's `requiresWorldStateFlag` must spell them exactly.
 */
const discoveredFlag = (evidenceId: string): string => `evidence.discovered.${evidenceId}`;
const presentedFlag = (evidenceId: string): string => `evidence.presented.${evidenceId}`;

/**
 * Presents a discovered evidence item to its named NPC (C-495 AC-2).
 *
 * Records exactly one `EvidencePresented` event (idempotent — presenting the
 * same evidence twice does not record twice) and sets the world-state flag a
 * world-state-conditioned ending requires. Returns the committed event, or
 * undefined when the evidence is not consistent with the sampled truth, not
 * discovered, or offered to the wrong NPC.
 */
export const presentEvidence = (options: {
  context: QuestEvidenceContext;
  evidenceId: string;
  campaignId: string;
  npcId: string;
}): CommittedNarrativeEvent | undefined => {
  const { context, evidenceId, campaignId, npcId } = options;
  const loader = context.contentPackLoader;
  if (!loader || !campaignId) {
    return undefined;
  }
  const sampledTruthId = context.sampledTruthId;
  const evidence = resolveEvidenceById(loader.manifest, evidenceId, sampledTruthId);
  if (!evidence) {
    logger.debug('presentEvidence:incompatible', { evidenceId, sampledTruthId });
    return undefined;
  }
  if (!context.worldStateFlags[discoveredFlag(evidence.id)]) {
    logger.debug('presentEvidence:undiscovered', { evidenceId });
    return undefined;
  }
  if (evidence.presentToNpcId !== npcId) {
    logger.debug('presentEvidence:wrong-recipient', {
      evidenceId,
      expectedNpcId: evidence.presentToNpcId,
      npcId,
    });
    return undefined;
  }
  // Idempotency — presenting the same evidence twice records at most once.
  const alreadyPresented = narrativeEventService.events.some(
    (existing) => existing.kind === 'EvidencePresented' && existing.subjectId === evidenceId,
  );
  if (alreadyPresented) {
    logger.debug('presentEvidence:already-presented', { evidenceId });
    return undefined;
  }
  // Record exactly one EvidencePresented event (C-491 seam).
  const event = narrativeEventService.record({
    campaignId,
    kind: 'EvidencePresented',
    informationKind: 'world_fact',
    summary: `Evidence presented: ${evidence.label}`,
    subjectId: evidence.id,
    actorId: evidence.presentToNpcId,
    witnesses: [evidence.presentToNpcId],
  });
  // Set the evidence-presented world-state flag so world-state-conditioned
  // endings become reachable (C-495 AC-3/AC-4).
  context.setWorldStateFlag(presentedFlag(evidence.id));
  logger.debug('presentEvidence', { evidenceId, eventId: event.id });
  return event;
};

/**
 * Persists truth-compatible evidence whose authored discovery location has
 * been reached. Discovery flags are serialized with quest world state.
 */
export const discoverEvidenceAt = (options: {
  context: QuestEvidenceContext;
  location: string;
}): string[] => {
  const { context, location } = options;
  const loader = context.contentPackLoader;
  if (!loader || !location) {
    return [];
  }
  const discovered: string[] = [];
  for (const evidence of resolveEvidence(loader.manifest, context.sampledTruthId)) {
    if (
      evidence.discoverableAt !== location &&
      !evidence.discoverableAt.startsWith(`${location}:`)
    ) {
      continue;
    }
    context.setWorldStateFlag(discoveredFlag(evidence.id));
    discovered.push(evidence.id);
  }
  if (discovered.length > 0) {
    logger.debug('discoverEvidenceAt', { location, evidenceIds: discovered });
  }
  return discovered;
};

/**
 * Resolves standalone and map-qualified prop discovery locations, so evidence
 * authored as `<propId>` or `<mapId>:<propId>` is found from either shape.
 */
export const discoverEvidenceAtProp = (options: {
  context: QuestEvidenceContext;
  propId: string;
  mapUrl: string | undefined;
}): void => {
  const { context, propId, mapUrl } = options;
  discoverEvidenceAt({ context, location: propId });
  const mapId = mapUrl ? context.contentPackLoader?.resolveMapId(mapUrl) : undefined;
  if (mapId) {
    discoverEvidenceAt({ context, location: `${mapId}:${propId}` });
  }
};

/**
 * Returns discovered evidence compatible with the campaign's sampled truth.
 * Passing a `campaignId` that is not the active campaign resolves nothing, so
 * a stale dialogue surface cannot leak another campaign's evidence.
 */
export const getDiscoverableEvidence = (options: {
  context: QuestEvidenceContext;
  campaignId?: string;
}): DiscoverableEvidence[] => {
  const { context, campaignId } = options;
  const loader = context.contentPackLoader;
  if (!loader) {
    return [];
  }
  let sampledTruthId = context.sampledTruthId;
  if (campaignId && context.activeCampaignId !== campaignId) {
    sampledTruthId = undefined;
  }
  if (getTruthVariants(loader.manifest).length === 0) {
    return [];
  }
  if (!getTruthVariant(loader.manifest, sampledTruthId)) {
    return [];
  }
  return resolveEvidence(loader.manifest, sampledTruthId)
    .filter((evidence) => context.worldStateFlags[discoveredFlag(evidence.id)])
    .map((evidence) => ({
      id: evidence.id,
      label: evidence.label,
      presentToNpcId: evidence.presentToNpcId,
    }));
};
