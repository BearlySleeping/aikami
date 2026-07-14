// apps/frontend/client/src/lib/views/chat/connected_chats_sandbox_view_model.svelte.ts
//
// Dev sandbox ViewModel for /dev/connected-chats — demonstrates the
// connected chats bridge: tag parsing, notes/influences management,
// OOC cross-posting, and link UI.
//
// NEVER import this file from production code or non-(dev) routes.
//
// Contract: C-244 Connected Chats Cross-Mode Bridge

import { parseBridgeTags } from '@aikami/frontend/engine';
import type { NpcData } from '@aikami/types';
import { type ChatMessage, chatService, connectedChatsService } from '$services';
import { ChatViewModel, type ChatViewModelOptions } from './chat_view_model.svelte.ts';

// ---------------------------------------------------------------------------
// Mock data — game chat
// ---------------------------------------------------------------------------

const MOCK_GAME_NPC: NpcData = {
  id: 'dev-npc-aldric',
  name: 'Aldric the Loremaster',
  race: 'Human',
  class: 'Wizard',
  level: 12,
  experiencePoints: 120000,
  hitPoints: 68,
  hitPointsMax: 68,
  temporaryHitPoints: 0,
  armorClass: 14,
  speed: 30,
  alignment: 'Lawful Neutral',
  isFriendly: true,
  visibility: 'private' as const,
  avatarUrl: 'https://placehold.co/400x400/3b2f5c/e8d5f0?text=Aldric',
  personalityTraits:
    'Aldric speaks in measured, precise sentences. He values knowledge above all else and grows impatient with ignorance. His voice is a calm baritone.',
  background:
    'Keeper of the Grand Archive for 40 years. Aldric has seen civilizations rise and fall through his reading. He now advises adventurers who seek ancient knowledge — for a price.',
  notes:
    'Knows the location of the Lost Tome of Elara. Will only share it if the party proves their worth.',
  savingThrows: [
    { ability: 'intelligence', isProficient: true, isExpertise: false },
    { ability: 'wisdom', isProficient: true, isExpertise: false },
  ],
  skills: [
    { name: 'Arcana', ability: 'intelligence', isProficient: true, isExpertise: true },
    { name: 'History', ability: 'intelligence', isProficient: true, isExpertise: true },
    { name: 'Investigation', ability: 'intelligence', isProficient: true, isExpertise: false },
  ],
  proficiencies: ['Arcana', 'History', 'Investigation'],
  languages: ['Common', 'Draconic', 'Elvish', 'Dwarvish', 'Celestial'],
  equipment: ['Spellbook', 'Quarterstaff', 'Robes of the Archmage', 'Component pouch'],
  inventory: ['Scroll of Identify', 'Potion of Mind Reading', 'Ring of Memory'],
};

const MOCK_SEED_MESSAGES: ChatMessage[] = [
  {
    id: 'dev-bridge-seed-1',
    text: 'Welcome to the Grand Archive, traveler. I sense you seek knowledge beyond the ordinary. What brings you to my study?',
    sender: 'ai',
    timestamp: new Date(Date.now() - 300000),
  },
  {
    id: 'dev-bridge-seed-2',
    text: "I'm looking for the Lost Tome of Elara. I was told you might know where it is.",
    sender: 'user',
    timestamp: new Date(Date.now() - 180000),
  },
  {
    id: 'dev-bridge-seed-3',
    text: 'Ah, the Tome of Elara... dangerous knowledge, that one. What makes you worthy of such secrets?',
    sender: 'ai',
    timestamp: new Date(Date.now() - 60000),
  },
];

const MOCK_BOT_REPLIES = [
  'The Tome of Elara lies in the Sunken Library beneath the Coral Sea. But you will need more than courage — you will need a key, and I happen to know where it is.',
  'Knowledge is neither good nor evil. It is simply... power. The Tome contains both. Are you prepared for that burden?',
  'Very well. Prove yourself by retrieving the Star-Sapphire from the Grotto of Whispers. Only then will I reveal the location of the Tome.',
  'I admire your determination, but determination without wisdom is recklessness. Tell me — what would you do with the knowledge in the Tome?',
];

// ---------------------------------------------------------------------------
// Mock data — OOC chat (simulated linked chat)
// ---------------------------------------------------------------------------

const MOCK_OOC_SEED: ChatMessage[] = [
  {
    id: 'dev-ooc-seed-1',
    text: "Welcome to your DM's study. Here you can ask meta questions, discuss strategy, or provide notes about the game world.",
    sender: 'ai',
    timestamp: new Date(Date.now() - 600000),
  },
];

const MOCK_OOC_REPLIES = [
  "That's a good question. Let me think about how that would work in the world...",
  "From a meta perspective, your character wouldn't know that, but as a player, here's what you should know...",
  'Interesting idea! Let me note that down for future sessions.',
];

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class ConnectedChatsSandboxViewModel extends ChatViewModel {
  /** When true, uses mock replies instead of LLM. */
  useMockReplies = $state(true);

  /** Whether the connected chats panel is visible. */
  showConnectedPanel = $state(false);

  /** Tag test input — user types bridge tags here. */
  tagTestInput = $state(
    '<note>The wizard is watching the party</note>I approach the desk. <influence>Make the NPC suspicious of me</influence>',
  );

  /** Last tag parse result for display. */
  tagParseResult = $state<ReturnType<typeof parseBridgeTags> | undefined>();

  /** Pre-seeded OOC chat messages (simulated linked chat). */
  oocMessages = $state<ChatMessage[]>([...MOCK_OOC_SEED]);

  /** OOC reply counter. */
  private _oocReplyIndex = 0;

  /** Reply counter for game NPC. */
  private _replyIndex = 0;

  override async initialize(): Promise<void> {
    // Inject mock NPC
    this.npc = { ...MOCK_GAME_NPC };

    // Build mock ChatData
    this.chat = {
      id: 'dev-connected-chats-game',
      npcId: MOCK_GAME_NPC.id,
      npcName: MOCK_GAME_NPC.name,
      npcAvatarUrl: MOCK_GAME_NPC.avatarUrl,
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

    await super.initialize();
  }

  // ── Chat overrides ─────────────────────────────────────────────────

  override async sendMessage(text: string): Promise<void> {
    // Parse bridge tags for preview
    this.tagParseResult = parseBridgeTags(text);
    this.debug('sandbox: tags parsed', this.tagParseResult);

    // Let parent handle slash commands
    if (text.startsWith('/')) {
      await super.sendMessage(text);
      return;
    }

    if (this.useMockReplies) {
      await this._sendMockGameReply(text);
      return;
    }

    await super.sendMessage(text);
  }

  private async _sendMockGameReply(text: string): Promise<void> {
    chatService.setSending(true);
    chatService.setTyping(true);
    chatService.setError(undefined);

    chatService.addMessage({
      id: crypto.randomUUID(),
      text,
      sender: 'user',
      timestamp: new Date(),
    });

    setTimeout(() => {
      const reply = MOCK_BOT_REPLIES[this._replyIndex % MOCK_BOT_REPLIES.length] ?? '...';
      this._replyIndex++;
      chatService.appendAIMessage(reply);
      chatService.setTyping(false);
      chatService.setSending(false);
    }, 600);
  }

  // ── Sandbox dev actions ────────────────────────────────────────────

  /** Toggles the connected chats settings panel. */
  toggleConnectedPanel(): void {
    this.showConnectedPanel = !this.showConnectedPanel;
  }

  /** Runs the tag parser on the current test input and stores the result. */
  parseTestTags(): void {
    this.tagParseResult = parseBridgeTags(this.tagTestInput);
  }

  /** Simulates cross-posting an OOC message — adds it to the OOC chat. */
  simulateOocPost(text: string): void {
    this.oocMessages = [
      ...this.oocMessages,
      {
        id: crypto.randomUUID(),
        text,
        sender: 'user',
        timestamp: new Date(),
      },
    ];

    // Auto-reply from OOC GM after short delay
    setTimeout(() => {
      const reply = MOCK_OOC_REPLIES[this._oocReplyIndex % MOCK_OOC_REPLIES.length] ?? '...';
      this._oocReplyIndex++;
      this.oocMessages = [
        ...this.oocMessages,
        {
          id: crypto.randomUUID(),
          text: reply,
          sender: 'ai',
          timestamp: new Date(),
        },
      ];
    }, 800);
  }

  /** Pre-seeds a ChatLink with demo notes and influences. */
  async seedDemoLink(): Promise<void> {
    try {
      await connectedChatsService.createLink({
        sourceChatId: 'dev-ooc-chat-mock',
        targetChatId: ConnectedChatsSandboxViewModel.DEV_CHAT_ID,
      });
      this.debug('sandbox: demo link created');
    } catch {
      this.debug('sandbox: demo link already exists or failed');
    }
  }

  /** Clears the tag test input. */
  clearTags(): void {
    this.tagTestInput = '';
    this.tagParseResult = undefined;
  }

  /** Returns the tag types found in the last parse. */
  get foundTags(): string {
    if (!this.tagParseResult) {
      return 'None';
    }
    const types: string[] = [];
    if (this.tagParseResult.notes.length > 0) {
      types.push(`${this.tagParseResult.notes.length} note(s)`);
    }
    if (this.tagParseResult.influences.length > 0) {
      types.push(`${this.tagParseResult.influences.length} influence(s)`);
    }
    if (this.tagParseResult.oocContents.length > 0) {
      types.push(`${this.tagParseResult.oocContents.length} OOC`);
    }
    return types.length > 0 ? types.join(', ') : 'None';
  }

  // ── Internal helpers ───────────────────────────────────────────────

  /** Uses the mock chat ID directly instead of redeclaring the parent's private _chatId. */
  private static readonly DEV_CHAT_ID = 'dev-connected-chats-game';
}

/**
 * Factory function — returns a ConnectedChatsSandboxViewModel.
 * Only use in (dev) routes or tests.
 */
export const getConnectedChatsSandboxViewModel = (
  options: Omit<ChatViewModelOptions, 'chatId'> & { chatId?: string },
): ConnectedChatsSandboxViewModel => {
  return new ConnectedChatsSandboxViewModel({
    ...options,
    chatId: options.chatId ?? 'dev-connected-chats-game',
  });
};
