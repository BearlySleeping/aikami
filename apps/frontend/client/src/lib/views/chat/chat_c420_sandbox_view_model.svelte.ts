// apps/frontend/client/src/lib/views/chat/chat_c420_sandbox_view_model.svelte.ts
//
// Dev sandbox override for C-420 — mounts the PRODUCTION ChatView with an
// EMPTY chat (no messages) so the starter-chip empty state (AC-2) and the
// model-chip-after-turn behaviour (AC-3) can be exercised and screenshotted.
// Dev-only; never imported from production code.
import { SUGGESTION_CHIPS_AGENT_ID } from '@aikami/constants';
import type { NpcData, NpcSuggestionChip } from '@aikami/types';
import { chatService } from '$services';
import type { AgentRunResult } from '$types';
import type { AgentPipelineViewModelInterface } from '$views/agent/agent_pipeline_view_model.svelte';
import { ChatViewModel, type ChatViewModelOptions } from './chat_view_model.svelte.ts';

/** Deterministic starter chips for the sandbox NPC (AC-2) — no preset/class dependency. */
const MOCK_INITIAL_SUGGESTIONS: NpcSuggestionChip[] = [
  {
    id: 'sandbox-chip-1',
    label: 'Ask about the fading ward',
    intentType: 'quest',
    prefillText: 'Tell me about the fading ward you mentioned, please.',
  },
  {
    id: 'sandbox-chip-2',
    label: 'Offer to help the village',
    intentType: 'dialogue',
    prefillText: 'I would like to help the village however I can.',
  },
  {
    id: 'sandbox-chip-3',
    label: 'Ask about the hidden shrine',
    intentType: 'skill_check',
    prefillText: 'Can you tell me more about the hidden shrine?',
  },
];

const MOCK_NPC: NpcData = {
  id: 'dev-npc-thalia',
  name: 'Elder Thalia',
  race: 'Human',
  class: 'Cleric',
  level: 8,
  experiencePoints: 34000,
  hitPoints: 48,
  hitPointsMax: 48,
  temporaryHitPoints: 0,
  armorClass: 16,
  speed: 30,
  alignment: 'Lawful Good',
  isFriendly: true,
  visibility: 'private' as const,
  avatarUrl: 'https://placehold.co/400x400/2a5a1a/c9f8d8?text=Thalia',
  personalityTraits:
    'Thalia is warm and maternal, speaking in gentle proverbs. She is deeply protective of the village.',
  background:
    'The elder of a small farming village, Thalia has guided her people through famine and war for forty years.',
  notes: 'Knows the location of the hidden shrine. Wary of outsiders.',
  savingThrows: [
    { ability: 'wisdom', isProficient: true, isExpertise: false },
    { ability: 'charisma', isProficient: true, isExpertise: false },
  ],
  skills: [
    { name: 'Medicine', ability: 'wisdom', isProficient: true, isExpertise: true },
    { name: 'Insight', ability: 'wisdom', isProficient: true, isExpertise: false },
  ],
  proficiencies: ['Medicine', 'Insight'],
  languages: ['Common', 'Celestial'],
  equipment: ['Holy symbol', 'Robes', 'Herbal kit'],
  inventory: ['Healing salves (6)', 'Blessed water (2)', 'Old tome'],
  initialSuggestions: MOCK_INITIAL_SUGGESTIONS,
};

/**
 * Builds a minimal mock agent pipeline VM so the sandbox's ChatViewModel can
 * run a turn and surface post-turn suggestion chips (AC-3). It delegates the
 * actual GM generation to the pipeline's `mainGenerator` and appends a
 * suggestion-chips result to `results`, which ChatViewModel.sendMessage reads
 * via `_applySuggestionChips`.
 */
const createMockPipelineViewModel = (): AgentPipelineViewModelInterface => {
  const results: AgentRunResult[] = [];
  return {
    hudState: {
      isRunning: false,
      currentPhase: null,
      currentAgent: null,
      results,
      thoughtBubbles: [],
      showDrawer: false,
      enabledAgents: [],
    },
    isRunning: false,
    currentPhase: null,
    currentAgent: null,
    results,
    thoughtBubbles: [],
    showDrawer: false,
    toggleDrawer: () => {},
    toggleAgent: () => {},
    isAgentEnabled: () => false,
    availableAgents: [],
    clearResults: () => {
      results.length = 0;
    },
    runPipeline: async ({ mainGenerator }) => {
      const response = await mainGenerator('');
      results.push({
        agentId: SUGGESTION_CHIPS_AGENT_ID,
        phase: 'post',
        success: true,
        output: { type: 'suggestion_chips', chips: MOCK_INITIAL_SUGGESTIONS },
        durationMs: 0,
      });
      return response;
    },
  };
};

export class ChatC420SandboxViewModel extends ChatViewModel {
  override async initialize(): Promise<void> {
    // Inject mock NPC directly — bypass Firestore lookup
    this.npc = { ...MOCK_NPC };

    // Build an EMPTY chat so the starter-chip empty state renders (AC-2)
    this.chat = {
      id: 'dev-chat-c420',
      npcId: MOCK_NPC.id,
      npcName: MOCK_NPC.name,
      npcAvatarUrl: MOCK_NPC.avatarUrl,
      uid: 'dev-user-mock',
      visibility: 'private',
      messages: [],
      messageCount: 0,
      affection: 0,
      stats: {},
    };

    chatService.setMessages([]);
    this.showGreeting = true;

    await super.initialize();
  }
}

export const getChatC420SandboxViewModel = (
  options: ChatViewModelOptions,
): ChatC420SandboxViewModel =>
  new ChatC420SandboxViewModel({
    ...options,
    agentPipelineViewModel: createMockPipelineViewModel(),
  });
