// apps/frontend/client/src/lib/views/chat/chat_c420_sandbox_view_model.svelte.ts
//
// Dev sandbox override for C-420 — mounts the PRODUCTION ChatView with an
// EMPTY chat (no messages) so the starter-chip empty state (AC-2) and the
// model-chip-after-turn behaviour (AC-3) can be exercised and screenshotted.
// Dev-only; never imported from production code.
import type { NpcData } from '@aikami/types';
import { chatService } from '$services';
import { ChatViewModel, type ChatViewModelOptions } from './chat_view_model.svelte.ts';

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
): ChatC420SandboxViewModel => new ChatC420SandboxViewModel(options);
