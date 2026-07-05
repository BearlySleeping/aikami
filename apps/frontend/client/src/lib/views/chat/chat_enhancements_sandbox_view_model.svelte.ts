// apps/frontend/client/src/lib/views/chat/chat_enhancements_sandbox_view_model.svelte.ts
//
// Dev sandbox ViewModel for /dev/chat-enhancements.
// Overrides production ChatViewModel with mock data demonstrating
// all C-231 Rich Chat Streaming enhancements.
//
// Contract: C-231 AC-6 Dev Sandbox

import { messageBranchStore } from '$services';
import {
  ChatViewModel,
  type ChatViewModelInterface,
  type ChatViewModelOptions,
} from './chat_view_model.svelte.ts';

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

/**
 * Seeds the messageBranchStore with alternatives for the sandbox demo.
 * Creates 3 alternatives for mock-msg-3 (the first AI response about the quest).
 */
const seedAlternatives = () => {
  // Add alternatives to mock-msg-3 for swiping demo
  messageBranchStore.addAlternative({
    messageId: 'mock-msg-3',
    currentText: MOCK_MESSAGES[2].text,
    newText:
      'The Sword of Aethra... I have not heard that name spoken in a hundred years. You are bold to seek it.',
  });
  messageBranchStore.addAlternative({
    messageId: 'mock-msg-3',
    currentText:
      'The Sword of Aethra... I have not heard that name spoken in a hundred years. You are bold to seek it.',
    newText:
      'Many have asked me about that blade. None have lived to wield it. But perhaps you are different.',
  });

  // Add alternatives to mock-msg-4 for richer swiping demo
  messageBranchStore.addAlternative({
    messageId: 'mock-msg-4',
    currentText: MOCK_MESSAGES[3].text,
    newText:
      'The Crystal Caverns lie beneath the Frozen Peaks. Vyrax has guarded the sword for three centuries. You will need more than steel.',
  });
};

// ── Dev ViewModel ─────────────────────────────────────────────────────────

export const getChatEnhancementsSandboxViewModel = (
  options: ChatViewModelOptions,
): ChatViewModelInterface => {
  // Seed alternatives before creating the VM so messages getter picks them up
  seedAlternatives();

  const vm = ChatViewModel.create(options) as ChatViewModel;

  // Override initialize to skip real NPC/chat loading
  vm.initialize = async () => {
    // Skip real backend calls — directly set mock state
    (vm as unknown as Record<string, unknown>).npc = {
      id: 'dev-npc-wyrm',
      name: 'Loremaster Wyrm',
      avatarUrl: 'https://placehold.co/400x400/2a1a5a/c9d8f8?text=Wyrm',
      race: 'Dragonborn',
      class: 'Lorekeeper',
      level: 15,
      personalityTraits: 'Wise, cryptic, occasionally impatient with foolish questions.',
      background: 'Keeper of the ancient archives.',
    };

    // Load mock messages into chatService
    (vm as unknown as Record<string, unknown>).chatData = {
      affection: 5,
      stats: {},
    };
    (vm as unknown as Record<string, unknown>).showGreeting = false;

    const { chatService: cs } = await import('$services');
    cs.setMessages(
      MOCK_MESSAGES.map((m) => ({
        id: m.id,
        text: m.text,
        sender: m.sender,
        createdAt: m.timestamp,
      })),
    );

    // Override sendMessage to just append mock AI replies
    // Override sendMessage to just append mock AI replies
    vm.sendMessage = async (text: string) => {
      // Add user message locally
      cs.addMessage({
        id: crypto.randomUUID(),
        text,
        sender: 'user',
        timestamp: new Date(),
      });

      // Clear input
      vm.inputText = '';

      // Simulate brief typing delay
      cs.setTyping(true);
      await new Promise((resolve) => setTimeout(resolve, 800));
      cs.setTyping(false);

      // Add mock AI response
      const mockReply =
        'Interesting... The ancient scrolls speak of such things. Let me consult my records.';
      cs.appendAIMessage(mockReply);

      // Feed through chunker for streaming TTS (if enabled)
      if (vm.streamingTtsEnabled) {
        const chunker = (
          vm as unknown as Record<string, { feed: (t: string) => void; close: () => void }>
        )._chunker;
        chunker?.feed(mockReply);
        chunker?.close();
      }

      // Don't clear draft in mock mode — keep it for draft demo
    };

    // Mock mode: skip real init
    return Promise.resolve();
  };

  return vm;
};
