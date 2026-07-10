// apps/frontend/client/src/lib/views/chat/chat_modes_sandbox_view_model.svelte.ts
//
// Dev sandbox ViewModel for /dev/chat-modes — demonstrates the full
// address mode system (Scene/Party/GM toggle, impersonation drafting,
// party member voice distinction).
//
// NEVER import this file from production code or non-(dev) routes.
//
// Contract: C-241 Chat Modes Address System

import type { NpcData } from '@aikami/types';
import {
  type ChatMessage,
  chatService,
  type TextChatMessage,
  textGenerationService,
} from '$services';
import { ChatViewModel, type ChatViewModelOptions } from './chat_view_model.svelte.ts';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_NPC: NpcData = {
  id: 'dev-npc-thalia',
  name: 'Thalia Moonshadow',
  race: 'Wood Elf',
  class: 'Ranger',
  level: 8,
  experiencePoints: 56000,
  hitPoints: 54,
  hitPointsMax: 54,
  temporaryHitPoints: 0,
  armorClass: 16,
  speed: 35,
  alignment: 'Chaotic Good',
  isFriendly: true,
  visibility: 'private' as const,
  avatarUrl: 'https://placehold.co/400x400/2a5a1a/c9f8d8?text=Thalia',
  personalityTraits:
    'Thalia speaks with a quick wit and a dry sense of humor. She is fiercely loyal to her companions but trusts no authority. Her voice carries the cadence of the deep woods — measured, quiet, but never timid.',
  background:
    'A scout of the Emerald Vigil, Thalia has spent decades patrolling the borderlands between the mortal realm and the Feywild. She lost her patrol to a shadow incursion and now travels alone, searching for survivors.',
  notes: 'Knows hidden paths through the Darkwood. Distrusts mages of any kind.',
  savingThrows: [
    { ability: 'dexterity', isProficient: true, isExpertise: false },
    { ability: 'strength', isProficient: true, isExpertise: false },
  ],
  skills: [
    { name: 'Stealth', ability: 'dexterity', isProficient: true, isExpertise: true },
    { name: 'Survival', ability: 'wisdom', isProficient: true, isExpertise: false },
    { name: 'Perception', ability: 'wisdom', isProficient: true, isExpertise: false },
  ],
  proficiencies: ['Stealth', 'Survival', 'Perception'],
  languages: ['Common', 'Elvish', 'Sylvan'],
  equipment: ['Longbow', 'Shortswords (2)', 'Leather armor', 'Explorer pack'],
  inventory: ['Map of the borderlands', 'Healing potion (2)', 'Rations (5)', 'Cloak of elvenkind'],
};

const MOCK_SEED_MESSAGES: ChatMessage[] = [
  {
    id: 'dev-seed-a',
    text: "You there — keep your voice down. The shadows have ears in these woods. I'm Thalia. What business brings you to the borderlands?",
    sender: 'ai',
    timestamp: new Date(Date.now() - 180000),
  },
  {
    id: 'dev-seed-b',
    text: "I'm looking for passage through the Darkwood. I heard there's a ranger who knows the hidden paths.",
    sender: 'user',
    timestamp: new Date(Date.now() - 120000),
  },
  {
    id: 'dev-seed-c',
    text: "You heard right. But the Darkwood isn't what it used to be. Something's stirring in the deep shadows. I've lost good people to it.",
    sender: 'ai',
    timestamp: new Date(Date.now() - 60000),
  },
];

const MOCK_BOT_REPLIES = [
  'The path through the Darkwood... it changes with the moon, you understand. I can guide you, but you must follow my lead exactly.',
  'Trust is earned in the borderlands, not given. Tell me — when you look into the dark between the trees, what do you see?',
  'A mage? No. I walk with the wind and the wolf, not with spellbooks and chanting. Keep your magic to yourself.',
  'The Emerald Vigil... we were twelve. Now I am one. If you see a patrol crest with a green leaf on black, bring it to me.',
];

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class ChatModesSandboxViewModel extends ChatViewModel {
  /** When true, outgoing messages use mock replies instead of LLM. */
  useMockReplies = $state(true);

  /** Counter for cycling through mock bot replies. */
  private _replyIndex = 0;

  override async initialize(): Promise<void> {
    // Inject mock NPC
    this.npc = { ...MOCK_NPC };

    // Build mock ChatData
    this.chat = {
      id: 'dev-chat-modes-mock',
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
      affection: 50,
      stats: {},
    };

    chatService.setMessages(
      MOCK_SEED_MESSAGES.map((m) => ({
        id: m.id,
        text: m.text,
        sender: m.sender,
        createdAt: m.timestamp,
      })),
    );
    this.showGreeting = false;

    // Pre-enable impersonation quick button for the sandbox
    this.impersonationConfig = {
      quickButtonEnabled: true,
      promptTemplate: '',
      skipAgents: false,
    };

    await super.initialize();
  }

  override async sendMessage(text: string): Promise<void> {
    // Let the parent handle slash commands (including /impersonate)
    if (text.startsWith('/')) {
      await super.sendMessage(text);
      return;
    }

    if (this.useMockReplies) {
      await this._sendMockReply(text);
      return;
    }

    await this._sendLiveReply(text);
  }

  /**
   * Sends a mock reply and injects a fake persona for impersonation testing.
   * The mock persona has a distinct name + traits so the sandbox can verify
   * impersonation drafting works without needing a real Firestore persona.
   */
  private async _sendMockReply(text: string): Promise<void> {
    chatService.setSending(true);
    chatService.setTyping(true);
    chatService.setError(undefined);

    chatService.addMessage({
      id: crypto.randomUUID(),
      text,
      sender: 'user',
      timestamp: new Date(),
    });

    // Simulate typing delay then show mock reply
    setTimeout(() => {
      const reply = MOCK_BOT_REPLIES[this._replyIndex % MOCK_BOT_REPLIES.length] ?? '...';
      this._replyIndex++;

      chatService.appendAIMessage('...');

      setTimeout(() => {
        const msgs = [...chatService.messages];
        const lastIdx = msgs.length - 1;
        if (lastIdx >= 0 && msgs[lastIdx]?.sender === 'ai' && msgs[lastIdx]?.text === '...') {
          chatService.updateLastAIMessage(reply);
        } else {
          chatService.appendAIMessage(reply);
        }
        chatService.setTyping(false);
        chatService.setSending(false);
      }, 800);
    }, 400);
  }

  /**
   * Live LLM reply via textGenerationService.
   */
  private async _sendLiveReply(text: string): Promise<void> {
    chatService.setSending(true);
    chatService.setTyping(true);
    chatService.setError(undefined);

    chatService.addMessage({
      id: crypto.randomUUID(),
      text,
      sender: 'user',
      timestamp: new Date(),
    });

    const systemPrompt = [
      `You are ${MOCK_NPC.name}, a ${MOCK_NPC.race} ${MOCK_NPC.class}.`,
      `Personality: ${MOCK_NPC.personalityTraits}`,
      `Background: ${MOCK_NPC.background}`,
      'Stay in character. Respond in 1–3 sentences.',
    ].join('\n');

    const messages: TextChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...chatService.messages
        .slice(-8)
        .filter((m) => m.sender !== 'ai' || m.text !== '...')
        .map((m) => ({
          role: (m.sender === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
          content: m.text,
        })),
    ];

    let accumulated = '';

    try {
      await textGenerationService.streamChat({
        messages,
        onChunk: (chunk: string) => {
          accumulated += chunk;
          chatService.updateLastAIMessage(accumulated);
        },
      });
      if (!accumulated) {
        chatService.appendAIMessage('*No response*');
      }
    } catch {
      chatService.setError('AI error');
      chatService.appendAIMessage('*Error generating response*');
    } finally {
      chatService.setSending(false);
      chatService.setTyping(false);
    }
  }
}

/**
 * Factory function — returns a ChatModesSandboxViewModel.
 * Only use in (dev) routes or tests.
 */
export const getChatModesSandboxViewModel = (
  options: ChatViewModelOptions,
): ChatModesSandboxViewModel => {
  return new ChatModesSandboxViewModel(options);
};
