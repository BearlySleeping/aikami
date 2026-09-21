// apps/frontend/client/src/lib/views/character/persona/create/testing/persona_create_fixtures.ts
//
// Feature-owned test doubles for the persona-create ViewModel. Every capability
// is a plain object typed against the narrow contracts the ViewModel consumes,
// so tests assert against explicit behavior instead of the global `$services`
// mock.
//
// The harness records calls on arrays and exposes mutable state so callers can
// drive the ViewModel without importing the test runner or the service barrel.

import type { PersonaData } from '@aikami/types';
import type {
  AuthCapabilities,
  ChatMessage,
  EquipmentCapabilities,
  ImageGenerationCapabilities,
  InventoryCapabilities,
  PersonaCreateViewModelOptions,
  PersonaCreationCapabilities,
  PersonaServiceCapabilities,
  PlayerStateCapabilities,
  RouterCapabilities,
  StorageCapabilities,
  TextGenerationCapabilities,
  WorldStateCapabilities,
} from '../persona_create_view_model.svelte';

export type ExtractionCall = {
  schema: Record<string, unknown>;
  schemaName: string;
  prompt: string;
  systemPrompt?: string;
};

export type ImageGenCall = {
  prompt: string;
  negativePrompt?: string;
  initImage?: string;
  denoise?: number;
  steps?: number;
  cfgScale?: number;
};

export type PersonaCreateCapabilities = Pick<
  PersonaCreateViewModelOptions,
  | 'personaCreation'
  | 'imageGeneration'
  | 'textGeneration'
  | 'auth'
  | 'storage'
  | 'inventory'
  | 'equipment'
  | 'worldState'
  | 'playerState'
  | 'personas'
  | 'router'
>;

export type PersonaCreateHarness = {
  capabilities: PersonaCreateCapabilities;
  state: {
    persona: PersonaData | undefined;
    avatarUrl: string;
    avatarUrlResult: string;
    isStreaming: boolean;
    imageReady: boolean;
    uid: string | undefined;
    extractionResult: unknown;
    extractionError: Error | undefined;
    generateImageResult: { url: string };
    uploadAvatarResult: string | undefined;
    sendMessage: (options: { text: string; messages: ChatMessage[] }) => Promise<ChatMessage[]>;
  };
  ops: {
    extractionCalls: ExtractionCall[];
    startAvatarCalls: Array<{ prompt: string }>;
    imageGenCalls: ImageGenCall[];
    uploadAvatarCalls: Array<{ file: Blob | File; uid: string }>;
    inventoryAddCalls: Array<{ itemId: string; quantity: number }>;
    equipmentCalls: Array<{ itemId: string }>;
    cancelCount: number;
    routeCalls: Array<{ route: string }>;
    devRouteCalls: Array<{ path: string }>;
    setActivePersonaCalls: string[];
    updatePersonaCalls: string[];
    resets: { inventory: number; world: number; player: number; equipment: number };
  };
};

/** Builds a fresh persona-create capability set with recorded call history. */
export const createPersonaCreateHarness = (): PersonaCreateHarness => {
  const state: PersonaCreateHarness['state'] = {
    persona: undefined,
    avatarUrl: '',
    avatarUrlResult: 'https://example.com/avatar.png',
    isStreaming: false,
    imageReady: true,
    uid: undefined,
    extractionResult: undefined,
    extractionError: undefined,
    generateImageResult: { url: 'https://example.com/generated.png' },
    uploadAvatarResult: undefined,
    sendMessage: async ({ messages }) => [
      ...messages,
      {
        role: 'assistant',
        content: 'Greetings, brave adventurer! What kind of hero do you wish to become?',
      },
    ],
  };

  const ops: PersonaCreateHarness['ops'] = {
    extractionCalls: [],
    startAvatarCalls: [],
    imageGenCalls: [],
    uploadAvatarCalls: [],
    inventoryAddCalls: [],
    equipmentCalls: [],
    cancelCount: 0,
    routeCalls: [],
    devRouteCalls: [],
    setActivePersonaCalls: [],
    updatePersonaCalls: [],
    resets: { inventory: 0, world: 0, player: 0, equipment: 0 },
  };

  const personaCreation: PersonaCreationCapabilities = {
    get persona() {
      return state.persona;
    },
    set persona(value) {
      state.persona = value;
    },
    get avatarUrl() {
      return state.avatarUrl;
    },
    set avatarUrl(value) {
      state.avatarUrl = value;
    },
    get isStreaming() {
      return state.isStreaming;
    },
    sendMessage: (options) => state.sendMessage(options),
    startAvatarGeneration: (options) => {
      ops.startAvatarCalls.push({ prompt: options.prompt });
      state.avatarUrl = state.avatarUrlResult;
    },
    cancel: () => {
      ops.cancelCount++;
      state.isStreaming = false;
    },
  };

  const imageGeneration: ImageGenerationCapabilities = {
    get isReady() {
      return state.imageReady;
    },
    generateImage: async (options) => {
      ops.imageGenCalls.push({
        prompt: options.prompt,
        negativePrompt: options.negativePrompt,
        initImage: options.initImage,
        denoise: options.denoise,
        steps: options.steps,
        cfgScale: options.cfgScale,
      });
      return state.generateImageResult;
    },
  };

  const textGeneration: TextGenerationCapabilities = {
    extractStructure: async (options) => {
      ops.extractionCalls.push({
        schema: options.schema,
        schemaName: options.schemaName,
        prompt: options.prompt,
        systemPrompt: options.systemPrompt,
      });
      if (state.extractionError) {
        throw state.extractionError;
      }
      return state.extractionResult;
    },
  };

  const auth: AuthCapabilities = {
    get uid() {
      return state.uid;
    },
  };

  const storage: StorageCapabilities = {
    uploadAvatar: async (options) => {
      ops.uploadAvatarCalls.push({ file: options.file, uid: options.uid });
      return state.uploadAvatarResult;
    },
  };

  const inventory: InventoryCapabilities = {
    reset: () => {
      ops.resets.inventory++;
    },
    addItem: (options) => {
      ops.inventoryAddCalls.push({ itemId: options.itemId, quantity: options.quantity });
      return true;
    },
  };

  const equipment: EquipmentCapabilities = {
    reset: () => {
      ops.resets.equipment++;
    },
    equipItem: (options) => {
      ops.equipmentCalls.push({ itemId: options.itemId });
      return true;
    },
  };

  const worldState: WorldStateCapabilities = {
    reset: () => {
      ops.resets.world++;
    },
  };

  const playerState: PlayerStateCapabilities = {
    reset: () => {
      ops.resets.player++;
    },
  };

  const personas: PersonaServiceCapabilities = {
    updatePersona: async (personaId) => {
      ops.updatePersonaCalls.push(personaId);
    },
    setActivePersona: async (personaId) => {
      ops.setActivePersonaCalls.push(personaId);
    },
  };

  const router: RouterCapabilities = {
    goToRoute: async (route) => {
      ops.routeCalls.push({ route });
    },
    goToDevRoute: async (path) => {
      ops.devRouteCalls.push({ path });
    },
  };

  return {
    state,
    ops,
    capabilities: {
      personaCreation,
      imageGeneration,
      textGeneration,
      auth,
      storage,
      inventory,
      equipment,
      worldState,
      playerState,
      personas,
      router,
    },
  };
};
