// apps/frontend/client/src/lib/services/config/macro_preset_store.svelte.ts
//
// Preset CRUD service for prompt presets (C-237).
// Manages built-in presets as defaults and user-defined presets
// persisted to localStorage. Built-in presets are immutable;
// users can duplicate, modify copies, and save custom presets.

import { logger } from '$logger';
import type { PromptPreset, PromptSection } from '$types';

// ---------------------------------------------------------------------------
// Built-in defaults
// ---------------------------------------------------------------------------

const BUILT_IN_PRESETS: PromptPreset[] = [
  {
    id: 'builtin-roleplay',
    name: 'Roleplay',
    description: 'Standard roleplay prompt with character card and scenario context.',
    isBuiltIn: true,
    sections: [
      {
        id: 'section-system',
        name: 'System Prompt',
        content: 'You are roleplaying as {{char}}. {{personality}}',
        enabled: true,
        order: 0,
      },
      {
        id: 'section-description',
        name: 'Character Description',
        content: '{{description}}',
        enabled: true,
        order: 1,
      },
      {
        id: 'section-scenario',
        name: 'Scenario',
        content: 'Setting: {{scenario}}',
        enabled: true,
        order: 2,
      },
      {
        id: 'section-history',
        name: 'Chat History',
        content: '{{history}}',
        enabled: true,
        order: 3,
      },
    ],
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: 'builtin-chat',
    name: 'Simple Chat',
    description: 'Minimal chat prompt with just the conversation history.',
    isBuiltIn: true,
    sections: [
      {
        id: 'section-system',
        name: 'System Prompt',
        content: 'You are {{char}}, a helpful conversational AI.',
        enabled: true,
        order: 0,
      },
      {
        id: 'section-history',
        name: 'Chat History',
        content: '{{history}}\n\nUser: {{message}}',
        enabled: true,
        order: 1,
      },
    ],
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: 'builtin-narrator',
    name: 'Narrator Mode',
    description: 'Third-person narration prompt for descriptive storytelling.',
    isBuiltIn: true,
    sections: [
      {
        id: 'section-system',
        name: 'System Prompt',
        content: 'You are the narrator for a story set in: {{scenario}}',
        enabled: true,
        order: 0,
      },
      {
        id: 'section-description',
        name: 'Scene',
        content:
          '[ Setting: {{scenario}} ]\n[ Characters: {{char}}, {{other_characters}} ]\n[ User: {{user}} ]',
        enabled: true,
        order: 1,
      },
      {
        id: 'section-history',
        name: 'Story So Far',
        content: '{{history}}',
        enabled: true,
        order: 2,
      },
    ],
    updatedAt: new Date(0).toISOString(),
  },
];

/** localStorage key for user-defined presets. */
const STORAGE_KEY = 'aikami_macro_presets';

// ---------------------------------------------------------------------------
// Preset store singleton
// ---------------------------------------------------------------------------

let _instance: MacroPresetStore | undefined;

export type MacroPresetStore = {
  /** All presets (built-in merged with user-defined). */
  readonly presets: PromptPreset[];

  /** Loads presets from localStorage. */
  loadPresets: () => void;
  /** Saves a new user-defined preset. */
  savePreset: (options: {
    name: string;
    description?: string;
    sections: PromptSection[];
  }) => string;
  /** Deletes a user-defined preset by ID. Built-ins are a no-op. */
  deletePreset: (id: string) => void;
  /** Duplicates a preset (built-in or user-defined) as a new editable copy. */
  duplicatePreset: (id: string) => string | undefined;
  /** Returns the preset with all sections assembled into a single template string. */
  assemblePreset: (id: string) => string | undefined;
};

/**
 * Creates or returns the singleton preset store.
 */
export const createMacroPresetStore = (): MacroPresetStore => {
  if (_instance) {
    return _instance;
  }

  let presets = $state<PromptPreset[]>([...BUILT_IN_PRESETS]);

  const store: MacroPresetStore = {
    get presets(): PromptPreset[] {
      return presets;
    },

    loadPresets: (): void => {
      logger.debug('macroPresetStore.loadPresets');
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        presets = [...BUILT_IN_PRESETS];
        return;
      }
      try {
        const userPresets = JSON.parse(raw) as PromptPreset[];
        // Merge: built-ins first, then user presets (dedup by ID)
        const builtInIds = new Set(BUILT_IN_PRESETS.map((p) => p.id));
        presets = [...BUILT_IN_PRESETS, ...userPresets.filter((p) => !builtInIds.has(p.id))];
      } catch {
        logger.warn('macroPresetStore.loadPresets: failed to parse');
        presets = [...BUILT_IN_PRESETS];
      }
    },

    savePreset: (options: {
      name: string;
      description?: string;
      sections: PromptSection[];
    }): string => {
      const id = `preset-${crypto.randomUUID()}`;
      const preset: PromptPreset = {
        id,
        name: options.name,
        description: options.description,
        sections: options.sections.map((s, i) => ({ ...s, order: s.order ?? i })),
        isBuiltIn: false,
        updatedAt: new Date().toISOString(),
      };
      presets = [...presets, preset];
      _persist(presets);
      return id;
    },

    deletePreset: (id: string): void => {
      const preset = presets.find((p) => p.id === id);
      if (!preset || preset.isBuiltIn) {
        logger.warn('macroPresetStore.deletePreset: cannot delete built-in or missing', { id });
        return;
      }
      presets = presets.filter((p) => p.id !== id);
      _persist(presets);
    },

    duplicatePreset: (id: string): string | undefined => {
      const original = presets.find((p) => p.id === id);
      if (!original) {
        return undefined;
      }
      const newId = `preset-${crypto.randomUUID()}`;
      const copy: PromptPreset = {
        ...original,
        id: newId,
        isBuiltIn: false,
        name: `${original.name} (copy)`,
        updatedAt: new Date().toISOString(),
      };
      presets = [...presets, copy];
      _persist(presets);
      return newId;
    },

    assemblePreset: (id: string): string | undefined => {
      const preset = presets.find((p) => p.id === id);
      if (!preset) {
        return undefined;
      }
      return preset.sections
        .filter((s) => s.enabled !== false)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((s) => s.content)
        .join('\n\n');
    },
  };

  _instance = store;
  return store;
};

/**
 * Persists only user-defined presets to localStorage.
 */
const _persist = (allPresets: PromptPreset[]): void => {
  const builtInIds = new Set(BUILT_IN_PRESETS.map((p) => p.id));
  const userPresets = allPresets.filter((p) => !builtInIds.has(p.id));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(userPresets));
};

/**
 * Returns the singleton preset store (convenience alias).
 */
export const macroPresetStore: MacroPresetStore = createMacroPresetStore();
