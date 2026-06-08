// apps/frontend/pwa/src/lib/client/game/ui/character_creation_controller.ts

import type { Application } from 'pixi.js';
import { type Container, Graphics, Text, TextStyle } from 'pixi.js';
import {
  BaseGameClass,
  type BaseGameClassInterface,
  type BaseGameClassOptions,
} from '$lib/client/game/core/base_game_class.ts';
import type { FirebaseFunctionsInterface } from '$lib/client/game/services/firebase/functions.ts';

// ---------------------------------------------------------------------------
// CharacterCreationController — narrative-driven D&D character creation
//
// State machine: INTRO → CHAT → GENERATING_ASSETS → MANUAL_TWEAK → COMPLETE.
// Uses hybrid approach: PixiJS for background/portraits, Vanilla DOM overlay
// for scrollable chat history and text input.
// ---------------------------------------------------------------------------

/** Phases of the character creation flow. */
const PHASES = ['intro', 'chat', 'generating', 'tweak', 'complete'] as const;
type CreationPhase = (typeof PHASES)[number];

/** An AI-generated character sheet extracted from the DM conversation. */
type GeneratedCharacter = {
  name: string;
  race: string;
  class: string;
  level: number;
  abilityScores: {
    strength: number;
    dexterity: number;
    constitution: number;
    intelligence: number;
    wisdom: number;
    charisma: number;
  };
  appearanceDescription: string;
  background: string;
  alignment: string;
  personalityTraits: string;
  ideals: string;
  bonds: string;
  flaws: string;
};

/** A single chat message in the character creation DM conversation. */
type ChatMessage = {
  role: 'dm' | 'user' | 'system';
  text: string;
};

export type CharacterCreationCallbacks = {
  /** Called when the character is finalized and saved. */
  onCharacterCreated: (character: GeneratedCharacter) => void;
  /** Called when the user cancels creation and returns to menu. */
  onCancel: () => void;
};

export type CharacterCreationControllerOptions = BaseGameClassOptions & {
  functions: FirebaseFunctionsInterface;
  callbacks: CharacterCreationCallbacks;
};

export type CharacterCreationControllerInterface = BaseGameClassInterface & {
  start(options: { pixiApp: Application; pixiRoot: Container }): void;
  destroy(): void;
};

/**
 * Controls the hybrid PixiJS + Vanilla DOM character creation flow.
 *
 * Manages the state machine, chat overlay DOM manipulation, AI service
 * communication via Firebase Functions, and stat tweaking PixiJS view.
 */
class CharacterCreationController
  extends BaseGameClass<CharacterCreationControllerOptions>
  implements CharacterCreationControllerInterface
{
  private _phase: CreationPhase = 'intro';
  private _messages: ChatMessage[] = [];
  private _generatedCharacter: GeneratedCharacter | undefined;
  private _functions: FirebaseFunctionsInterface;
  private _callbacks: CharacterCreationCallbacks;
  private _pixiApp: Application | undefined;
  private _pixiRoot: Container | undefined;

  // DOM elements
  private _chatOverlay: HTMLDivElement;
  private _chatHistory: HTMLDivElement;
  private _chatInput: HTMLInputElement;
  private _chatSendBtn: HTMLButtonElement;

  // Stat tweaking PixiJS objects
  private _statTexts: Map<string, Text> = new Map();
  private _statButtons: Container[] = [];

  constructor(options: CharacterCreationControllerOptions) {
    super(options);
    this._functions = options.functions;
    this._callbacks = options.callbacks;

    this._chatOverlay = this._getEl('chat-overlay') as HTMLDivElement;
    this._chatHistory = this._getEl('chat-history') as HTMLDivElement;
    this._chatInput = this._getEl('chat-input') as HTMLInputElement;
    this._chatSendBtn = this._getEl('chat-send-btn') as HTMLButtonElement;
  }

  /**
   * Starts the character creation flow.
   * Must be called after the PixiJS Application has been initialized.
   */
  start(options: { pixiApp: Application; pixiRoot: Container }): void {
    this._pixiApp = options.pixiApp;
    this._pixiRoot = options.pixiRoot;
    this._transitionTo('intro');
  }

  /**
   * Destroys all DOM overlays and PixiJS objects created by this controller.
   */
  destroy(): void {
    this._hideChatOverlay();
    this._clearStatView();
    this._messages = [];
    this._phase = 'intro';
    this._generatedCharacter = undefined;
    this._pixiApp = undefined;
    this._pixiRoot = undefined;
  }

  // ── State Machine ──────────────────────────────────────────

  private _transitionTo(phase: CreationPhase): void {
    this._phase = phase;

    switch (phase) {
      case 'intro': {
        this._showIntro();
        break;
      }
      case 'chat': {
        this._startChat();
        break;
      }
      case 'generating': {
        this._startGenerating();
        break;
      }
      case 'tweak': {
        this._showStatTweaking();
        break;
      }
      case 'complete': {
        this._finalize();
        break;
      }
    }
  }

  // ── INTRO Phase ─────────────────────────────────────────────

  private _showIntro(): void {
    this._addSystemMessage(
      'Welcome, adventurer. I am your Dungeon Master. ' +
        'Tell me about the character you wish to play, and I shall guide you ' +
        'through the 2024 rules of Dungeons & Dragons.',
    );
    this._addSystemMessage(
      'What kind of hero calls to you? A battle-hardened warrior, ' +
        'a cunning rogue, a wise wizard, or something else entirely?',
    );

    this._transitionTo('chat');
  }

  // ── CHAT Phase ──────────────────────────────────────────────

  private _startChat(): void {
    this._showChatOverlay();
    this._bindChatInput();
    this._scrollToBottom();
  }

  private _bindChatInput(): void {
    const sendMessage = async (): Promise<void> => {
      const text = this._chatInput.value.trim();
      if (!text) {
        return;
      }

      this._chatInput.value = '';
      this._addUserMessage(text);
      this._chatInput.disabled = true;
      this._chatSendBtn.disabled = true;

      await this._sendToDm(text);

      this._chatInput.disabled = false;
      this._chatSendBtn.disabled = false;
      this._chatInput.focus();
    };

    // Remove old listeners by cloning
    const newSendBtn = this._chatSendBtn.cloneNode(true) as HTMLButtonElement;
    this._chatSendBtn.parentNode?.replaceChild(newSendBtn, this._chatSendBtn);
    this._chatSendBtn = newSendBtn;

    const newInput = this._chatInput.cloneNode(true) as HTMLInputElement;
    this._chatInput.parentNode?.replaceChild(newInput, this._chatInput);
    this._chatInput = newInput;

    this._chatSendBtn.addEventListener('click', () => {
      sendMessage();
    });

    this._chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        sendMessage();
      }
    });
  }

  private async _sendToDm(userMessage: string): Promise<void> {
    // Check if the DM thinks we're done
    const isCompletion = /done|finaliz|complete|ready|finished/i.test(userMessage);

    try {
      const messages = this._messages.map((m) => ({ role: m.role, text: m.text }));

      const response = await this._functions.callFunction<{
        reply: string;
        characterJson?: GeneratedCharacter;
        complete: boolean;
      }>('promptCharacterCreation', {
        messages,
        userMessage,
        phase: this._phase,
      });

      if (response.error) {
        this._addSystemMessage(`Error: ${response.error}`);
        return;
      }

      const data = response.result;
      if (!data) {
        return;
      }

      // Show DM reply
      if (data.reply) {
        this._addDmMessage(data.reply);
      }

      // Check if character JSON is complete
      if (data.complete && data.characterJson) {
        this._generatedCharacter = data.characterJson;
        // Short delay so the user can read the final DM message
        setTimeout(() => {
          this._transitionTo('generating');
        }, 1500);
      } else if (isCompletion && !data.complete) {
        this._addSystemMessage(
          "The Dungeon Master would like to ask a few more questions before finalizing your character. Please continue describing your hero's story.",
        );
      }
    } catch (err) {
      this._addSystemMessage(`Failed to reach the Dungeon Master: ${String(err)}`);
    }
  }

  // ── GENERATING Phase ────────────────────────────────────────

  private _startGenerating(): void {
    this._hideChatOverlay();
    this._addSystemMessage('Generating your character portrait and compiling stats...');

    // Simulate asset generation — in production, this calls an image gen API
    setTimeout(() => {
      if (this._generatedCharacter) {
        this._transitionTo('tweak');
      }
    }, 2000);
  }

  // ── MANUAL_TWEAK Phase ──────────────────────────────────────

  private _showStatTweaking(): void {
    if (!this._generatedCharacter || !this._pixiRoot || !this._pixiApp) {
      return;
    }

    this._clearStatView();

    const char = this._generatedCharacter;
    const abilities: Array<{ key: keyof GeneratedCharacter['abilityScores']; label: string }> = [
      { key: 'strength', label: 'STR' },
      { key: 'dexterity', label: 'DEX' },
      { key: 'constitution', label: 'CON' },
      { key: 'intelligence', label: 'INT' },
      { key: 'wisdom', label: 'WIS' },
      { key: 'charisma', label: 'CHA' },
    ];

    // Background panel
    const panelW = 320;
    const panelH = 380;
    const panelX = (this._pixiApp.screen.width - panelW) / 2;
    const panelY = (this._pixiApp.screen.height - panelH) / 2;

    const panel = new Graphics();
    panel.roundRect(panelX, panelY, panelW, panelH, 12);
    panel.fill({ color: 0x1a1a2e, alpha: 0.95 });
    panel.stroke({ color: 0x334155, width: 2 });
    this._pixiRoot.addChild(panel);
    this._statButtons.push(panel);

    // Title
    const titleStyle = new TextStyle({
      fontFamily: 'monospace',
      fontSize: 18,
      fontWeight: 'bold',
      fill: 0x7ec8e3,
      align: 'center',
    });
    const title = new Text({ text: 'Adjust Ability Scores', style: titleStyle });
    title.anchor.set(0.5);
    title.x = this._pixiApp.screen.width / 2;
    title.y = panelY + 30;
    this._pixiRoot.addChild(title);
    this._statButtons.push(title);

    // Points remaining
    const totalPoints = 27; // Standard point buy
    const pointsRemaining = totalPoints;

    const pointsStyle = new TextStyle({
      fontFamily: 'monospace',
      fontSize: 14,
      fill: 0x8899aa,
      align: 'center',
    });
    const pointsText = new Text({
      text: `Points remaining: ${pointsRemaining}`,
      style: pointsStyle,
    });
    pointsText.anchor.set(0.5);
    pointsText.x = this._pixiApp.screen.width / 2;
    pointsText.y = panelY + 55;
    this._pixiRoot.addChild(pointsText);
    this._statButtons.push(pointsText);

    // Ability rows
    const startY = panelY + 85;
    const rowHeight = 42;
    const col1X = panelX + 50;
    const col2X = panelX + 130;
    const col3X = panelX + 220;
    const col4X = panelX + 270;

    const labelStyle = new TextStyle({
      fontFamily: 'monospace',
      fontSize: 16,
      fill: 0xc0c8d0,
    });
    const valueStyle = new TextStyle({
      fontFamily: 'monospace',
      fontSize: 18,
      fontWeight: 'bold',
      fill: 0xffffff,
    });

    for (let i = 0; i < abilities.length; i++) {
      const ability = abilities[i];
      if (!ability) {
        continue;
      }
      const y = startY + i * rowHeight;

      // Label
      const label = new Text({ text: ability.label, style: labelStyle });
      label.x = col1X;
      label.y = y;
      this._pixiRoot.addChild(label);
      this._statButtons.push(label);

      // Value
      let value = char.abilityScores[ability.key];
      const valueText = new Text({ text: String(value), style: valueStyle });
      valueText.anchor.set(0.5);
      valueText.x = col2X;
      valueText.y = y + 4;
      this._pixiRoot.addChild(valueText);
      this._statTexts.set(ability.key, valueText);
      this._statButtons.push(valueText);

      // Decrease (-) button
      const decBtn = new Graphics();
      decBtn.roundRect(col3X, y, 36, 28, 6);
      decBtn.fill({ color: 0x885555 });
      decBtn.eventMode = 'static';
      decBtn.cursor = 'pointer';
      decBtn.on('pointerdown', () => {
        if (value > 8) {
          value--;
          char.abilityScores[ability.key] = value;
          valueText.text = String(value);
          const newRemaining = this._calculateRemainingPoints(char);
          pointsText.text = `Points remaining: ${newRemaining}`;
        }
      });
      this._pixiRoot.addChild(decBtn);
      this._statButtons.push(decBtn);

      const decLabel = new Text({
        text: '-',
        style: new TextStyle({ fontFamily: 'monospace', fontSize: 18, fill: 0xffffff }),
      });
      decLabel.anchor.set(0.5);
      decLabel.x = col3X + 18;
      decLabel.y = y + 14;
      decLabel.eventMode = 'static';
      decLabel.cursor = 'pointer';
      this._pixiRoot.addChild(decLabel);
      this._statButtons.push(decLabel);

      // Increase (+) button
      const incBtn = new Graphics();
      incBtn.roundRect(col4X, y, 36, 28, 6);
      incBtn.fill({ color: 0x558855 });
      incBtn.eventMode = 'static';
      incBtn.cursor = 'pointer';
      incBtn.on('pointerdown', () => {
        if (value < 18) {
          value++;
          char.abilityScores[ability.key] = value;
          valueText.text = String(value);
          const newRemaining = this._calculateRemainingPoints(char);
          pointsText.text = `Points remaining: ${newRemaining}`;
        }
      });
      this._pixiRoot.addChild(incBtn);
      this._statButtons.push(incBtn);

      const incLabel = new Text({
        text: '+',
        style: new TextStyle({ fontFamily: 'monospace', fontSize: 18, fill: 0xffffff }),
      });
      incLabel.anchor.set(0.5);
      incLabel.x = col4X + 18;
      incLabel.y = y + 14;
      incLabel.eventMode = 'static';
      incLabel.cursor = 'pointer';
      this._pixiRoot.addChild(incLabel);
      this._statButtons.push(incLabel);
    }

    // Confirm button
    const confirmY = startY + abilities.length * rowHeight + 15;
    const confirmBtn = new Graphics();
    confirmBtn.roundRect(panelX + 60, confirmY, 200, 36, 8);
    confirmBtn.fill({ color: 0x558855 });
    confirmBtn.stroke({ color: 0x7ec8e3, width: 1 });
    confirmBtn.eventMode = 'static';
    confirmBtn.cursor = 'pointer';
    confirmBtn.on('pointerdown', () => {
      this._transitionTo('complete');
    });
    this._pixiRoot.addChild(confirmBtn);
    this._statButtons.push(confirmBtn);

    const confirmLabelStyle = new TextStyle({
      fontFamily: 'monospace',
      fontSize: 16,
      fontWeight: 'bold',
      fill: 0xffffff,
    });
    const confirmLabel = new Text({ text: 'Confirm Character', style: confirmLabelStyle });
    confirmLabel.anchor.set(0.5);
    confirmLabel.x = panelX + 160;
    confirmLabel.y = confirmY + 18;
    confirmLabel.eventMode = 'static';
    confirmLabel.cursor = 'pointer';
    this._pixiRoot.addChild(confirmLabel);
    this._statButtons.push(confirmLabel);

    // Cancel button
    const cancelY = confirmY + 46;
    const cancelBtn = new Graphics();
    cancelBtn.roundRect(panelX + 60, cancelY, 200, 36, 8);
    cancelBtn.fill({ color: 0x885555 });
    cancelBtn.eventMode = 'static';
    cancelBtn.cursor = 'pointer';
    cancelBtn.on('pointerdown', () => {
      this._callbacks.onCancel();
    });
    this._pixiRoot.addChild(cancelBtn);
    this._statButtons.push(cancelBtn);

    const cancelLabel = new Text({ text: 'Cancel', style: confirmLabelStyle });
    cancelLabel.anchor.set(0.5);
    cancelLabel.x = panelX + 160;
    cancelLabel.y = cancelY + 18;
    cancelLabel.eventMode = 'static';
    cancelLabel.cursor = 'pointer';
    this._pixiRoot.addChild(cancelLabel);
    this._statButtons.push(cancelLabel);
  }

  private _clearStatView(): void {
    for (const obj of this._statButtons) {
      if (obj.parent) {
        obj.parent.removeChild(obj);
      }
      obj.destroy();
    }
    this._statButtons = [];
    this._statTexts.clear();
  }

  private _calculateRemainingPoints(char: GeneratedCharacter): number {
    const scores = Object.values(char.abilityScores) as number[];
    const costMap: Record<number, number> = {
      8: 0,
      9: 1,
      10: 2,
      11: 3,
      12: 4,
      13: 5,
      14: 7,
      15: 9,
      16: 11,
      17: 13,
      18: 15,
    };
    const spent = scores.reduce((sum, score) => sum + (costMap[score] ?? 0), 0);
    return 27 - spent;
  }

  // ── COMPLETE Phase ──────────────────────────────────────────

  private _finalize(): void {
    this._clearStatView();
    this._hideChatOverlay();

    if (this._generatedCharacter) {
      this._callbacks.onCharacterCreated(this._generatedCharacter);
    }
  }

  // ── DOM Helpers ─────────────────────────────────────────────

  private _showChatOverlay(): void {
    this._chatOverlay.style.display = 'flex';
  }

  private _hideChatOverlay(): void {
    this._chatOverlay.style.display = 'none';
  }

  private _addDmMessage(text: string): void {
    this._messages.push({ role: 'dm', text });
    this._renderMessage('dm', text);
  }

  private _addUserMessage(text: string): void {
    this._messages.push({ role: 'user', text });
    this._renderMessage('user', text);
  }

  private _addSystemMessage(text: string): void {
    this._messages.push({ role: 'system', text });
    this._renderMessage('system', text);
  }

  private _renderMessage(role: ChatMessage['role'], text: string): void {
    const div = document.createElement('div');
    div.className = `msg-${role}`;
    div.textContent = text;
    this._chatHistory.appendChild(div);
    this._scrollToBottom();
  }

  private _scrollToBottom(): void {
    requestAnimationFrame(() => {
      this._chatHistory.scrollTop = this._chatHistory.scrollHeight;
    });
  }

  private _getEl(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) {
      throw new Error(`Element #${id} not found`);
    }
    return el;
  }

  override async setup(): Promise<void> {}
}

export const getCharacterCreationController = (
  options: CharacterCreationControllerOptions,
): CharacterCreationControllerInterface => new CharacterCreationController(options);
