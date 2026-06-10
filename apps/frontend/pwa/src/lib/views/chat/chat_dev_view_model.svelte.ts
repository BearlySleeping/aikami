// apps/frontend/pwa/src/lib/views/chat/chat_dev_view_model.svelte.ts
//
// Dev sandbox override — injects mock chat data without hitting the AI backend.
// NEVER import this file from production code or non-(dev) routes.

import type { NpcData } from '@aikami/types';
import { type ChatMessage, chatService } from '$services';
import { ChatViewModel, type ChatViewModelOptions } from './chat_view_model.svelte.ts';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_NPC: NpcData = {
  id: 'dev-npc-eldrin',
  name: 'Eldrin Starweaver',
  race: 'High Elf',
  class: 'Wizard',
  level: 12,
  experiencePoints: 84000,
  hitPoints: 62,
  hitPointsMax: 62,
  temporaryHitPoints: 0,
  armorClass: 15,
  speed: 30,
  alignment: 'Neutral Good',
  isFriendly: true,
  visibility: 'private' as const,
  avatarUrl: 'https://placehold.co/400x400/1a2a5a/c9d8f8?text=Eldrin',
  personalityTraits:
    'Eldrin speaks in riddles and metaphors, often referencing constellations and forgotten lore. He has a dry, scholarly wit.',
  background:
    'Once the Court Astrologer to a fallen elven kingdom, Eldrin now wanders the realms seeking fragments of a shattered prophecy.',
  notes: 'Knows the location of the Starforge Vault. Wary of dragonborn.',
  savingThrows: [
    { ability: 'intelligence', isProficient: true, isExpertise: false },
    { ability: 'wisdom', isProficient: true, isExpertise: false },
  ],
  skills: [
    { name: 'Arcana', ability: 'intelligence', isProficient: true, isExpertise: true },
    { name: 'History', ability: 'intelligence', isProficient: true, isExpertise: false },
    { name: 'Insight', ability: 'wisdom', isProficient: true, isExpertise: false },
  ],
  proficiencies: ['Arcana', 'History', 'Insight'],
  languages: ['Common', 'Elvish', 'Draconic', 'Celestial'],
  equipment: ['Spellbook', 'Arcane focus (crystal orb)', 'Robes', 'Component pouch'],
  inventory: ['Star charts (7)', 'Celestial sextant', 'Vial of starlight', 'Parchment (12)'],
};

const MOCK_BOT_REPLIES = [
  'Ah, the stars have much to say about that... The constellation of the Dragon stirs in the eastern sky — a portent of change, or perhaps destruction.',
  'Interesting. You remind me of a young paladin I once advised. He too asked questions that seemed simple, yet held the weight of kingdoms.',
  'Forgive my hesitation. Some memories are like old wounds — they ache when prodded. But yes, I will tell you what I know of the Shadowmere lineage.',
  'The prophecy speaks of seven keys, scattered across the seven fallen cities. I have found three. The fourth lies beneath the sands of Khet, guarded by something ancient and terribly patient.',
  'Be careful with that question, mortal. Some truths, once learned, cannot be unlearned. The entity that shattered the moon still watches.',
];

const MOCK_SEED_MESSAGES: ChatMessage[] = [
  {
    id: 'dev-seed-1',
    text: 'Greetings, traveler. I am Eldrin Starweaver, formerly of the Celestial Court. What brings you to my observatory on this starless night?',
    sender: 'ai',
    timestamp: new Date(Date.now() - 120000),
  },
  {
    id: 'dev-seed-2',
    text: "I've heard you know about the Shadowmere lineage. I'm trying to trace my ancestry.",
    sender: 'user',
    timestamp: new Date(Date.now() - 60000),
  },
  {
    id: 'dev-seed-3',
    text: 'The Shadowmere name carries weight, even among the stars. Tell me — what do you already know of your family, and I shall fill in the gaps that the heavens have revealed to me.',
    sender: 'ai',
    timestamp: new Date(Date.now() - 30000),
  },
];

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class ChatDevViewModel extends ChatViewModel {
  // ── State ──────────────────────────────────────────────────────────────

  /** When true, outgoing messages are delayed by 2 seconds. */
  simulateLatency = $state(false);

  /** Whether the network error state is currently active. */
  private _networkErrorActive = false;

  /** Counter for cycling through mock bot replies. */
  private _replyIndex = 0;

  // ── Lifecycle ─────────────────────────────────────────────────────────

  override async initialize(): Promise<void> {
    // Inject mock NPC directly — bypass Firestore lookup
    this.npc = { ...MOCK_NPC };

    // Build a minimal mock ChatData so the view renders
    this.chat = {
      id: 'dev-chat-mock',
      npcId: MOCK_NPC.id,
      npcName: MOCK_NPC.name,
      npcAvatarUrl: MOCK_NPC.avatarUrl,
      uid: 'dev-user-mock',
      visibility: 'private',
      messages: MOCK_SEED_MESSAGES.map((m) => ({
        id: m.id,
        text: m.text,
        sender: m.sender,
        createdAt: m.timestamp,
      })),
      messageCount: MOCK_SEED_MESSAGES.length,
      affection: 45,
      stats: {},
    };

    // Seed chat service with pre-written messages
    chatService.setMessages(
      MOCK_SEED_MESSAGES.map((m) => ({
        id: m.id,
        text: m.text,
        sender: m.sender,
        createdAt: m.timestamp,
      })),
    );
    this.showGreeting = false;

    await super.initialize();
  }

  // ── Send (dev override) ───────────────────────────────────────────────

  override async sendMessage(text: string): Promise<void> {
    // Block sends when network error is toggled
    if (this._networkErrorActive) {
      chatService.setError('⚠️ Simulated network error — AI service unreachable.');
      return;
    }

    chatService.setSending(true);

    // Apply artificial latency when toggle is on
    if (this.simulateLatency) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    // Append user message locally (bypasses backend persistence)
    chatService.addMessage({
      id: crypto.randomUUID(),
      text,
      sender: 'user',
      timestamp: new Date(),
    });

    chatService.setSending(false);

    // Note: the bot does NOT auto-reply in dev sandbox.
    // Use the "Simulate Bot Reply" action to inject a response.
  }

  // ── Dev-only methods ──────────────────────────────────────────────────

  /**
   * Injects a mock AI response with a simulated streaming delay.
   * Shows the typing indicator briefly, then reveals the full message.
   */
  simulateBotReply(): void {
    if (this._networkErrorActive) {
      chatService.setError('⚠️ Cannot reply — network error is active.');
      return;
    }

    const reply = MOCK_BOT_REPLIES[this._replyIndex % MOCK_BOT_REPLIES.length] ?? '...';
    this._replyIndex++;

    chatService.setTyping(true);

    // Simulate streaming: show ellipsis, then replace with full text after a delay
    setTimeout(() => {
      chatService.appendAIMessage('...');
    }, 400);

    setTimeout(() => {
      const msgs = [...chatService.messages];
      const lastIdx = msgs.length - 1;
      if (lastIdx >= 0 && msgs[lastIdx]?.sender === 'ai' && msgs[lastIdx]?.text === '...') {
        chatService.updateLastAIMessage(reply);
      } else {
        chatService.appendAIMessage(reply);
      }
      chatService.setTyping(false);
    }, 1200);
  }

  /**
   * Toggles a simulated network error state.
   * When active, sendMessage is blocked and the error banner is shown.
   * Click again to clear the error.
   */
  triggerNetworkError(): void {
    this._networkErrorActive = !this._networkErrorActive;
    if (this._networkErrorActive) {
      chatService.setError('⚠️ Simulated network error — AI service unreachable.');
      chatService.setSending(false);
      chatService.setTyping(false);
    } else {
      chatService.setError(undefined);
    }
  }
}

/**
 * Factory function — returns a ChatDevViewModel with mock data.
 * Only use in (dev) routes or tests.
 */
export const getChatDevViewModel = (options: ChatViewModelOptions): ChatDevViewModel => {
  return new ChatDevViewModel(options);
};
