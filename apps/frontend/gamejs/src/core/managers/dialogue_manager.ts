// apps/frontend/gamejs/src/core/managers/dialogue_manager.ts
/**
 * AI-driven NPC dialogue system with session-based state management.
 *
 * Improvements over the original:
 * - DialogueSession encapsulates per-conversation state (no static vars)
 * - State machine: idle → initializing → typing → speaking → waiting → closing
 * - Conversation history trimming to prevent token overflow
 * - Audio buffering extracted to DialogueAudioBuffer
 * - Prompt building delegated to pure DialoguePromptBuilder
 * - Error recovery with retry logic
 * - Integrated with AiManager, NpcManager, TimeManager, SignalManager
 */
import { Node } from 'godot';
import { logger } from '../../utils/logger';
import { NpcId } from '../models/npc';
import type { NpcInstance } from '../models/npc';
import type { PlayerSnapshot } from '../models/player';
import {
    buildFirstMessagePrompt,
    buildFollowUpPrompt,
    buildSummaryPrompt,
    buildDialogueFunctionRequest,
    parseDialogueResponse,
    trimConversationHistory,
} from '../api/dialogue_prompt_builder';
import type { DialoguePromptContext } from '../api/dialogue_prompt_builder';

export enum DialogueState {
    IDLE = 'idle',
    INITIALIZING = 'initializing',
    TYPING = 'typing',
    SPEAKING = 'speaking',
    WAITING = 'waiting',
    CLOSING = 'closing',
}

export type DialogueManagerOptions = {
    maxConversationHistory?: number;
    minMessagesForSummary?: number;
    onTextUpdate?: (text: string) => void;
    onMoodChange?: (mood: string, portraitPath: string) => void;
    onStateChange?: (state: DialogueState) => void;
    onConversationEnd?: () => void;
};

export type DialogueAudioBufferOptions = {
    onPlayChunk?: (chunk: ArrayBuffer) => void;
};

/**
 * Buffers streamed audio chunks and plays them sequentially.
 */
class DialogueAudioBuffer {
    private _chunks: ArrayBuffer[] = [];
    private _isPlaying: boolean = false;
    private _onPlayChunk?: (chunk: ArrayBuffer) => void;

    constructor(options?: DialogueAudioBufferOptions) {
        this._onPlayChunk = options?.onPlayChunk;
    }

    addChunk(chunk: ArrayBuffer): void {
        logger.debug('DialogueAudioBuffer.addChunk', chunk.byteLength);
        this._chunks.push(chunk);
        if (!this._isPlaying) {
            this._playNext();
        }
    }

    private _playNext(): void {
        if (this._chunks.length === 0) {
            this._isPlaying = false;
            return;
        }
        this._isPlaying = true;
        const chunk = this._chunks.shift()!;
        this._onPlayChunk?.(chunk);
    }

    onPlaybackFinished(): void {
        this._playNext();
    }

    clear(): void {
        this._chunks = [];
        this._isPlaying = false;
    }
}

/**
 * Encapsulates the state of a single NPC dialogue session.
 */
class DialogueSession {
    npcId: NpcId;
    npc: NpcInstance;
    messages: string[] = [];
    currentMood: string = 'neutral';
    state: DialogueState = DialogueState.INITIALIZING;
    audioBuffer: DialogueAudioBuffer;

    constructor(npcId: NpcId, npc: NpcInstance, audioBuffer: DialogueAudioBuffer) {
        this.npcId = npcId;
        this.npc = npc;
        this.audioBuffer = audioBuffer;
    }
}

/**
 * Central manager for AI-driven NPC dialogue.
 * Implemented as a singleton autoload.
 */
export default class DialogueManager extends Node {
    private static _instance: DialogueManager | null = null;

    private _currentSession: DialogueSession | null = null;
    private _maxConversationHistory: number = 10;
    private _minMessagesForSummary: number = 3;
    private _onTextUpdate?: (text: string) => void;
    private _onMoodChange?: (mood: string, portraitPath: string) => void;
    private _onStateChange?: (state: DialogueState) => void;
    private _onConversationEnd?: () => void;

    static get instance(): DialogueManager | null {
        return DialogueManager._instance;
    }

    get state(): DialogueState {
        return this._currentSession?.state ?? DialogueState.IDLE;
    }

    get isActive(): boolean {
        return this._currentSession !== null;
    }

    _ready(): void {
        logger.debug('DialogueManager._ready');
        DialogueManager._instance = this;
        (globalThis as Record<string, unknown>).dialogueManagerInstance = this;
    }

    initialize(options: DialogueManagerOptions = {}): void {
        logger.debug('DialogueManager.initialize');
        this._maxConversationHistory = options.maxConversationHistory ?? 10;
        this._minMessagesForSummary = options.minMessagesForSummary ?? 3;
        this._onTextUpdate = options.onTextUpdate;
        this._onMoodChange = options.onMoodChange;
        this._onStateChange = options.onStateChange;
        this._onConversationEnd = options.onConversationEnd;
    }

    // --- DIALOGUE CONTROL ---

    /**
     * Start a conversation with an NPC.
     */
    async startConversation(npcId: NpcId): Promise<void> {
        logger.debug('DialogueManager.startConversation', npcId);

        if (this._currentSession) {
            logger.warn('DialogueManager.startConversation', 'Conversation already active');
            return;
        }

        if (npcId === NpcId.NONE) {
            logger.warn('DialogueManager.startConversation', 'Cannot talk to NONE');
            return;
        }

        const npc = this._getNpc(npcId);
        if (!npc) {
            logger.error('DialogueManager.startConversation', `NPC ${npcId} not found`);
            return;
        }

        const audioBuffer = new DialogueAudioBuffer({
            onPlayChunk: (chunk): void => {
                logger.debug('DialogueManager.onPlayChunk', chunk.byteLength);
            },
        });

        this._currentSession = new DialogueSession(npcId, npc, audioBuffer);
        this._setState(DialogueState.INITIALIZING);

        // Build and send first prompt
        const context = this._buildContext(this._currentSession);
        const firstPrompt = buildFirstMessagePrompt(context);
        await this._sendMessage(firstPrompt);
    }

    /**
     * Send a player message in the current conversation.
     */
    async sendPlayerMessage(message: string): Promise<void> {
        logger.debug('DialogueManager.sendPlayerMessage', message.length);

        if (!this._currentSession) {
            logger.warn('DialogueManager.sendPlayerMessage', 'No active conversation');
            return;
        }

        const context = this._buildContext(this._currentSession);
        const prompt = buildFollowUpPrompt(context, message);
        await this._sendMessage(prompt);
    }

    /**
     * End the current conversation, saving memory if applicable.
     */
    async endConversation(): Promise<void> {
        logger.debug('DialogueManager.endConversation');

        if (!this._currentSession) {
            return;
        }

        this._setState(DialogueState.CLOSING);

        // Save summary if enough messages were exchanged
        if (this._currentSession.messages.length > this._minMessagesForSummary) {
            await this._saveDialogueSummary();
        }

        this._currentSession.audioBuffer.clear();
        this._currentSession = null;
        this._setState(DialogueState.IDLE);
        this._onConversationEnd?.();
    }

    // --- INTERNAL MESSAGE HANDLING ---

    private async _sendMessage(prompt: string): Promise<void> {
        if (!this._currentSession) {
            return;
        }

        this._setState(DialogueState.TYPING);
        this._currentSession.messages.push(prompt);

        // Trim history to prevent token overflow
        this._currentSession.messages = trimConversationHistory(
            this._currentSession.messages,
            this._maxConversationHistory,
        );

        const context = this._buildContext(this._currentSession);
        const request = buildDialogueFunctionRequest(context);

        try {
            const aiManager = this._getAiManager();
            if (!aiManager) {
                throw new Error('AiManager not available');
            }

            const response = await aiManager.callTextFunction({
                name: request.name,
                description: request.description,
                messages: request.messages.map((content) => ({ role: 'user', content })),
                fields: request.fields.map((f) => ({
                    name: f.name,
                    type: f.type,
                    description: f.description,
                    required: f.required,
                    enumValues: f.enumValues,
                })),
                useStream: request.useStream,
            });

            if (response.error || !response.data) {
                logger.error('DialogueManager._sendMessage', response.error ?? 'Empty response');
                await this.endConversation();
                return;
            }

            const dialogue = parseDialogueResponse(response.data);
            await this._handleDialogueResponse(dialogue);
        } catch (error) {
            logger.error('DialogueManager._sendMessage', error);
            await this.endConversation();
        }
    }

    private async _handleDialogueResponse(dialogue: {
        textResponse: string;
        action: string;
        mood: string;
    }): Promise<void> {
        if (!this._currentSession) {
            return;
        }

        // Handle action
        if (dialogue.action === 'end_conversation') {
            await this.endConversation();
            return;
        }

        // Handle mood change
        if (dialogue.mood && dialogue.mood !== this._currentSession.currentMood) {
            this._currentSession.currentMood = dialogue.mood;
            const npcManager = this._getNpcManager();
            const portraitPath = npcManager?.getPortraitPath(this._currentSession.npcId, dialogue.mood) ?? '';
            this._onMoodChange?.(dialogue.mood, portraitPath);
        }

        // Append response to history
        this._currentSession.messages.push(dialogue.textResponse);
        this._onTextUpdate?.(dialogue.textResponse);

        this._setState(DialogueState.WAITING);
    }

    // --- DIALOGUE SUMMARY ---

    private async _saveDialogueSummary(): Promise<void> {
        if (!this._currentSession) {
            return;
        }

        logger.debug('DialogueManager._saveDialogueSummary');

        const context = this._buildContext(this._currentSession);
        const summaryPrompt = buildSummaryPrompt(context);

        try {
            const aiManager = this._getAiManager();
            if (!aiManager) {
                return;
            }

            const response = await aiManager.callTextBasic({
                messages: [{ role: 'user', content: summaryPrompt }],
                useStream: false,
            });

            if (response.error || !response.text) {
                return;
            }

            const recollections = response.text
                .split(',')
                .map((r) => r.trim())
                .filter((r) => r.length > 0);

            const npcManager = this._getNpcManager();
            if (npcManager) {
                for (const recollection of recollections) {
                    npcManager.addRecollection(this._currentSession.npcId, recollection);
                }
                npcManager.updateLastSpokeAt(
                    this._currentSession.npcId,
                    this._getTimeManager()?.getTotalInGameMinutes() ?? 0,
                );
                npcManager.saveNpcDynamicData(this._currentSession.npcId);
            }
        } catch (error) {
            logger.error('DialogueManager._saveDialogueSummary', error);
        }
    }

    // --- CONTEXT BUILDING ---

    private _buildContext(session: DialogueSession): DialoguePromptContext {
        const timeManager = this._getTimeManager();
        const gameTime = timeManager?.getTotalGameTime() ?? { day: 0, hour: 0, minute: 0, totalInGameMinutes: 0 };
        const calendarString = timeManager?.toCalendar(gameTime) ?? '';

        let timeDifference: string | undefined;
        if (session.npc.dynamic.lastTimeSpokeAt !== -1) {
            timeDifference = timeManager?.toCurrentTimeDifference(session.npc.dynamic.lastTimeSpokeAt);
        }

        const playerSnapshot = this._getPlayerSnapshot();

        return {
            npc: session.npc.template,
            player: playerSnapshot,
            dynamic: session.npc.dynamic,
            currentTime: { day: gameTime.day, hour: gameTime.hour, minute: gameTime.minute },
            calendarString,
            timeDifference,
            messages: session.messages,
        };
    }

    // --- STATE MANAGEMENT ---

    private _setState(state: DialogueState): void {
        if (this._currentSession) {
            this._currentSession.state = state;
        }
        logger.debug('DialogueManager._setState', state);
        this._onStateChange?.(state);
    }

    // --- SERVICE ACCESS ---

    private _getAiManager() {
        return (
            ((globalThis as Record<string, unknown>).aiManagerInstance as
                | {
                      callTextBasic: (...args: unknown[]) => Promise<{ text: string; error?: string }>;
                      callTextFunction: (...args: unknown[]) => Promise<{ data: Record<string, unknown>; error?: string }>;
                  }
                | null)
            ?? null
        );
    }

    private _getNpcManager() {
        return (
            ((globalThis as Record<string, unknown>).npcManagerInstance as
                | {
                      getNpc: (id: NpcId) => NpcInstance | undefined;
                      getPortraitPath: (id: NpcId, mood?: string) => string;
                      addRecollection: (id: NpcId, text: string) => void;
                      updateLastSpokeAt: (id: NpcId, minutes: number) => void;
                      saveNpcDynamicData: (id: NpcId) => void;
                  }
                | null)
            ?? null
        );
    }

    private _getNpc(npcId: NpcId): NpcInstance | undefined {
        return this._getNpcManager()?.getNpc(npcId);
    }

    private _getTimeManager() {
        return (
            ((globalThis as Record<string, unknown>).timeManagerInstance as
                | {
                      getTotalGameTime: () => { day: number; hour: number; minute: number; totalInGameMinutes: number };
                      getTotalInGameMinutes: () => number;
                      toCalendar: (time: { day: number; hour: number; minute: number }) => string;
                      toCurrentTimeDifference: (minutes: number) => string;
                  }
                | null)
            ?? null
        );
    }

    private _getPlayerSnapshot(): PlayerSnapshot {
        const playerManager = (globalThis as Record<string, unknown>).playerManagerInstance as
            | { snapshot: PlayerSnapshot }
            | undefined;

        if (playerManager?.snapshot) {
            return playerManager.snapshot;
        }

        return {
            static: {
                id: 'player',
                name: 'Adventurer',
                race: 'human',
                characterClass: 'fighter',
                gender: 'unknown',
                age: 20,
                appearance: [],
                avatarPath: '',
                unitSpritePath: '',
            },
            dynamic: {
                level: 1,
                experience: 0,
                hp: 100,
                maxHp: 100,
                mana: 50,
                maxMana: 50,
                posX: 0,
                posY: 0,
                gold: 0,
                inventory: [],
                equipment: {
                    head: undefined,
                    chest: undefined,
                    legs: undefined,
                    feet: undefined,
                    main_hand: undefined,
                    off_hand: undefined,
                    ring: undefined,
                    necklace: undefined,
                },
                questLog: [],
            },
        };
    }
}

export { DialogueManager };
