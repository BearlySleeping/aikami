// apps/frontend/client/src/lib/views/macros/macros_sandbox_view_model.svelte.ts
//
// Dev sandbox ViewModel for the macro template system (C-237 AC-5).
// Provides template input, mock context fields for all macro categories,
// live macro resolution via resolveMacros, and preset editor integration.

import {
  BaseDevViewModel,
  type BaseDevViewModelInterface,
  type BaseDevViewModelOptions,
} from '@aikami/frontend/services';
import type { MacroContext } from '@aikami/parser';
import { resolveMacros } from '@aikami/parser';
import { macroPresetStore } from '$services';
import type { PromptPreset } from '$types';

// ── Types ───────────────────────────────────────────────────────────────────

export type MacrosSandboxViewModelInterface = BaseDevViewModelInterface & {
  /** Raw template input containing {{macro}} placeholders. */
  readonly template: string;
  /** Live-resolved output of the template with current context. */
  readonly resolvedOutput: string;
  /** Character count of the resolved output. */
  readonly characterCount: number;

  // Context mock fields
  readonly userName: string;
  readonly characterName: string;
  readonly characterDescription: string;
  readonly characterPersonality: string;
  readonly scenario: string;
  readonly persona: string;
  readonly chatHistory: string;
  readonly userMessage: string;
  readonly otherCharacters: string;

  // Preset integration
  /** Currently selected preset ID, or null. */
  readonly presetId: string | null;
  /** All available presets. */
  readonly presets: PromptPreset[];

  /** Updates the template input. */
  updateTemplate: (value: string) => void;
  /** Updates a context field. */
  updateContext: (options: { field: string; value: string }) => void;
  /** Selects a preset to use as the template. */
  selectPreset: (options: { id: string }) => void;
  /** Resets all context fields to defaults. */
  resetContext: () => void;
  /** Resets everything to initial state. */
  resetAll: () => void;
};

export type MacrosSandboxViewModelOptions = BaseDevViewModelOptions & {};

// ── Default context values ──────────────────────────────────────────────────

const DEFAULT_CONTEXT: Required<MacroContext> = {
  userName: 'Alice',
  characterName: 'Thorn',
  characterDescription: 'A tall warrior with a mysterious past.',
  characterPersonality: 'Brave, loyal, and slightly reckless.',
  scenario: 'A dark forest at twilight.',
  persona: 'Curious adventurer',
  chatHistory: 'Thorn: Where are we heading?\nAlice: To the old ruins.',
  userMessage: 'What do you see ahead?',
  otherCharacters: 'Elena the Healer, Garrick the Scout',
  extraContext: {},
};

// ── Default template ────────────────────────────────────────────────────────

const DEFAULT_TEMPLATE = `You are roleplaying as {{char}}. {{personality}}

Character: {{description}}

Setting: {{scenario}}

Previous conversation:
{{history}}

User ({{user}}): {{message}}`;

// ── ViewModel ───────────────────────────────────────────────────────────────

class MacrosSandboxViewModel
  extends BaseDevViewModel<MacrosSandboxViewModelOptions>
  implements MacrosSandboxViewModelInterface
{
  template = $state(DEFAULT_TEMPLATE);

  // Context mock fields
  userName = $state(DEFAULT_CONTEXT.userName);
  characterName = $state(DEFAULT_CONTEXT.characterName);
  characterDescription = $state(DEFAULT_CONTEXT.characterDescription);
  characterPersonality = $state(DEFAULT_CONTEXT.characterPersonality);
  scenario = $state(DEFAULT_CONTEXT.scenario);
  persona = $state(DEFAULT_CONTEXT.persona);
  chatHistory = $state(DEFAULT_CONTEXT.chatHistory);
  userMessage = $state(DEFAULT_CONTEXT.userMessage);
  otherCharacters = $state(DEFAULT_CONTEXT.otherCharacters);

  // Preset integration
  presetId = $state<string | null>(null);
  presets = $state(macroPresetStore.presets);

  // ── Derived ────────────────────────────────────────────────────────────────

  /** The MacroContext assembled from mock fields. */
  get _context(): MacroContext {
    return {
      userName: this.userName,
      characterName: this.characterName,
      characterDescription: this.characterDescription,
      characterPersonality: this.characterPersonality,
      scenario: this.scenario,
      persona: this.persona,
      chatHistory: this.chatHistory,
      userMessage: this.userMessage,
      otherCharacters: this.otherCharacters,
    };
  }

  /** Live-resolved output using the current template and context. */
  get resolvedOutput(): string {
    if (!this.template.trim()) {
      return '';
    }
    return resolveMacros({ template: this.template, context: this._context });
  }

  get characterCount(): number {
    return this.resolvedOutput.length;
  }

  // ── Initialize ─────────────────────────────────────────────────────────────

  override async initialize(): Promise<void> {
    macroPresetStore.loadPresets();
    this.presets = macroPresetStore.presets;
    await super.initialize();
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  updateTemplate(value: string): void {
    this.template = value;
  }

  updateContext(options: { field: string; value: string }): void {
    const { field, value } = options;
    const validFields = new Set([
      'userName',
      'characterName',
      'characterDescription',
      'characterPersonality',
      'scenario',
      'persona',
      'chatHistory',
      'userMessage',
      'otherCharacters',
    ]);

    if (!validFields.has(field)) {
      this.warn('macrosSandbox:updateContext:invalid-field', { field });
      return;
    }

    switch (field) {
      case 'userName':
        this.userName = value;
        break;
      case 'characterName':
        this.characterName = value;
        break;
      case 'characterDescription':
        this.characterDescription = value;
        break;
      case 'characterPersonality':
        this.characterPersonality = value;
        break;
      case 'scenario':
        this.scenario = value;
        break;
      case 'persona':
        this.persona = value;
        break;
      case 'chatHistory':
        this.chatHistory = value;
        break;
      case 'userMessage':
        this.userMessage = value;
        break;
      case 'otherCharacters':
        this.otherCharacters = value;
        break;
      default:
        break;
    }
  }

  selectPreset(options: { id: string }): void {
    const { id } = options;
    this.presetId = id;
    const assembled = macroPresetStore.assemblePreset(id);
    if (assembled !== undefined) {
      this.template = assembled;
    }
  }

  resetContext(): void {
    this.userName = DEFAULT_CONTEXT.userName;
    this.characterName = DEFAULT_CONTEXT.characterName;
    this.characterDescription = DEFAULT_CONTEXT.characterDescription;
    this.characterPersonality = DEFAULT_CONTEXT.characterPersonality;
    this.scenario = DEFAULT_CONTEXT.scenario;
    this.persona = DEFAULT_CONTEXT.persona;
    this.chatHistory = DEFAULT_CONTEXT.chatHistory;
    this.userMessage = DEFAULT_CONTEXT.userMessage;
    this.otherCharacters = DEFAULT_CONTEXT.otherCharacters;
  }

  resetAll(): void {
    this.template = DEFAULT_TEMPLATE;
    this.presetId = null;
    this.resetContext();
    macroPresetStore.loadPresets();
    this.presets = macroPresetStore.presets;
  }
}

export const getMacrosSandboxViewModel = (
  options: MacrosSandboxViewModelOptions,
): MacrosSandboxViewModelInterface => MacrosSandboxViewModel.create(options);
