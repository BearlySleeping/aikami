// .pi/extensions/lib/skill_router.ts
//
// 🔴 Progressive skill disclosure for specialized skills.
// Non-engine sessions avoid the entire Pixi API catalogue (~26 files, ~3,755
// tokens). Engine sessions call `loadPixiSkill()` to load individual skills
// on demand.
//
// The router is registered as a Pi tool. Project conventions remain available
// regardless of which specialized skills are loaded. Upstream content is not
// discarded to reduce metadata — it stays available for on-demand loading.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

// ── Pixi skill registry ──────────────────────────────────────

/**
 * Registered Pixi skill IDs and their descriptions.
 * Add new skills here when they are generated.
 */
const PIXI_SKILLS = [
  { id: 'pixijs', label: 'PixiJS v8 Core', description: 'Core PixiJS concepts and architecture.' },
  {
    id: 'pixijs-accessibility',
    label: 'Accessibility',
    description: 'Accessibility features in PixiJS.',
  },
  {
    id: 'pixijs-application',
    label: 'Application',
    description: 'PixiJS Application setup and configuration.',
  },
  { id: 'pixijs-assets', label: 'Assets', description: 'Asset loading and management.' },
  { id: 'pixijs-blend-modes', label: 'Blend Modes', description: 'Blend modes and compositing.' },
  { id: 'pixijs-color', label: 'Color', description: 'Color handling and manipulation.' },
  {
    id: 'pixijs-core-concepts',
    label: 'Core Concepts',
    description: 'Fundamental PixiJS concepts.',
  },
  { id: 'pixijs-create', label: 'Create', description: 'Creating PixiJS objects and scenes.' },
  {
    id: 'pixijs-custom-rendering',
    label: 'Custom Rendering',
    description: 'Custom rendering pipelines.',
  },
  {
    id: 'pixijs-environments',
    label: 'Environments',
    description: 'Environment-specific configuration.',
  },
  { id: 'pixijs-events', label: 'Events', description: 'Event handling and interaction.' },
  { id: 'pixijs-filters', label: 'Filters', description: 'Visual filters and effects.' },
  { id: 'pixijs-html-source', label: 'HTML Source', description: 'HTML integration with PixiJS.' },
  { id: 'pixijs-math', label: 'Math', description: 'Mathematical utilities and types.' },
  {
    id: 'pixijs-migration-v8',
    label: 'Migration v8',
    description: 'Migration guide from v7 to v8.',
  },
  { id: 'pixijs-performance', label: 'Performance', description: 'Performance optimization.' },
  {
    id: 'pixijs-scene-container',
    label: 'Scene Container',
    description: 'Scene graph containers.',
  },
  {
    id: 'pixijs-scene-core-concepts',
    label: 'Scene Core Concepts',
    description: 'Scene system fundamentals.',
  },
  {
    id: 'pixijs-scene-dom-container',
    label: 'Scene DOM Container',
    description: 'DOM integration in scenes.',
  },
  { id: 'pixijs-scene-gif', label: 'Scene GIF', description: 'GIF animation support.' },
  {
    id: 'pixijs-scene-graphics',
    label: 'Scene Graphics',
    description: 'Graphics rendering in scenes.',
  },
  { id: 'pixijs-scene-mesh', label: 'Scene Mesh', description: 'Mesh rendering in scenes.' },
  {
    id: 'pixijs-scene-particle-container',
    label: 'Scene Particles',
    description: 'Particle system support.',
  },
  { id: 'pixijs-scene-sprite', label: 'Scene Sprite', description: 'Sprite rendering in scenes.' },
  { id: 'pixijs-scene-text', label: 'Scene Text', description: 'Text rendering in scenes.' },
  { id: 'pixijs-ticker', label: 'Ticker', description: 'Animation loop and timing.' },
] as const;

export type PixiSkillId = (typeof PIXI_SKILLS)[number]['id'];

// ── On-demand loading ────────────────────────────────────────

/**
 * Base directory for generated Pixi skills.
 * Resolved relative to the Pi project root (the repo root).
 */
const PIXI_SKILLS_DIR = '.pi/generated-skills/pixijs';

/** Resolve a Pixi skill ID to its SKILL.md path. */
const skillPath = (repoRoot: string, skillId: string): string =>
  join(repoRoot, PIXI_SKILLS_DIR, skillId, 'SKILL.md');

/** Map of skill IDs to cached content. */
const loadedCache = new Map<string, string>();

/**
 * Load a Pixi skill's SKILL.md content on demand.
 * Returns the full file content, or undefined if the skill doesn't exist.
 */
export const loadPixiSkill = (options: {
  repoRoot: string;
  skillId: string;
}): string | undefined => {
  const cached = loadedCache.get(options.skillId);
  if (cached !== undefined) {
    return cached;
  }
  const path = skillPath(options.repoRoot, options.skillId);
  if (!existsSync(path)) {
    return undefined;
  }
  const content = readFileSync(path, 'utf-8');
  loadedCache.set(options.skillId, content);
  return content;
};

/**
 * Check if a Pixi skill exists.
 */
export const hasPixiSkill = (options: { repoRoot: string; skillId: string }): boolean => {
  const path = skillPath(options.repoRoot, options.skillId);
  return existsSync(path);
};

/**
 * Get the list of all available Pixi skill IDs and descriptions.
 */
export const listPixiSkills = (): ReadonlyArray<{
  id: string;
  label: string;
  description: string;
}> => PIXI_SKILLS;

/**
 * Clear the in-memory cache (useful for testing).
 */
export const clearPixiSkillCache = (): void => {
  loadedCache.clear();
};

// ── Extension registration ───────────────────────────────────

/**
 * Register the Pixi skill router as a Pi tool.
 * Non-engine sessions only pay the cost of this tool's registration
 * (a single tool with its description), not the full 26-file Pixi catalogue.
 *
 * Engine sessions call the tool to load individual skills on demand.
 */
export const registerSkillRouter = (pi: ExtensionAPI, repoRoot: string): void => {
  const skillIndex = PIXI_SKILLS.map((s) => `• ${s.id} — ${s.label}: ${s.description}`).join('\n');

  pi.registerTool({
    name: 'load_pixi_skill',
    label: 'Load Pixi Skill',
    description: [
      'Load a PixiJS skill file on demand for engine/game work.',
      'Non-engine sessions should NOT call this — the Pixi catalogue is large.',
      '',
      'Available skills:',
      skillIndex,
      '',
      'Usage: call with the skill ID (e.g. "pixijs-core-concepts") to load that skill\'s full content.',
      'Project conventions (aikami-conventions) are always available without calling this tool.',
    ].join('\n'),
    parameters: Type.Object({
      skillId: Type.String({
        description: 'Pixi skill ID to load (e.g. "pixijs-core-concepts", "pixijs-ticker")',
      }),
    }),
    async execute(_toolCallId, params) {
      const { skillId } = params as { skillId: string };
      const content = loadPixiSkill({ repoRoot, skillId });
      if (!content) {
        return {
          content: [{ type: 'text' as const, text: `❌ Pixi skill "${skillId}" not found.` }],
          isError: true,
          details: { error: 'skill_not_found', skillId },
        };
      }
      return {
        content: [{ type: 'text' as const, text: content }],
      };
    },
  });
};
