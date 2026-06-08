// apps/frontend/pwa/src/lib/views/chat/chat-view-model.svelte.ts

import { createEngineBridge } from '@aikami/frontend/engine';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { createStreamBuffer, parseLine, parseStreamChunk, type StreamBuffer } from '@aikami/parser';
import type { ChatData, MessageData, NpcData } from '@aikami/types';
import {
  aiService,
  authService,
  type ChatMessage,
  chatService,
  diceService,
  imageGenerationService,
  npcChatService,
  npcService,
  ttsService,
} from '$services';

export type ChatViewModelOptions = BaseViewModelOptions & {
  /** The chat document ID to load. */
  chatId: string;
  /** The NPC ID (from URL query param). If omitted, resolved from the chat document. */
  npcId?: string;
  /** Entity ID of the NPC in the game engine (for expression macros). */
  gameEntityId?: number;
};

export type ChatViewModelInterface = BaseViewModelInterface & {
  readonly npc?: NpcData;
  readonly chatData?: {
    affection: number;
    stats: Record<string, unknown>;
    backgroundImageUrl?: string;
  };
  readonly isLoading: boolean;
  readonly isSending: boolean;
  readonly isTyping: boolean;
  readonly chatError: string | undefined;
  readonly errorMessage: string | undefined;
  readonly messages: ChatMessage[];
  readonly showGreeting: boolean;
  readonly isGeneratingImage: boolean;
  readonly isPlayingTts: boolean;
  readonly backgroundImageUrl: string | undefined;
  loadChatHistory(chat: ChatData): Promise<void>;
  sendMessage(text: string): Promise<void>;
  editMessage(messageId: string, newText: string): Promise<void>;
  deleteMessage(messageId: string): Promise<void>;
  regenerateMessage(messageId: string): Promise<void>;
  generateImage(prompt: string): Promise<string>;
  playTts(messageId: string): Promise<void>;
  stopTts(): void;
  attachFile(messageId: string, file: File): Promise<void>;
  updateAffection(change: number): Promise<void>;
  rollPerception(): Promise<{ roll: number; total: number }>;
  rollPersuasion(context?: string): Promise<{ roll: number; total: number }>;
  generateBackground(prompt?: string): Promise<void>;
  dismissGreeting(): void;
  clearChat(): void;
};

class ChatViewModel extends BaseViewModel<ChatViewModelOptions> implements ChatViewModelInterface {
  npc: NpcData | undefined = $state();
  chat: ChatData | undefined = $state();
  errorMessage: string | undefined = $state();

  private _chatId: string;
  private _npcId: string | undefined;

  showGreeting = $state(true);
  chatData = $state<
    { affection: number; stats: Record<string, unknown>; backgroundImageUrl?: string } | undefined
  >();
  isGeneratingImage = $state(false);
  isPlayingTts = $state(false);
  backgroundImageUrl = $state<string | undefined>();

  /** The NPC's entity ID in the game engine, for expression macro routing. */
  private gameEntityId: number | undefined;

  constructor(options: ChatViewModelOptions) {
    super(options);
    this._chatId = options.chatId;
    this._npcId = options.npcId;
    this.gameEntityId = options.gameEntityId;
  }

  override async initialize(): Promise<void> {
    const chatDataLookup = await npcChatService.getChatById({ chatId: this._chatId });
    if (!chatDataLookup) {
      this.error('Chat not found', { chatId: this._chatId });
      this.errorMessage = 'Chat not found';
      return super.initialize();
    }

    const resolvedNpcId = this._npcId ?? (chatDataLookup as { npcId?: string }).npcId;
    if (resolvedNpcId) {
      this.npc = await npcService.get({ npcId: resolvedNpcId });
      if (!this.npc) {
        this.error('NPC not found', { npcId: resolvedNpcId });
        this.errorMessage = 'NPC not found';
        return super.initialize();
      }
    }

    const chatData: ChatData = {
      id: chatDataLookup.id,
      npcId: (chatDataLookup as { npcId?: string }).npcId ?? '',
      npcName: (chatDataLookup as { npcName?: string }).npcName ?? '',
      npcAvatarUrl: (chatDataLookup as { npcAvatarUrl?: string }).npcAvatarUrl,
      uid: (chatDataLookup as { uid?: string }).uid ?? '',
      visibility: (chatDataLookup as { visibility?: 'private' | 'public' }).visibility ?? 'private',
      messages: (chatDataLookup as { messages?: MessageData[] }).messages ?? [],
      messageCount: (chatDataLookup as { messageCount?: number }).messageCount ?? 0,
      affection: (chatDataLookup as { affection?: number }).affection ?? 0,
      stats: (chatDataLookup as { stats?: Record<string, unknown> }).stats ?? {},
      backgroundImageUrl: (chatDataLookup as { backgroundImageUrl?: string }).backgroundImageUrl,
    };
    this.chat = chatData;
    await this.loadChatHistory(chatData);

    return super.initialize();
  }

  get isLoading() {
    return chatService.isLoading;
  }
  get isSending() {
    return chatService.isSending;
  }
  get isTyping() {
    return chatService.isTyping;
  }
  get chatError() {
    return this.errorMessage ?? chatService.errorMessage;
  }
  get messages(): ChatMessage[] {
    const msgs = this.chat?.messages ?? [];
    return msgs.map((msg) => {
      const createdAt = msg.createdAt as unknown;
      let timestamp: Date;
      if (
        typeof createdAt === 'object' &&
        createdAt !== null &&
        'toDate' in createdAt &&
        typeof (createdAt as { toDate: () => Date }).toDate === 'function'
      ) {
        timestamp = (createdAt as { toDate: () => Date }).toDate();
      } else if (createdAt instanceof Date) {
        timestamp = createdAt;
      } else {
        timestamp = new Date();
      }
      return {
        id: msg.id || crypto.randomUUID(),
        text: msg.text,
        sender: msg.sender,
        timestamp,
      };
    });
  }

  async loadChatHistory(chat: ChatData): Promise<void> {
    this.chatData = {
      affection: chat.affection ?? 0,
      stats: chat.stats ?? {},
      backgroundImageUrl: chat.backgroundImageUrl,
    };
    this.backgroundImageUrl = chat.backgroundImageUrl;
    chatService.setMessages(chat.messages as unknown as MessageData[]);
    this.showGreeting = (chat.messages?.length ?? 0) === 0;
  }

  async sendMessage(text: string): Promise<void> {
    if (!this.npc) {
      return;
    }
    this.showGreeting = false;

    // ── Parser intercept: slash commands ──
    if (text.startsWith('/')) {
      const parsed = parseLine(text);
      if (parsed.command) {
        const { command, args } = parsed.command;
        this.debug('command detected', { command, args });

        // Dispatch to game engine bridge
        const bridge = createEngineBridge();
        bridge.executeCommand(command, args);

        // Echo a local system message into the chat
        chatService.addMessage({
          id: crypto.randomUUID(),
          text: `Command: ${parsed.command.raw}`,
          sender: 'ai',
          timestamp: new Date(),
        });
        return; // Do NOT send to AI
      }
    }

    // ── Normal AI message flow ──
    chatService.setSending(true);
    chatService.setTyping(true);
    chatService.setError(undefined);
    const userMessage = {
      id: crypto.randomUUID(),
      text,
      sender: 'user' as const,
      timestamp: new Date(),
    };
    chatService.addMessage(userMessage);
    await this.saveMessage(text, 'user');

    // Stream buffer for incremental macro parsing (future streaming use)
    const streamBuf: StreamBuffer = createStreamBuffer();

    try {
      const response = await aiService.sendMessageToAI(text, this.npc ?? undefined);
      if (response) {
        // Process macros from the AI response
        const chunkResult = parseStreamChunk(response, streamBuf);

        // Dispatch any macros to the engine bridge
        const bridge = createEngineBridge();
        for (const macro of chunkResult.macros) {
          this.debug('macro in response', {
            name: macro.name,
            args: macro.args,
            entityId: this.gameEntityId,
          });
          bridge.triggerMacro(macro.name, macro.args, this.gameEntityId);
        }

        // Show clean text (macros stripped) in the UI
        chatService.appendAIMessage(chunkResult.displayText);
        await this.saveMessage(chunkResult.displayText, 'ai');
      }
    } catch {
      chatService.setError('Failed to get response from AI');
    } finally {
      chatService.setSending(false);
      chatService.setTyping(false);
    }
  }

  async editMessage(messageId: string, newText: string): Promise<void> {
    const msgs = [...chatService.messages] as unknown as MessageData[];
    const idx = msgs.findIndex((m) => m.id === messageId);
    if (idx === -1) {
      return;
    }
    msgs[idx] = { ...msgs[idx], text: newText };
    chatService.setMessages(msgs);
    await this.persistMessages(msgs);
  }

  async deleteMessage(messageId: string): Promise<void> {
    const msgs = (chatService.messages as unknown as MessageData[]).filter(
      (m) => m.id !== messageId,
    );
    chatService.setMessages(msgs);
    await this.persistMessages(msgs);
  }

  async regenerateMessage(messageId: string): Promise<void> {
    const msgs = [...chatService.messages] as unknown as MessageData[];
    const idx = msgs.findIndex((m) => m.id === messageId);
    if (idx === -1 || msgs[idx].sender !== 'ai') {
      return;
    }
    chatService.setTyping(true);
    try {
      const context = msgs
        .slice(0, idx)
        .map((m) => m.text)
        .join('\n');
      const response = await aiService.sendMessageToAI(
        `Regenerate your response. Context: ${context}`,
        this.npc,
      );
      if (response) {
        msgs[idx] = { ...msgs[idx], text: response };
        chatService.setMessages(msgs);
        await this.persistMessages(msgs);
      }
    } catch {
      chatService.setError('Failed to regenerate message');
    } finally {
      chatService.setTyping(false);
    }
  }

  async generateImage(prompt: string): Promise<string> {
    this.isGeneratingImage = true;
    try {
      return (await imageGenerationService.generateImage({ prompt })).url;
    } finally {
      this.isGeneratingImage = false;
    }
  }

  async playTts(messageId: string): Promise<void> {
    const msg = (chatService.messages as unknown as MessageData[]).find((m) => m.id === messageId);
    if (!msg) {
      return;
    }
    this.isPlayingTts = true;
    try {
      await ttsService.speak({ text: msg.text });
    } finally {
      this.isPlayingTts = false;
    }
  }

  stopTts(): void {
    ttsService.stop();
    this.isPlayingTts = false;
  }

  async attachFile(messageId: string, file: File): Promise<void> {
    const msgs = [...chatService.messages] as unknown as MessageData[];
    const idx = msgs.findIndex((m) => m.id === messageId);
    if (idx === -1) {
      return;
    }
    const url = URL.createObjectURL(file);
    msgs[idx] = {
      ...msgs[idx],
      attachments: [...(msgs[idx].attachments ?? []), { type: 'file', url, name: file.name }],
    };
    chatService.setMessages(msgs);
    await this.persistMessages(msgs);
  }

  async updateAffection(change: number): Promise<void> {
    if (!this.chatData) {
      return;
    }
    this.chatData = { ...this.chatData, affection: (this.chatData.affection ?? 0) + change };
  }

  async rollPerception(): Promise<{ roll: number; total: number }> {
    const wisdom = 3;
    const result = diceService.rollD20(wisdom);
    chatService.addMessage({
      id: crypto.randomUUID(),
      text: `Perception check: rolled ${result.natural} + ${wisdom} = ${result.total}`,
      sender: 'ai',
      timestamp: new Date(),
    });
    return { roll: result.natural, total: result.total };
  }

  async rollPersuasion(context?: string): Promise<{ roll: number; total: number }> {
    const charisma = 3;
    const result = diceService.rollD20(charisma);
    const ctx = context ? ` Attempting to persuade: ${context}` : '';
    chatService.addMessage({
      id: crypto.randomUUID(),
      text: `Persuasion check: rolled ${result.natural} + ${charisma} = ${result.total}${ctx}`,
      sender: 'ai',
      timestamp: new Date(),
    });
    return { roll: result.natural, total: result.total };
  }

  async generateBackground(prompt?: string): Promise<void> {
    this.isGeneratingImage = true;
    try {
      const bg = prompt ?? `Fantasy chat background, ${this.npc?.name ?? 'mysterious'} atmosphere`;
      const result = await imageGenerationService.generateImage({ prompt: bg });
      this.backgroundImageUrl = result.url;
      if (this.chatData) {
        this.chatData.backgroundImageUrl = result.url;
      }
    } finally {
      this.isGeneratingImage = false;
    }
  }

  dismissGreeting(): void {
    this.showGreeting = false;
  }

  clearChat(): void {
    chatService.clear();
    this.showGreeting = true;
  }

  private async saveMessage(text: string, sender: 'user' | 'ai'): Promise<void> {
    const uid = authService.uid;
    const chatId = this.chat?.id;
    if (!uid || !this.npc || !chatId) {
      this.debug('saveMessage: missing uid, npc, or chatId');
      return;
    }
    try {
      await npcChatService.addMessage({
        chatId,
        uid,
        npcId: this.npc.id,
        message: text,
        sender,
      });
      this.debug('saveMessage: success');
    } catch (error) {
      this.error('saveMessage failed', error);
    }
  }

  private async persistMessages(msgs: MessageData[]): Promise<void> {
    const uid = authService.uid;
    if (!uid || !this.npc) {
      return;
    }
    try {
      const chat = await npcChatService.getChat({ uid, npcId: this.npc.id });
      if (chat?.id) {
        await npcChatService.updateChat({ chatId: chat.id, messages: msgs });
      }
    } catch {}
  }
}

export const getChatViewModel = (options: ChatViewModelOptions): ChatViewModelInterface =>
  new ChatViewModel(options);
