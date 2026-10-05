// scripts/evaluation/decision/generate_npc_action_corpus.ts
//
// Emits the on-disk corpus for the `npc-action-selection` task.
//
// Run with:  bun scripts/evaluation/decision/generate_npc_action_corpus.ts
//
// Why a generator rather than hand-written JSON: every case must carry the
// option set that is actually legal for ITS npc, derived from the same rules
// `enumerateNpcActionCandidates` applies in production. Hand-writing that
// invites exactly the drift the task exists to prevent — a case labelled with
// an option its own NPC was never permitted to take would grade the backend for
// refusing it.
//
// The EMITTED JSON is the committed source of truth. This script exists so the
// per-case option sets can be regenerated and diffed against the Emberwatch
// content pack, not so labels can live in TypeScript.
//
// ---------------------------------------------------------------------------
// Label provenance, stated honestly
// ---------------------------------------------------------------------------
//
// Every label here is AUTHORED, not observed. No telemetry was available, so
// there is no ground truth for "what would a good dialogue model have done
// turn N of a real session". What these labels are is a written specification of
// what the game should do, grounded in three facts:
//
//   - the candidate set is exactly what the NPC is permitted to do, and
//   - `none` is correct whenever the exchange does not call for one of them.
//
// The known failure mode of an authored corpus is that it grades agreement with
// the author's intent rather than quality. `limitations` in the emitted
// provenance says so, and it is reproduced in the report rather than hidden.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(
  HERE,
  '../../../packages/frontend/ai-gateway/src/lib/decision/tasks/fixtures',
);

// ---------------------------------------------------------------------------
// Emberwatch world state, read from the real content pack
// ---------------------------------------------------------------------------

type Quest = { id: string; name: string; offeredByNpcId?: string };
type Evidence = { id: string; label: string; presentToNpcId: string };
type Npc = {
  name: string;
  isVendor?: boolean;
  isCompanion?: boolean;
  combatStats?: unknown;
  vendorInventory?: string;
};

const packRoot = resolve(HERE, '../../../content/packs/emberwatch');
const manifest = JSON.parse(readFileSync(resolve(packRoot, 'manifest.json'), 'utf8')) as {
  quests: Record<string, Quest>;
  npcs: Record<string, Npc>;
  evidence: Evidence[];
  items: Record<string, { name?: string }>;
};

const questsById = manifest.quests;
const npcsById = manifest.npcs;
const evidence = manifest.evidence;

// ---------------------------------------------------------------------------
// Candidate derivation — mirrors enumerateNpcActionCandidates
// ---------------------------------------------------------------------------

/**
 * The option text, kept BYTE-IDENTICAL to
 * `apps/frontend/client/src/lib/services/game/npc_action_candidates.ts`.
 *
 * If these two drift, the benchmark stops measuring what production sends and
 * the whole comparison becomes meaningless — so the strings are duplicated here
 * deliberately and the test `npc_action_candidates.test.ts` pins the production
 * side. See that module's `NpcActionCandidate.label` note for why the wording is
 * a plain action description rather than a compound "is this the right moment".
 */
const NONE_LABEL = 'Nothing state-changing is called for here. Keep talking.';

type Option = { id: string; description: string };
export type NpcActionCorpusSpec = {
  caseId: string;
  split: 'dev' | 'heldout';
  category: string;
  language: string;
  kind: 'positive' | 'required-abstain' | 'excluded';
  npcId: string;
  expected: string | null;
  exchange: string;
  /** Free-form note explaining why this label is the specification. */
  rationale: string;
};

/** The legal option set for one NPC, exactly as production enumerates it. */
const optionsFor = (npcId: string): Option[] => {
  const npc = npcsById[npcId];
  if (npc === undefined) {
    throw new Error(`unknown npc ${npcId}`);
  }
  const options: Option[] = [{ id: 'none', description: NONE_LABEL }];
  if (npc.isVendor) {
    options.push({
      id: 'trade',
      description: 'Open the trade overlay so the player can buy or sell.',
    });
  }
  if (npc.isCompanion) {
    options.push({ id: 'recruit', description: "Offer to join the player's party." });
  }
  if (npc.combatStats) {
    options.push({ id: 'startCombat', description: 'Attack the player.' });
  }
  for (const [id, quest] of Object.entries(questsById)) {
    // The authorization getOfferableQuests applies and the offerQuest
    // precondition cannot: offeredByNpcId, unset meaning anyone may offer.
    if (quest.offeredByNpcId !== undefined && quest.offeredByNpcId !== npcId) {
      continue;
    }
    options.push({
      id: `offerQuest:${id}`,
      description: `Offer the quest "${quest.name}" to the player.`,
    });
  }
  const inventory = (npc.vendorInventory ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter((e) => e.length > 0);
  for (const itemId of inventory) {
    options.push({
      id: `giveItem:${itemId}`,
      description: `Hand ${itemId} to the player as a gift.`,
    });
  }
  for (const item of evidence) {
    if (item.presentToNpcId !== npcId) {
      continue;
    }
    options.push({
      id: `presentEvidence:${item.id}`,
      description: `Receive the evidence "${item.label}" from the player.`,
    });
  }
  return options;
};

/**
 * The persona block, mirroring `buildNpcPersona`.
 *
 * MIRRORED, not shared: the production builder lives in an app, and
 * `scripts/` may not import an app. Rather than silently accept a second
 * implementation, the equality is pinned by
 * `apps/frontend/client/src/lib/services/game/npc_action_fixture_projection.test.ts`,
 * which compares this output against the production builder for every NPC the
 * corpus uses. If either side changes, that test fails.
 */
const personaFor = (npcId: string): string => {
  const npc = npcsById[npcId];
  const lines = npc.personality
    ? [`Voice: ${npc.personality.voice}`, `Manner: ${npc.personality.manner}`]
    : [`You are ${npc.name}, a character in a fantasy world.`];
  const block = (label: string, entries: readonly string[] | undefined): void => {
    if (entries && entries.length > 0) {
      lines.push('', `[${label}]`, ...entries.map((entry) => `- ${entry}`));
    }
  };
  block('AGENDA', npc.agenda);
  block('KNOWLEDGE', npc.knowledge);
  block('SECRETS', npc.secrets);
  block('BOUNDARIES', npc.boundaries);
  return lines.join('\n');
};

/**
 * The fixture's `state`, built with the SAME projection production sends.
 *
 * `buildNpcActionDecisionContext` is imported from the client service rather
 * than reimplemented here. The previous version of this generator wrote a
 * different shape entirely (`[NPC]\n<name>. Stay in character.` with
 * `[PLAYER]`/`[ELDER]` sections and no persona), which meant the benchmark was
 * measuring an input the game never produces.
 */
const stateFor = (npcId: string, narrative: string): string =>
  buildNpcActionDecisionContext({
    npcName: npcsById[npcId].name,
    // The authored persona the narrative call receives.
    persona: personaFor(npcId),
    narrative,
  });

import { buildNpcActionDecisionContext } from '../../../packages/frontend/ai-gateway/src/lib/decision/tasks/decision_context.ts';
import SPECS from './npc_action_corpus_cases.ts';

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

const LABEL_PROVENANCE = {
  note: 'Every label is AUTHORED against the real Emberwatch content pack, not observed from telemetry. Each case carries the option set enumerateNpcActionCandidates would produce for that NPC in that world state, so a label can never name an option the NPC was not permitted to take.',
  sources: [
    'content/packs/emberwatch/manifest.json — quests, npcs (isVendor/isCompanion/combatStats/vendorInventory), items, evidence',
    'apps/frontend/client/src/lib/services/game/npc_action_candidates.ts — the production enumeration mirrored here',
    'packages/frontend/ai-gateway/src/lib/decision/tasks/npc_action_selection.ts — the task contract',
  ],
  corrections: [
    'Candidates carry REAL payload ids (offerQuest:fading_ward, giveItem:healthPotion, presentEvidence:the_ledger). No case asks a model to invent a content-pack identifier.',
    "Every option set is filtered to what that specific NPC is permitted to do. The production `offerQuest` precondition checks only that a quest exists in the pack, so cross-offerer requests such as asking the village elder for the smith's errand are reachable in the shipping path and are NOT options here.",
    '`none` is an ordinary answer, and it is the declared safeLiteral. required-abstain cases include both ordinary small talk and adversarial requests for something the NPC cannot do.',
  ],
  limitations: [
    'Labels are a written specification, not observed play. This corpus grades agreement with the authored specification and cannot detect a specification that is itself wrong.',
    'English only. No checkpoint under test declares another language, so there is no multilingual slice to score and any non-English case would have to abstain by construction.',
    'No held-out speaker, no unseen content pack. Both NPCs and exchanges are authored here; the split is a split of exchanges, not of content.',
    'skillCheck is absent from every option set by design: a difficulty class has no authoritative enumeration, so including one would put 48 legal-but-meaningless options in front of the backend.',
  ],
  kinds:
    'positive = the named action is the correct one; required-abstain = no state-changing action is warranted and `none` (or abstention) is the only safe outcome; excluded = ungradable and reported separately.',
};

/** Display name for an npc id, falling back to the id itself. */
const npcIdLabel = (npcId: string): string => npcsById[npcId]?.name ?? npcId;

for (const split of ['dev', 'heldout'] as const) {
  const cases = SPECS.filter((spec) => spec.split === split).map((spec) => {
    const options = optionsFor(spec.npcId);
    if (spec.expected !== null && !options.some((option) => option.id === spec.expected)) {
      throw new Error(
        `${spec.caseId}: expected ${spec.expected} is not in ${npcIdLabel(spec.npcId)}'s option set`,
      );
    }
    return {
      caseId: spec.caseId,
      category: spec.category,
      language: spec.language,
      kind: spec.kind,
      expected: spec.expected,
      state: stateFor(spec.npcId, spec.exchange),
      npcId: spec.npcId,
      options,
      rationale: spec.rationale,
    };
  });

  const file = {
    schemaVersion: 'decision-fixture/1',
    split,
    purpose:
      split === 'dev'
        ? 'Calibration only. Read to choose selective-acceptance thresholds and the held-out split is never consulted before those thresholds are frozen. Never a reported score.'
        : 'Reported once against thresholds frozen on the development split. Never tuned against.',
    task: 'npc-action-selection',
    labelProvenance: LABEL_PROVENANCE,
    cases,
  };

  const target = resolve(OUT_DIR, `npc_action_selection_${split}.json`);
  writeFileSync(target, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
  const positives = cases.filter((c) => c.kind === 'positive').length;
  const abstains = cases.filter((c) => c.kind === 'required-abstain').length;
  console.log(
    `${split}: ${cases.length} cases (${positives} positive, ${abstains} required-abstain) -> ${target.replace(`${process.cwd()}/`, '')}`,
  );
}
