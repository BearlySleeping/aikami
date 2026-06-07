// apps/frontend/game/src/lib/ui/dialogue_controller.ts

import {
  BaseGameClass,
  type BaseGameClassInterface,
  type BaseGameClassOptions,
} from '$lib/core/base_game_class.ts';
import type { FirebaseFunctionsInterface } from '$lib/services/firebase/functions.ts';
import type { DialogueGeneratorInterface } from '$lib/systems/interaction_bridge.ts';
import type { InteractableNpcEntry } from '$lib/systems/interaction_system.ts';
import { endInteraction } from '$lib/systems/interaction_system.ts';

// ---------------------------------------------------------------------------
// DialogueController — Vanilla DOM overlay for in-world NPC conversations
//
// Creates and manages a <div id="dialogue_overlay"> with scrollable chat
// history and a text input field. Wires input submission to the Firebase
// Callable `prompt_npc_dialogue` via the REST client.
//
// Pure Vanilla DOM manipulation — no framework imports.
// ---------------------------------------------------------------------------

/** A single message in the dialogue conversation. */
type DialogueMessage = {
  role: 'npc' | 'player' | 'system';
  text: string;
  timestamp: number;
};

/** Input data for the prompt_npc_dialogue callable. */
type PromptNpcDialogueInput = {
  npcId: string;
  personaId: string;
  npcName: string;
  playerData: Record<string, unknown>;
  relationshipValue: number;
  messageHistory: Array<{ role: string; text: string }>;
};

/** Output from the prompt_npc_dialogue callable. */
type PromptNpcDialogueOutput = {
  reply: string;
  relationshipDelta: number;
};

export type DialogueControllerOptions = BaseGameClassOptions & {
  functions: FirebaseFunctionsInterface;
  /**
   * Optional streaming dialogue generator (StreamOrchestrator or compatible).
   * When provided, the controller operates in streaming mode: progressive
   * text from the generator is displayed in a streaming message bubble,
   * and a Skip button is shown to cancel generation.
   */
  generator?: DialogueGeneratorInterface;
};

export type DialogueControllerInterface = BaseGameClassInterface & {
  readonly isActive: boolean;
  readonly isStreaming: boolean;
  start(npc: InteractableNpcEntry, initialMessage?: string): void;
  end(): void;
};

/**
 * Controller for the vanilla DOM dialogue overlay used during NPC conversations.
 *
 * Creates/removes `<div id="dialogue_overlay">` and manages the chat history
 * and input field. Pure imperative DOM manipulation with native event listeners.
 */
class DialogueController
  extends BaseGameClass<DialogueControllerOptions>
  implements DialogueControllerInterface
{
  private _functions: FirebaseFunctionsInterface;
  private _generator: DialogueGeneratorInterface | undefined;
  private _currentNpc: InteractableNpcEntry | undefined;
  private _messages: DialogueMessage[] = [];
  private _isActive = false;
  private _isStreaming = false;
  private _streamingPollInterval: ReturnType<typeof setInterval> | undefined;
  private _streamingText = '';

  // DOM elements (created lazily during mount)
  private _overlay: HTMLDivElement | undefined;
  private _history: HTMLDivElement | undefined;
  private _input: HTMLInputElement | undefined;
  private _sendButton: HTMLButtonElement | undefined;
  private _nameLabel: HTMLHeadingElement | undefined;
  private _relationshipBar: HTMLDivElement | undefined;
  private _skipButton: HTMLButtonElement | undefined;
  private _streamingMessageDiv: HTMLDivElement | undefined;

  constructor(options: DialogueControllerOptions) {
    super(options);
    this._functions = options.functions;
    this._generator = options.generator;
  }

  // -- Public lifecycle ----------------------------------------------------

  /**
   * Starts a dialogue with the given NPC.
   *
   * Mounts the DOM overlay, clears previous chat history, and displays
   * the NPC's greeting message. Player input is locked externally by the
   * interaction system before this is called.
   */
  start(npc: InteractableNpcEntry, initialMessage?: string): void {
    if (this._isActive) {
      return;
    }

    this._isActive = true;
    this._currentNpc = npc;
    this._messages = [];

    this._mountOverlay();
    this._setNpcName(npc.npcName);
    this._updateRelationshipBar(npc.relationshipValue);

    // If a streaming generator is available, start streaming mode
    if (this._generator) {
      this._startStreamingGeneration(npc);
      return;
    }

    // Show initial NPC greeting (or a default)
    const greeting = initialMessage || `*${npc.npcName} looks at you expectantly.*`;
    this._addMessage('npc', greeting);
  }

  /**
   * Ends the dialogue, destroys the DOM overlay, and restores player input.
   */
  end(): void {
    if (!this._isActive) {
      return;
    }

    this._stopStreamingPoll();

    // Cancel any active streaming generation
    if (this._isStreaming && this._generator) {
      this._generator.cancelGeneration();
    }

    this._isActive = false;
    this._isStreaming = false;
    this._streamingText = '';
    this._destroyOverlay();
    this._currentNpc = undefined;
    this._messages = [];

    // Restore player movement
    endInteraction();
  }

  /** Returns whether the dialogue overlay is currently active. */
  get isActive(): boolean {
    return this._isActive;
  }

  /** Whether the controller is currently in streaming generation mode. */
  get isStreaming(): boolean {
    return this._isStreaming;
  }

  // -- DOM Mounting --------------------------------------------------------

  /**
   * Creates the dialogue overlay DOM structure and appends it to the body.
   *
   * Structure:
   * ```
   * <div id="dialogue_overlay">
   *   <div id="dialogue_header">
   *     <h2 id="dialogue_npc_name">NPC Name</h2>
   *     <div id="dialogue_relationship_bar"><div id="dialogue_rel_fill"></div></div>
   *     <button id="dialogue_close">✕</button>
   *   </div>
   *   <div id="dialogue_history"></div>
   *   <div id="dialogue_error" style="display:none"></div>
   *   <div id="dialogue_input_row">
   *     <input id="dialogue_input" type="text" placeholder="Say something...">
   *     <button id="dialogue_send">Send</button>
   *   </div>
   * </div>
   * ```
   */
  private _mountOverlay(): void {
    // Destroy any existing overlay first
    this._destroyOverlay();

    const overlay = document.createElement('div');
    overlay.id = 'dialogue_overlay';
    overlay.style.cssText = [
      'position: absolute',
      'bottom: 0',
      'left: 50%',
      'transform: translateX(-50%)',
      'width: min(600px, 95vw)',
      'max-height: 60vh',
      'display: flex',
      'flex-direction: column',
      'background: rgba(10, 10, 26, 0.95)',
      'border: 2px solid #334155',
      'border-bottom: none',
      'border-radius: 12px 12px 0 0',
      'z-index: 100',
      'pointer-events: auto',
      'overflow: hidden',
    ].join(';');

    // Header
    const header = document.createElement('div');
    header.id = 'dialogue_header';
    header.style.cssText = [
      'display: flex',
      'align-items: center',
      'gap: 12px',
      'padding: 10px 16px',
      'background: rgba(26, 26, 46, 0.98)',
      'border-bottom: 1px solid #334155',
    ].join(';');

    const nameLabel = document.createElement('h2');
    nameLabel.id = 'dialogue_npc_name';
    nameLabel.style.cssText = [
      'margin: 0',
      'font-size: 16px',
      'font-weight: 600',
      'color: #a78bfa',
      'flex: 1',
    ].join(';');
    this._nameLabel = nameLabel;
    header.appendChild(nameLabel);

    const relBar = document.createElement('div');
    relBar.id = 'dialogue_relationship_bar';
    relBar.style.cssText = [
      'width: 80px',
      'height: 8px',
      'background: #334155',
      'border-radius: 4px',
      'overflow: hidden',
    ].join(';');

    const relFill = document.createElement('div');
    relFill.id = 'dialogue_rel_fill';
    relFill.style.cssText = [
      'height: 100%',
      'background: #7ec8e3',
      'border-radius: 4px',
      'transition: width 0.3s ease',
      'width: 50%',
    ].join(';');
    relBar.appendChild(relFill);
    header.appendChild(relBar);
    this._relationshipBar = relFill;

    const closeButton = document.createElement('button');
    closeButton.id = 'dialogue_close';
    closeButton.textContent = '✕';
    closeButton.style.cssText = [
      'background: none',
      'border: none',
      'color: #8899aa',
      'font-size: 18px',
      'cursor: pointer',
      'padding: 0 4px',
      'transition: color 0.2s',
    ].join(';');
    closeButton.addEventListener('mouseenter', () => {
      closeButton.style.color = '#cc6666';
    });
    closeButton.addEventListener('mouseleave', () => {
      closeButton.style.color = '#8899aa';
    });
    closeButton.addEventListener('click', () => {
      this.end();
    });
    header.appendChild(closeButton);

    overlay.appendChild(header);

    // Chat history
    const history = document.createElement('div');
    history.id = 'dialogue_history';
    history.style.cssText = [
      'flex: 1',
      'overflow-y: auto',
      'padding: 12px 16px',
      'font-size: 14px',
      'line-height: 1.5',
      'color: #c0c8d0',
      'min-height: 120px',
      'max-height: 280px',
    ].join(';');
    this._history = history;
    overlay.appendChild(history);

    // Error label
    const errorLabel = document.createElement('div');
    errorLabel.id = 'dialogue_error';
    errorLabel.style.cssText = [
      'display: none',
      'padding: 6px 16px',
      'font-size: 12px',
      'color: #e88888',
      'background: rgba(136, 85, 85, 0.2)',
    ].join(';');
    overlay.appendChild(errorLabel);

    // Input row
    const inputRow = document.createElement('div');
    inputRow.id = 'dialogue_input_row';
    inputRow.style.cssText = [
      'display: flex',
      'gap: 8px',
      'padding: 10px 16px',
      'background: rgba(26, 26, 46, 0.98)',
      'border-top: 1px solid #334155',
    ].join(';');

    const input = document.createElement('input');
    input.id = 'dialogue_input';
    input.type = 'text';
    input.placeholder = 'Say something...';
    input.style.cssText = [
      'flex: 1',
      'padding: 8px 12px',
      'font-size: 14px',
      'border: 2px solid #334155',
      'border-radius: 8px',
      'background: #1a1a2e',
      'color: #c0c8d0',
      'outline: none',
    ].join(';');
    input.addEventListener('focus', () => {
      input.style.borderColor = '#7ec8e3';
    });
    input.addEventListener('blur', () => {
      input.style.borderColor = '#334155';
    });
    this._input = input;
    inputRow.appendChild(input);

    const sendButton = document.createElement('button');
    sendButton.id = 'dialogue_send';
    sendButton.textContent = 'Send';
    sendButton.style.cssText = [
      'padding: 8px 18px',
      'font-size: 14px',
      'font-weight: 600',
      'border: 2px solid #334155',
      'border-radius: 8px',
      'background: #1a1a2e',
      'color: #7ec8e3',
      'cursor: pointer',
      'transition: all 0.2s ease',
    ].join(';');
    sendButton.addEventListener('mouseenter', () => {
      sendButton.style.borderColor = '#7ec8e3';
      sendButton.style.background = '#252545';
    });
    sendButton.addEventListener('mouseleave', () => {
      sendButton.style.borderColor = '#334155';
      sendButton.style.background = '#1a1a2e';
    });
    this._sendButton = sendButton;
    inputRow.appendChild(sendButton);

    overlay.appendChild(inputRow);

    // Skip button (hidden by default, shown in streaming mode)
    const skipButton = document.createElement('button');
    skipButton.id = 'dialogue_skip';
    skipButton.textContent = 'Skip ▸';
    skipButton.style.cssText = [
      'display: none',
      'background: none',
      'border: none',
      'color: #8899aa',
      'font-size: 14px',
      'cursor: pointer',
      'padding: 0 4px',
      'transition: color 0.2s',
    ].join(';');
    skipButton.addEventListener('mouseenter', () => {
      skipButton.style.color = '#cc6666';
    });
    skipButton.addEventListener('mouseleave', () => {
      skipButton.style.color = '#8899aa';
    });
    skipButton.addEventListener('click', () => {
      this.end();
    });
    header.appendChild(skipButton);
    this._skipButton = skipButton;

    // Append to body (or game container for scoped positioning)
    const gameScreen = document.getElementById('game-screen');
    if (gameScreen) {
      gameScreen.appendChild(overlay);
    } else {
      document.body.appendChild(overlay);
    }

    this._overlay = overlay;

    // Bind input events
    this._bindInputEvents();

    // Focus the input
    setTimeout(() => {
      this._input?.focus();
    }, 100);
  }

  /**
   * Binds event listeners to the input and send button.
   */
  private _bindInputEvents(): void {
    if (!this._input || !this._sendButton) {
      return;
    }

    const sendHandler = (): void => {
      const text = this._input?.value.trim();
      if (!text || !this._isActive) {
        return;
      }

      if (this._input) {
        this._input.value = '';
      }

      this._handlePlayerMessage(text);
    };

    this._input.addEventListener('keydown', (e: KeyboardEvent) => {
      // Prevent keyboard events from propagating to the game engine
      e.stopPropagation();
      e.stopImmediatePropagation();

      if (e.key === 'Enter') {
        e.preventDefault();
        sendHandler();
      }

      // Block WASD keys from moving the character while typing
      if (
        e.key === 'w' ||
        e.key === 'W' ||
        e.key === 'a' ||
        e.key === 'A' ||
        e.key === 's' ||
        e.key === 'S' ||
        e.key === 'd' ||
        e.key === 'D'
      ) {
        e.stopPropagation();
      }
    });

    // Block all keydown events from bubbling out of the input
    this._input.addEventListener('keyup', (e: KeyboardEvent) => {
      e.stopPropagation();
    });

    this._sendButton.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      sendHandler();
    });
  }

  /**
   * Removes the dialogue overlay from the DOM and clears references.
   */
  private _destroyOverlay(): void {
    this._stopStreamingPoll();
    if (this._overlay) {
      this._overlay.remove();
      this._overlay = undefined;
    }
    this._history = undefined;
    this._input = undefined;
    this._sendButton = undefined;
    this._nameLabel = undefined;
    this._relationshipBar = undefined;
    this._skipButton = undefined;
    this._streamingMessageDiv = undefined;
  }

  // -- Streaming generation ----------------------------------------------

  /**
   * Starts streaming dialogue generation for the given NPC.
   *
   * Switches the overlay to streaming mode: hides the input row, shows a
   * Skip button, creates a streaming message bubble, calls
   * {@link DialogueGeneratorInterface.generateDialogue}, and polls
   * {@link DialogueGeneratorInterface.currentText} to update the bubble.
   */
  private _startStreamingGeneration(npc: InteractableNpcEntry): void {
    if (!this._generator) {
      return;
    }

    this._isStreaming = true;
    this._streamingText = '';

    // Hide the text input row — streaming mode is read-only
    this._setInputRowVisible(false);

    // Show the skip button
    if (this._skipButton) {
      this._skipButton.style.display = '';
    }

    // Create a streaming message bubble for progressive text
    this._createStreamingMessageBubble();

    // Start polling the generator's currentText
    this._startStreamingPoll();

    // Initiate generation
    void this._generator.generateDialogue({
      prompt: `Player interacts with ${npc.npcName}`,
      npcId: npc.npcId,
      personaId: npc.personaId,
    });
  }

  /**
   * Creates a streaming message bubble in the chat history.
   *
   * The bubble is updated in-place each poll tick rather than creating
   * new DOM elements on every text change.
   */
  private _createStreamingMessageBubble(): void {
    if (!this._history) {
      return;
    }

    const msgDiv = document.createElement('div');
    msgDiv.className = 'dialogue-msg dialogue-msg-npc dialogue-msg-streaming';
    msgDiv.style.cssText = [
      'color: #a78bfa',
      'margin-bottom: 8px',
      'padding: 6px 10px',
      'background: rgba(167, 139, 250, 0.08)',
      'border-radius: 8px',
      'border-left: 3px solid #a78bfa',
      'min-height: 1.5em',
    ].join(';');

    // Append a blinking cursor span
    const cursor = document.createElement('span');
    cursor.className = 'dialogue-streaming-cursor';
    cursor.textContent = '▌';
    cursor.style.cssText = ['animation: blink 1s step-end infinite', 'color: #a78bfa'].join(';');

    msgDiv.appendChild(cursor);
    this._history.appendChild(msgDiv);
    this._streamingMessageDiv = msgDiv;

    this._scrollToBottom();
  }

  /**
   * Starts polling the generator's `currentText` at ~30fps to update
   * the streaming message bubble.
   */
  private _startStreamingPoll(): void {
    this._stopStreamingPoll();

    this._streamingPollInterval = setInterval(() => {
      if (!this._generator || !this._streamingMessageDiv) {
        return;
      }

      const text = this._generator.currentText;
      const textChanged = text !== this._streamingText;

      if (textChanged) {
        this._streamingText = text;
        this._updateStreamingMessage(text);
      }

      // When generation ends, finalize the message and restore input UI
      if (!this._generator.isGenerating && text.length > 0) {
        this._finalizeStreamingMessage();
      }
    }, 33);
  }

  /**
   * Stops the streaming poll interval.
   */
  private _stopStreamingPoll(): void {
    if (this._streamingPollInterval !== undefined) {
      clearInterval(this._streamingPollInterval);
      this._streamingPollInterval = undefined;
    }
  }

  /**
   * Updates the streaming message bubble with the current progressive text.
   */
  private _updateStreamingMessage(text: string): void {
    if (!this._streamingMessageDiv) {
      return;
    }

    // Remove existing text nodes and cursor, keep only the cursor span
    const cursor = this._streamingMessageDiv.querySelector('.dialogue-streaming-cursor');

    // Clear all child nodes except the cursor
    while (this._streamingMessageDiv.firstChild) {
      if (this._streamingMessageDiv.firstChild === cursor) {
        break;
      }
      this._streamingMessageDiv.removeChild(this._streamingMessageDiv.firstChild);
    }

    // Insert text before the cursor
    const textNode = document.createTextNode(text);
    if (cursor) {
      this._streamingMessageDiv.insertBefore(textNode, cursor);
    } else {
      this._streamingMessageDiv.appendChild(textNode);
    }

    this._scrollToBottom();
  }

  /**
   * Finalizes the streaming message: removes the cursor, converts it
   * to a permanent message in the history, and restores the input UI.
   */
  private _finalizeStreamingMessage(): void {
    this._stopStreamingPoll();

    // Remove the cursor from the streaming div
    if (this._streamingMessageDiv) {
      const cursor = this._streamingMessageDiv.querySelector('.dialogue-streaming-cursor');
      if (cursor) {
        cursor.remove();
      }
      // Reset streaming message reference so future polls won't touch it
      this._streamingMessageDiv = undefined;
    }

    // Add the finalized text as a permanent message
    if (this._streamingText) {
      this._messages.push({
        role: 'npc',
        text: this._streamingText,
        timestamp: Date.now(),
      });
    }

    this._isStreaming = false;
    this._streamingText = '';

    // Restore the input row and hide skip button
    this._setInputRowVisible(true);
    if (this._skipButton) {
      this._skipButton.style.display = 'none';
    }

    // Focus the input for the player to type a response
    setTimeout(() => {
      this._input?.focus();
    }, 100);
  }

  /**
   * Shows or hides the input row (text input + send button).
   */
  private _setInputRowVisible(visible: boolean): void {
    const inputRow = document.getElementById('dialogue_input_row');
    if (inputRow) {
      inputRow.style.display = visible ? 'flex' : 'none';
    }
  }

  // -- Message handling ----------------------------------------------------

  /**
   * Handles a message typed by the player.
   *
   * Adds the message to the chat history, sends it to the backend callable,
   * and displays the NPC's response.
   */
  private async _handlePlayerMessage(text: string): Promise<void> {
    this._addMessage('player', text);
    this._setInputEnabled(false);

    try {
      const response = await this._callNpcDialogue(text);

      if (response.error) {
        this._addMessage('system', `The NPC seems distracted... (${response.error})`);
        return;
      }

      const data = response.result;
      if (data?.reply) {
        this._addMessage('npc', data.reply);

        // Update relationship if a delta was provided
        if (typeof data.relationshipDelta === 'number' && this._currentNpc) {
          this._currentNpc.relationshipValue += data.relationshipDelta;
          this._updateRelationshipBar(this._currentNpc.relationshipValue);
        }
      }
    } catch (err) {
      this._addMessage('system', `Connection lost: ${String(err)}`);
    } finally {
      this._setInputEnabled(true);
      this._input?.focus();
    }
  }

  /**
   * Calls the prompt_npc_dialogue Firebase Callable via the REST client.
   */
  private async _callNpcDialogue(
    userText: string,
  ): Promise<{ result?: PromptNpcDialogueOutput; error?: string }> {
    if (!this._currentNpc) {
      return { error: 'No active NPC dialogue' };
    }

    const npc = this._currentNpc;

    // Build message history including the current user message
    const history = [
      ...this._messages.slice(-19).map((m) => ({
        role: m.role,
        text: m.text,
      })),
      { role: 'player' as const, text: userText },
    ];

    const input: PromptNpcDialogueInput = {
      npcId: npc.npcId,
      personaId: npc.personaId,
      npcName: npc.npcName,
      playerData: {
        name: 'Adventurer',
        level: 1,
      },
      relationshipValue: npc.relationshipValue,
      messageHistory: history,
    };

    return this._functions.callFunction<PromptNpcDialogueOutput>('promptNpcDialogue', {
      data: input,
    }) as Promise<{ result?: PromptNpcDialogueOutput; error?: string }>;
  }

  // -- DOM Helpers ---------------------------------------------------------

  /**
   * Adds a message to the chat history and scrolls to the bottom.
   */
  private _addMessage(role: DialogueMessage['role'], text: string): void {
    this._messages.push({ role, text, timestamp: Date.now() });

    if (!this._history) {
      return;
    }

    const msgDiv = document.createElement('div');
    msgDiv.className = `dialogue-msg dialogue-msg-${role}`;
    msgDiv.textContent = text;

    // Role-based styling
    switch (role) {
      case 'npc': {
        msgDiv.style.cssText = [
          'color: #a78bfa',
          'margin-bottom: 8px',
          'padding: 6px 10px',
          'background: rgba(167, 139, 250, 0.08)',
          'border-radius: 8px',
          'border-left: 3px solid #a78bfa',
        ].join(';');
        break;
      }
      case 'player': {
        msgDiv.style.cssText = [
          'color: #7ec8e3',
          'margin-bottom: 8px',
          'text-align: right',
          'padding: 6px 10px',
          'background: rgba(126, 200, 227, 0.08)',
          'border-radius: 8px',
          'border-right: 3px solid #7ec8e3',
        ].join(';');
        break;
      }
      case 'system': {
        msgDiv.style.cssText = [
          'color: #8899aa',
          'font-style: italic',
          'margin-bottom: 8px',
          'text-align: center',
          'font-size: 12px',
        ].join(';');
        break;
      }
    }

    this._history.appendChild(msgDiv);
    this._scrollToBottom();
  }

  /**
   * Scrolls the chat history to the bottom.
   */
  private _scrollToBottom(): void {
    requestAnimationFrame(() => {
      if (this._history) {
        this._history.scrollTop = this._history.scrollHeight;
      }
    });
  }

  /**
   * Sets the NPC name in the header.
   */
  private _setNpcName(name: string): void {
    if (this._nameLabel) {
      this._nameLabel.textContent = name;
    }
  }

  /**
   * Updates the relationship bar fill width based on the current value.
   *
   * Maps -100..100 to 0..100% width. Color shifts from red through neutral to green.
   */
  private _updateRelationshipBar(value: number): void {
    if (!this._relationshipBar) {
      return;
    }

    // Clamp to -100..100
    const clamped = Math.max(-100, Math.min(100, value));
    const percentage = ((clamped + 100) / 200) * 100;

    this._relationshipBar.style.width = `${percentage}%`;

    // Color: red (hostile) → blue (neutral) → green (friendly)
    if (clamped < -30) {
      this._relationshipBar.style.background = '#cc6666';
    } else if (clamped > 30) {
      this._relationshipBar.style.background = '#66cc88';
    } else {
      this._relationshipBar.style.background = '#7ec8e3';
    }
  }

  /**
   * Enables or disables the chat input and send button.
   */
  private _setInputEnabled(enabled: boolean): void {
    if (this._input) {
      this._input.disabled = !enabled;
    }
    if (this._sendButton) {
      this._sendButton.disabled = !enabled;
      this._sendButton.style.opacity = enabled ? '1' : '0.5';
    }
  }

  override async setup(): Promise<void> {
    this.debug('setup');
  }
}

export const getDialogueController = (
  options: DialogueControllerOptions,
): DialogueControllerInterface => new DialogueController(options);
