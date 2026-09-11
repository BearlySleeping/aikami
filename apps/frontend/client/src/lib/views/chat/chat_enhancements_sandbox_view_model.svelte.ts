// apps/frontend/client/src/lib/views/chat/chat_enhancements_sandbox_view_model.svelte.ts
//
// Dev sandbox ViewModel for /dev/chat-enhancements.
// Overrides production ChatViewModel with mock data demonstrating
// all C-231 Rich Chat Streaming enhancements.
//
// Contract: C-231 AC-6 Dev Sandbox

import {
  ChatViewModel,
  type ChatViewModelInterface,
  type ChatViewModelOptions,
} from './chat_view_model.svelte.ts';

/** Configuration inherited from the production chat ViewModel for the enhancements sandbox. */
export type ChatEnhancementsSandboxViewModelOptions = ChatViewModelOptions;
/** Public chat ViewModel contract exposed by the enhancements sandbox. */
export type ChatEnhancementsSandboxViewModelInterface = ChatViewModelInterface;

// ── Mock data ─────────────────────────────────────────────────────────────

const MOCK_MESSAGES = [
  {
    id: 'mock-msg-1',
    text: 'Greetings, traveler! What brings you to these ancient halls?',
    sender: 'ai' as const,
    timestamp: new Date(Date.now() - 300000),
  },
  {
    id: 'mock-msg-2',
    text: 'I seek the legendary Sword of Aethra. Can you help me?',
    sender: 'user' as const,
    timestamp: new Date(Date.now() - 240000),
  },
  {
    id: 'mock-msg-3',
    text: 'Ah, the Sword of Aethra... A perilous quest indeed. Many have sought it, few have returned.',
    sender: 'ai' as const,
    timestamp: new Date(Date.now() - 180000),
  },
  {
    id: 'mock-msg-4',
    text: 'The sword lies deep within the Crystal Caverns, guarded by the ancient dragon Vyrax.',
    sender: 'ai' as const,
    timestamp: new Date(Date.now() - 170000),
  },
];

// ── Dev ViewModel ─────────────────────────────────────────────────────────

class ChatEnhancementsSandboxViewModel extends ChatViewModel {
  constructor(options: ChatViewModelOptions) {
    super(options);
    this._seedAlternatives();
  }

  /**
   * Seeds the injected message-branch capability with alternatives for the
   * sandbox demo. Creates 3 alternatives for mock-msg-3 (the first AI
   * response about the quest).
   */
  private _seedAlternatives(): void {
    this._messageBranch.addAlternative({
      messageId: 'mock-msg-3',
      currentText: MOCK_MESSAGES[2].text,
      newText:
        'The Sword of Aethra... I have not heard that name spoken in a hundred years. You are bold to seek it.',
    });
    this._messageBranch.addAlternative({
      messageId: 'mock-msg-3',
      currentText:
        'The Sword of Aethra... I have not heard that name spoken in a hundred years. You are bold to seek it.',
      newText:
        'Many have asked me about that blade. None have lived to wield it. But perhaps you are different.',
    });
    this._messageBranch.addAlternative({
      messageId: 'mock-msg-4',
      currentText: MOCK_MESSAGES[3].text,
      newText:
        'The Crystal Caverns lie beneath the Frozen Peaks. Vyrax has guarded the sword for three centuries. You will need more than steel.',
    });
  }

  override async initialize(): Promise<void> {
    // Skip real backend calls — directly set mock state
    // guard-ignore lint/type-safety/casting: sandbox VM accessing private service internals for dev visualization
    (this as unknown as Record<string, unknown>).npc = {
      id: 'dev-npc-wyrm',
      name: 'Loremaster Wyrm',
      avatarUrl: 'https://placehold.co/400x400/2a1a5a/c9d8f8?text=Wyrm',
      race: 'Dragonborn',
      class: 'Lorekeeper',
      level: 15,
      personalityTraits: 'Wise, cryptic, occasionally impatient with foolish questions.',
      background: 'Keeper of the ancient archives.',
    };

    // guard-ignore lint/type-safety/casting: sandbox VM accessing private service internals for dev visualization
    (this as unknown as Record<string, unknown>).chatData = {
      affection: 5,
      stats: {},
    };
    (this as unknown as Record<string, unknown>).showGreeting = false; // guard-ignore lint/type-safety/casting: sandbox VM accessing private service internals for dev visualization

    this._chat.setMessages(
      MOCK_MESSAGES.map((m) => ({
        id: m.id,
        text: m.text,
        sender: m.sender,
        createdAt: m.timestamp,
      })),
    );

    return Promise.resolve();
  }

  override async sendMessage(text: string): Promise<void> {
    // Add user message locally
    this._chat.addMessage({
      id: crypto.randomUUID(),
      text,
      sender: 'user',
      timestamp: new Date(),
    });

    this.inputText = '';

    this._chat.setTyping(true);
    await new Promise((resolve) => setTimeout(resolve, 800));
    this._chat.setTyping(false);

    const mockReply =
      'Interesting... The ancient scrolls speak of such things. Let me consult my records.';
    this._chat.appendAIMessage(mockReply);

    if (this.streamingTtsEnabled) {
      this._chunker.feed(mockReply);
      this._chunker.close();
    }
  }
}

/**
 * Builds the enhancements sandbox from explicit capabilities. Production
 * wiring lives in ./chat_enhancements_sandbox_composition.ts.
 */
export const createChatEnhancementsSandboxViewModel = (
  options: ChatViewModelOptions,
): ChatViewModelInterface => ChatEnhancementsSandboxViewModel.create(options);
