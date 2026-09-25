// apps/frontend/client/src/lib/views/settings/ai/capability_guidance.ts
//
// Capability-specific, player-facing guidance for settings. This is a pure
// projection so the unconfigured state explains the feature without loading
// provider details or implying that unavailable AI is active.

import type { ConnectionCapability } from '$types';
import type { CapabilityStatus } from './ai_connection_status.svelte';

export type CapabilityGuidance = {
  readonly title: string;
  readonly description: string;
  readonly availabilityLabel: string;
  readonly setupActionLabel: string;
  readonly playableWithout: string;
};

const GUIDANCE: Record<ConnectionCapability, Omit<CapabilityGuidance, 'availabilityLabel'>> = {
  text: {
    title: 'Story & Dialogue',
    description: 'Generates narrative dialogue, choices and story responses during play.',
    setupActionLabel: 'Set up a text connection',
    playableWithout: 'Exploration, combat, inventory, quests and the journal remain playable.',
  },
  image: {
    title: 'Artwork',
    description: 'Generates portraits, scenes and other visual content when requested.',
    setupActionLabel: 'Set up an image connection',
    playableWithout: 'Core gameplay, authored artwork, inventory and quests remain playable.',
  },
  voice: {
    title: 'Read Aloud',
    description: 'Speaks dialogue and narration with a configured voice connection.',
    setupActionLabel: 'Set up a voice connection',
    playableWithout: 'Text dialogue, exploration, combat and journal content remain playable.',
  },
};

/** Builds honest capability guidance from the shared connection status. */
export const buildCapabilityGuidance = (options: {
  capability: ConnectionCapability;
  status: CapabilityStatus;
}): CapabilityGuidance => {
  const base = GUIDANCE[options.capability];
  const availabilityLabel = (() => {
    switch (options.status) {
      case 'reachable':
        return 'Available now';
      case 'not_tested':
        return 'Configured · availability not tested';
      case 'testing':
        return 'Checking availability…';
      case 'unreachable':
        return 'Unavailable · connection test failed';
      default:
        return 'Unavailable · not configured';
    }
  })();

  return {
    ...base,
    availabilityLabel,
  };
};
