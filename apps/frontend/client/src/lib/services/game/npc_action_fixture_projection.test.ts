// apps/frontend/client/src/lib/services/game/npc_action_fixture_projection.test.ts
//
// The benchmark corpus must send the SAME input production sends
// (issue #381, lane C).
//
// ---------------------------------------------------------------------------
// What this prevents
// ---------------------------------------------------------------------------
//
// The first lane C corpus was authored as
//
//     [NPC]
//     Elder Thalia. Stay in character.
//
//     [PLAYER] … [ELDER] …
//
// while the dialogue turn sent `[NPC] / <name> / <persona> / [EXCHANGE]`.
// Nothing about either shape is wrong on its own; both read as "context". But a
// measurement taken against the first one does not describe the workload the
// game actually performs, and the discrepancy cannot be seen in a diff of the
// benchmark alone — it is only visible against the consumer.
//
// The corpus generator cannot import `buildNpcPersona` (it lives in an app, and
// `scripts/` may not import an app), so the persona block is mirrored there.
// This test is what makes that mirror safe: it compares the generated fixture
// against the production builder for every NPC the corpus uses.

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildNpcActionDecisionContext } from '@aikami/frontend/ai-gateway/decision/tasks';
import type { ContentPackManifest } from '@aikami/types';
import { NPC_ACTION_SELECTION_SPLITS } from '../../../../../frontend/ai-gateway/src/lib/decision/tasks/npc_action_corpus.ts';
import { buildNpcPersona } from './npc_dialogue_persona.ts';

/** The real Emberwatch manifest — the same file the generator reads. */
const manifest = JSON.parse(
  readFileSync(
    resolve(import.meta.dir, '../../../../../../../content/packs/emberwatch/manifest.json'),
    'utf8',
  ),
) as ContentPackManifest;

type CorpusCase = {
  caseId: string;
  npcId: string;
  state: string;
  options: { id: string; description: string }[];
};

const cases: CorpusCase[] = [
  ...NPC_ACTION_SELECTION_SPLITS.dev.cases,
  ...NPC_ACTION_SELECTION_SPLITS.heldout.cases,
];

const npcIds = [...new Set(cases.map((entry) => entry.npcId))];

describe('corpus input projection matches production', () => {
  it('covers every NPC the corpus uses', () => {
    expect(npcIds.length).toBeGreaterThan(5);
  });

  it('uses the shared projection, so the section order cannot drift', () => {
    for (const entry of cases) {
      expect(entry.state.startsWith('[NPC]\n')).toBe(true);
      // `[PLAYER]`/`[ELDER]` markers live INSIDE the exchange text now; what
      // matters is that they sit below the `[EXCHANGE]` heading, which is the
      // part production owns.
      const exchangeAt = entry.state.indexOf('\n[EXCHANGE]\n');
      expect(exchangeAt).toBeGreaterThan(0);
      expect(entry.state.indexOf('[PLAYER]')).toBeGreaterThan(exchangeAt);
    }
  });

  it.each(npcIds)('emits the production persona block for %s', (npcId) => {
    const npc = manifest.npcs[npcId];
    expect(npc).toBeDefined();

    const expectedPersona = buildNpcPersona({
      npcName: npc?.name ?? npcId,
      identity: {
        personality: npc?.personality,
        agenda: npc?.agenda,
        knowledge: npc?.knowledge,
        secrets: npc?.secrets,
        boundaries: npc?.boundaries,
      },
    });

    const entry = cases.find((candidate) => candidate.npcId === npcId);
    expect(entry).toBeDefined();
    // The persona block sits between the name and the blank line before
    // [EXCHANGE]; assert the generated text embeds it verbatim.
    expect(entry?.state).toContain(expectedPersona);
  });

  it('is byte-identical to buildNpcActionDecisionContext for a sampled case', () => {
    const entry = cases[0];
    const npc = manifest.npcs[entry?.npcId ?? ''];
    if (npc === undefined) {
      return;
    }
    const persona = buildNpcPersona({
      npcName: npc.name,
      identity: {
        personality: npc.personality,
        agenda: npc.agenda,
        knowledge: npc.knowledge,
        secrets: npc.secrets,
        boundaries: npc.boundaries,
      },
    });
    const narrative = entry.state.split('\n[EXCHANGE]\n')[1] ?? '';
    const expected = buildNpcActionDecisionContext({
      npcName: npc.name,
      persona,
      narrative,
    });
    expect(entry.state).toBe(expected);
  });

  it('gives every case at least a `none` option, so no-action stays expressible', () => {
    for (const entry of cases) {
      expect(entry.options.map((option) => option.id)).toContain('none');
    }
  });
});
