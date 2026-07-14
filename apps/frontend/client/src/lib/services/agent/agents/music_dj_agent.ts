// apps/frontend/client/src/lib/services/agent/agents/music_dj_agent.ts
//
// Post-agent adapter for the C-249 Music DJ. Reads scene context
// from the AI response and emits a MusicCue with a track selection.
// Dispatches cues to audioService.transitionToBgm().
//
// Contract: C-249

import { CROSSFADE_DURATION_DEFAULT_MS } from '@aikami/constants';
import type { MusicCue, MusicSceneContext, Track } from '@aikami/types';
import {
  audioService,
  sceneToMusicTags,
  textGenerationService,
  trackRegistryService,
} from '$services';
import type { AgentConfig, AgentPipelineContext, AgentRunResult } from '$types/agent_types';

/**
 * Executes the Music DJ post-agent.
 *
 * Analyzes the latest AI response to infer scene context (location,
 * time, weather, combat state, mood), maps it to music tags, and
 * selects the best matching track from the registry. Dispatches
 * the cue via audioService.transitionToBgm().
 *
 * @param config - Agent configuration.
 * @param context - Pipeline context with user message and system prompt.
 * @param aiResponse - The GM's response text to analyze for scene context.
 * @returns Agent run result with parsed MusicCue data.
 */
export const runMusicDjAgent = async ({
  config,
  _context,
  aiResponse,
}: {
  config: AgentConfig;
  _context: AgentPipelineContext;
  aiResponse: string;
}): Promise<AgentRunResult> => {
  const start = performance.now();

  try {
    // ── Step 1: Extract scene context from the AI response ──
    const sceneContext = await _extractSceneContext(aiResponse);

    // ── Step 2: Map scene to music tags ──
    const tags = sceneToMusicTags(sceneContext);

    // ── Step 3: Resolve track (overrides → tag match → fallback) ──
    const track = trackRegistryService.resolveTrackForScene(sceneContext);

    // ── Step 4: Build the MusicCue ──
    const cue: MusicCue | null = _buildCue({
      track,
      tags,
      sceneContext,
      activeTrackUrl: audioService.activeTrackUrl,
    });

    // ── Step 5: Dispatch cue if applicable ──
    if (cue && track) {
      await _dispatchCue(cue, track);
    }

    return {
      agentId: config.id,
      phase: config.phase,
      success: true,
      output: cue ?? {
        type: 'music_cue',
        action: { type: 'none', reason: 'No tracks available' },
        reasoning: 'Registry is empty',
        sceneTags: tags,
      },
      durationMs: Math.round(performance.now() - start),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      agentId: config.id,
      phase: config.phase,
      success: false,
      error: message,
      durationMs: Math.round(performance.now() - start),
    };
  }
};

// ── Private helpers ──────────────────────────────────────────────────────

/**
 * Extracts a MusicSceneContext from the AI response text using
 * structured extraction (lightweight LLM call).
 */
const _extractSceneContext = async (aiResponse: string): Promise<MusicSceneContext> => {
  try {
    const result = await textGenerationService.extractStructure({
      schema: {
        type: 'object',
        properties: {
          locationType: { type: 'string' },
          timeOfDay: { type: 'string' },
          weather: { type: 'string' },
          isInCombat: { type: 'boolean' },
          combatIntensity: { type: 'string' },
          mood: { type: 'string' },
          lastNarrative: { type: 'string' },
        },
        required: ['locationType', 'timeOfDay', 'weather', 'isInCombat', 'mood', 'lastNarrative'],
        additionalProperties: false,
      },
      schemaName: 'MusicSceneContext',
      prompt: [
        'You are the Music DJ agent for a fantasy RPG. Analyze the narrative text',
        'and extract the current scene context for music selection.',
        '',
        'Latest GM response:',
        aiResponse.slice(0, 2000),
        '',
        'Extract: locationType, timeOfDay, weather, isInCombat (boolean),',
        'combatIntensity (optional), mood, lastNarrative (the text itself).',
      ].join('\n'),
      systemPrompt:
        'Extract scene context from this narrative. Return JSON with locationType, timeOfDay, weather, isInCombat (boolean), combatIntensity (optional), mood, and lastNarrative (the text itself).',
    });

    return result as MusicSceneContext;
  } catch {
    // Fallback: parse basic context from the text without an agent call
    return _fallbackSceneContext(aiResponse);
  }
};

/**
 * Simple fallback scene context extraction without agent call.
 * Uses keyword heuristics to infer scene state.
 */
const _fallbackSceneContext = (text: string): MusicSceneContext => {
  const lower = text.toLowerCase();

  const isInCombat =
    lower.includes('attack') ||
    lower.includes('combat') ||
    lower.includes('battle') ||
    lower.includes('fight') ||
    lower.includes('sword') ||
    lower.includes('spell') ||
    lower.includes('weapon') ||
    lower.includes('damage') ||
    lower.includes('initiative');

  const locationType =
    lower.includes('tavern') || lower.includes('inn')
      ? 'tavern'
      : lower.includes('dungeon') || lower.includes('cave')
        ? 'dungeon'
        : lower.includes('forest')
          ? 'forest'
          : lower.includes('town') || lower.includes('city')
            ? 'town'
            : 'wilderness';

  const timeOfDay =
    lower.includes('night') || lower.includes('dark')
      ? 'night'
      : lower.includes('evening') || lower.includes('dusk')
        ? 'evening'
        : lower.includes('morning') || lower.includes('dawn')
          ? 'morning'
          : 'afternoon';

  const weather =
    lower.includes('rain') || lower.includes('storm')
      ? 'storm'
      : lower.includes('snow')
        ? 'snow'
        : lower.includes('fog') || lower.includes('mist')
          ? 'fog'
          : 'clear';

  const mood =
    lower.includes('tense') || lower.includes('fear') || lower.includes('danger')
      ? 'tense'
      : lower.includes('cheerful') || lower.includes('joy') || lower.includes('happy')
        ? 'cheerful'
        : lower.includes('mysterious') || lower.includes('strange')
          ? 'mysterious'
          : lower.includes('sad') || lower.includes('grief')
            ? 'sad'
            : 'neutral';

  return {
    locationType,
    timeOfDay,
    weather,
    isInCombat,
    combatIntensity: isInCombat ? 'medium' : undefined,
    mood,
    lastNarrative: text.slice(0, 500),
  };
};

/**
 * Builds a MusicCue from the resolved track and scene context.
 * Returns null if no cue should be dispatched (no scene change, no tracks).
 */
const _buildCue = (options: {
  track: Track | null;
  tags: string[];
  sceneContext: MusicSceneContext;
  activeTrackUrl: string | null;
}): MusicCue | null => {
  const { track, tags, sceneContext, activeTrackUrl } = options;

  // No tracks in registry
  if (!track) {
    return {
      action: { type: 'none', reason: 'No tracks available in library' },
      reasoning: 'Track registry is empty — no music to play',
      sceneTags: tags,
    };
  }

  // Currently playing the same track
  if (activeTrackUrl && track.url && activeTrackUrl === track.url) {
    return {
      action: { type: 'none', reason: 'Same track already playing' },
      reasoning: 'Current track still matches the scene — no change needed',
      sceneTags: tags,
    };
  }

  // First track (no active BGM) → play
  if (!activeTrackUrl) {
    return {
      action: { type: 'play', trackId: track.id, fadeInMs: 1000 },
      reasoning: `Starting ${track.title} for ${sceneContext.locationType} scene (${sceneContext.mood} mood)`,
      sceneTags: tags,
    };
  }

  // Scene change → crossfade
  return {
    action: { type: 'crossfade', trackId: track.id, durationMs: CROSSFADE_DURATION_DEFAULT_MS },
    reasoning: `Switching to ${track.title} for ${sceneContext.locationType} scene (${sceneContext.mood} mood)`,
    sceneTags: tags,
  };
};

/**
 * Dispatches a MusicCue to the audio service.
 */
const _dispatchCue = async (cue: MusicCue, track: { url?: string; id: string }): Promise<void> => {
  const action = cue.action;

  switch (action.type) {
    case 'play':
    case 'crossfade':
      if (track.url) {
        const durationMs =
          action.type === 'crossfade'
            ? (action.durationMs ?? CROSSFADE_DURATION_DEFAULT_MS)
            : (action.fadeInMs ?? CROSSFADE_DURATION_DEFAULT_MS);
        await audioService.transitionToBgm(track.url, durationMs);
      }
      break;
    case 'pause':
      audioService.stopAll();
      break;
    case 'volume':
      if (action.target === 'music') {
        audioService.setBgmVolume(action.level);
      } else if (action.target === 'master') {
        audioService.setMasterVolume(action.level);
      } else if (action.target === 'sfx') {
        audioService.setSfxVolume(action.level);
      }
      break;
    case 'none':
      // No-op
      break;
  }
};
