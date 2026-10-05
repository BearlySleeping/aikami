// apps/frontend/client/src/lib/services/worldgen/world_gen_stage_prompts.ts
//
// G01 — per-stage provider schemas and prompt assembly.
//
// Split out of `world_gen_draft_service.svelte.ts` because it is a different
// responsibility: this module is the declarative description of WHAT each stage
// asks the provider for, while the service is the lifecycle that asks. Adding a
// stage field is a change here; adding a cancellation rule is a change there.

import type { WorldGenDraftStage } from '@aikami/schemas';
import {
  WORLD_GEN_STAGE_LABELS,
  type WorldGenStageContext,
  worldGenStageInputs,
} from './world_gen_stage_graph.ts';

/** Shared contract every stage prompt states. */
export const WORLD_GEN_DRAFT_SYSTEM_PROMPT =
  'You are a master world-builder. You produce bounded, internally consistent JSON. ' +
  'You never emit markdown fences, commentary, or fields outside the requested schema. ' +
  'Every id you emit must match ^[a-z]+_[a-z0-9-]{1,48}$ and be unique within its stage.';

const objectSchema = (
  properties: Record<string, unknown>,
  required: readonly string[],
): Record<string, unknown> => ({
  type: 'object',
  properties,
  required: [...required],
  additionalProperties: false,
});

/** Per-stage TypeBox schemas, declared as plain JSON-schema records. */
/** Per-stage JSON schemas, declared as plain records for the gateway. */
export const WORLD_GEN_STAGE_SCHEMAS: Record<WorldGenDraftStage, Record<string, unknown>> = {
  setting: objectSchema(
    {
      worldName: { type: 'string', minLength: 1, maxLength: 120 },
      worldDescription: { type: 'string', minLength: 10, maxLength: 4000 },
      themes: { type: 'array', items: { type: 'string', maxLength: 120 }, maxItems: 8 },
    },
    ['worldName', 'worldDescription'],
  ),
  cast: objectSchema(
    {
      npcs: {
        type: 'array',
        maxItems: 20,
        items: objectSchema(
          {
            name: { type: 'string', minLength: 1, maxLength: 120 },
            race: { type: 'string', minLength: 1, maxLength: 120 },
            class: { type: 'string', minLength: 1, maxLength: 120 },
            role: { type: 'string', minLength: 1, maxLength: 120 },
            description: { type: 'string', minLength: 1, maxLength: 2000 },
            personality: { type: 'string', minLength: 1, maxLength: 2000 },
          },
          ['name', 'race', 'class', 'role', 'description', 'personality'],
        ),
      },
    },
    ['npcs'],
  ),
  places: objectSchema(
    {
      places: {
        type: 'array',
        maxItems: 12,
        items: objectSchema(
          {
            name: { type: 'string', minLength: 1, maxLength: 120 },
            description: { type: 'string', minLength: 1, maxLength: 2000 },
          },
          ['name', 'description'],
        ),
      },
    },
    ['places'],
  ),
  hudWidgets: objectSchema(
    {
      hudWidgets: {
        type: 'array',
        maxItems: 8,
        items: objectSchema(
          {
            slot: { type: 'string', minLength: 1, maxLength: 64 },
            label: { type: 'string', minLength: 1, maxLength: 120 },
            icon: { type: 'string', minLength: 1, maxLength: 120 },
            defaultVisibility: { type: 'boolean' },
          },
          ['slot', 'label', 'icon', 'defaultVisibility'],
        ),
      },
    },
    ['hudWidgets'],
  ),
  arcs: objectSchema(
    {
      arcs: {
        type: 'array',
        maxItems: 8,
        items: objectSchema(
          {
            chapter: { type: 'string', minLength: 1, maxLength: 160 },
            description: { type: 'string', minLength: 1, maxLength: 2000 },
            objectives: { type: 'array', items: { type: 'string', maxLength: 400 }, maxItems: 8 },
            // Names, resolved to ids after the cast exists. The prompt says so
            // explicitly so the provider is not asked to invent ids it cannot
            // have seen.
            questGiverNames: { type: 'array', items: { type: 'string' }, maxItems: 4 },
          },
          ['chapter', 'description', 'objectives', 'questGiverNames'],
        ),
      },
    },
    ['arcs'],
  ),
};

/**
 * Assembles the prompt for one stage.
 *
 * The rendered sections come from {@link worldGenStageInputs}, the SAME table
 * `stageFingerprint` reads. The earlier version embedded the whole wizard form
 * (`JSON.stringify(input)`) in every stage prompt while the fingerprints were
 * hand-written per stage — so `cast` and `places` were declared reusable across
 * a goals edit whose prompt had in fact changed. One table, one truth.
 */
export const assembleWorldGenStagePrompt = (
  stage: WorldGenDraftStage,
  context: WorldGenStageContext,
): string => {
  const slice = worldGenStageInputs(stage, context);
  const lines = [
    WORLD_GEN_DRAFT_SYSTEM_PROMPT,
    '',
    `## Task`,
    `Produce ONLY the ${WORLD_GEN_STAGE_LABELS[stage]} for this world.`,
  ];

  const answers = Object.entries(slice.input);
  if (answers.length > 0) {
    lines.push('', '## Player answers (the only answers in scope for this stage)');
    for (const [key, value] of answers) {
      lines.push(`${key}: ${value}`);
    }
  }

  const premiseName = slice.setting.worldName;
  const premiseDescription = slice.setting.worldDescription;
  const themes = slice.setting.themes;
  if (premiseName !== undefined) {
    lines.push('', '## World premise (already generated)', `Name: ${premiseName}`);
    if (premiseDescription !== undefined) {
      lines.push(`Description: ${premiseDescription}`);
    }
    if (Array.isArray(themes)) {
      lines.push(`Themes: ${(themes as string[]).join(', ')}`);
    }
  }

  if (stage === 'setting') {
    lines.push(
      '',
      'Cast, locations, HUD widgets and story arcs are generated separately. Do not produce them.',
    );
  }

  if (slice.cast !== undefined) {
    lines.push(
      '',
      '## Cast (already generated)',
      'Quest-giver names MUST come from the NAME of a roster entry, verbatim. Emit the name only, not the id:',
      JSON.stringify(slice.cast),
    );
  }

  lines.push('', '## Response', 'Return ONLY valid JSON. No fences, no commentary.');
  return lines.join('\n');
};
