// apps/frontend/client/src/lib/views/character/persona/create/persona_create_view_model.svelte.ts

import { DEFAULT_LPC_RECIPE, STARTER_KIT } from '@aikami/constants';
import type { LpcLayerRecipe } from '@aikami/frontend/engine/sim';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type { PersonaData } from '@aikami/types';
import {
  buildCharacterExtractionPrompt,
  CharacterExtractionSchema,
} from '$lib/data/ai_prompts/character_extraction_schema';
import { DND_CREATION_SYSTEM_PROMPT } from '$lib/data/ai_prompts/dnd_creation';
import { getLpcCatalog } from '$lib/data/lpc_asset_catalog';

// LPC Slot → index lookup (built from catalog)
const _getLpcSlotIndex = (): Map<string, number> => {
  const catalog = getLpcCatalog();
  const map = new Map<string, number>();
  for (let i = 0; i < catalog.slots.length; i++) {
    map.set(catalog.slots[i].slot, i);
  }
  return map;
};

const _getLpcVariantMap = (): Map<string, string[]> => {
  const catalog = getLpcCatalog();
  const map = new Map<string, string[]>();
  for (const slot of catalog.slots) {
    map.set(
      slot.slot,
      slot.variants.map((v) => v.assetId),
    );
  }
  return map;
};

/**
 * Engine slot priority order (C-417 AC-6) — mirrors the onboarding
 * coordinator's ENGINE_SLOTS so both preview integrations build recipes in
 * the same deterministic order.
 */
const _ENGINE_SLOTS = ['body', 'hair', 'torso', 'legs', 'feet', 'head'] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The persona creation phase. */
export type CreationPhase = 'CHAT' | 'GENERATING' | 'TWEAK';

/** A single message in the DM chat history. */
export type ChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

/** Label for an ability score stat display. */
export type ScoreLabel = {
  readonly key: 'strength' | 'dexterity' | 'constitution' | 'intelligence' | 'wisdom' | 'charisma';
  readonly label: string;
  readonly desc: string;
};

// ---------------------------------------------------------------------------
// Capability contracts
// ---------------------------------------------------------------------------

/** Persona chat/generation state and operations. */
export type PersonaCreationCapabilities = {
  persona: PersonaData | undefined;
  avatarUrl: string;
  readonly isStreaming: boolean;
  sendMessage(options: { text: string; messages: ChatMessage[] }): Promise<ChatMessage[]>;
  startAvatarGeneration(options: { prompt: string }): void;
  cancel(): void;
};

/** Image generation readiness and operations. */
export type ImageGenerationCapabilities = {
  readonly isReady: boolean;
  generateImage(options: {
    prompt: string;
    negativePrompt?: string;
    initImage?: string;
    denoise?: number;
    steps?: number;
    cfgScale?: number;
  }): Promise<{ url: string }>;
};

/** Structured text extraction for persona fields. */
export type TextGenerationCapabilities = {
  extractStructure(options: {
    schema: Record<string, unknown>;
    schemaName: string;
    prompt: string;
    systemPrompt?: string;
  }): Promise<unknown>;
};

/** The signed-in identity the create flow reads. */
export type AuthCapabilities = {
  readonly uid: string | undefined;
};

/** Avatar upload. */
export type StorageCapabilities = {
  uploadAvatar(options: { file: Blob | File; uid: string }): Promise<string | undefined>;
};

/** Inventory seeding for the starter kit. */
export type InventoryCapabilities = {
  reset(): void;
  addItem(options: { itemId: string; quantity: number }): boolean;
};

/** Equipment reset + starter-kit equipping. */
export type EquipmentCapabilities = {
  reset(): void;
  equipItem(options: { itemId: string }): boolean;
};

/** World state reset before entering the world. */
export type WorldStateCapabilities = {
  reset(): void;
};

/** Player state reset before entering the world. */
export type PlayerStateCapabilities = {
  reset(): void;
};

/** Per-install persona persistence. */
export type PersonaServiceCapabilities = {
  updatePersona(personaId: string, data: Partial<PersonaData>): Promise<void>;
  setActivePersona(personaId: string): Promise<void>;
};

/** Navigation used by the create flow. */
export type RouterCapabilities = {
  goToRoute(
    route: 'game',
    options: {
      queryParameters: undefined;
      pathParameters: undefined;
    },
  ): Promise<void>;
  goToDevRoute(devPath: string): Promise<void>;
};

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export type PersonaCreateViewModelInterface = BaseViewModelInterface & {
  readonly phase: CreationPhase;
  readonly messages: readonly ChatMessage[];
  readonly persona: PersonaData | undefined;
  readonly avatarUrl: string;
  readonly isStreaming: boolean;
  readonly chatInput: string;
  readonly debugOpen: boolean;
  readonly scoreLabels: readonly ScoreLabel[];
  /** Whether ComfyUI is running and a checkpoint is loaded. */
  readonly isImageGenReady: boolean;
  /** Whether the user has sent any messages yet (excludes system). */
  readonly hasMessages: boolean;
  /** Dynamic label for the generate button. */
  readonly generateButtonLabel: string;
  /** LPC sprite recipe from AI extraction. */
  readonly lpcRecipe: Record<string, string> | null;
  /**
   * LpcLayerRecipe[] projection of {@link lpcRecipe} for the inline
   * LpcPreviewView (C-417 AC-6). Mirrors the onboarding coordinator's
   * recipe-sync shape so both preview integrations stay structurally
   * consistent.
   */
  readonly lpcPreviewRecipes: readonly LpcLayerRecipe[];
  /** LPC dev page URL for previewing the character's sprite. */
  readonly lpcPreviewUrl: string | null;
  /** Whether an avatar file upload is in progress. */
  readonly isUploading: boolean;

  // ── Regeneration ────────────────────────────────────────────────────
  /** Current regeneration mode. */
  readonly regenerationMode: 'appearance' | 'direct' | 'edit';
  /** Whether the regeneration panel is visible. */
  readonly showRegenerationPanel: boolean;
  /** Whether an avatar regeneration is in progress. */
  readonly isRegenerating: boolean;
  /** Direct prompt text (advanced mode). */
  readonly directPrompt: string;
  /** Edit instruction text. */
  readonly editInstruction: string;
  /** Toggles the regeneration panel. */
  toggleRegenerationPanel(): void;
  /** Sets the regeneration mode. */
  setRegenerationMode(mode: 'appearance' | 'direct' | 'edit'): void;
  /** Regenerates the avatar based on the selected mode. */
  regenerateAvatar(): Promise<void>;
  /** Saves the persona locally and optionally to Firebase. */
  saveCharacter(): Promise<void>;
  /** Whether the character has been saved in this session. */
  readonly characterSaved: boolean;
  /** Message shown after successful save. */
  readonly characterSavedMessage: string;
  /** Saves the persona and navigates to /game to start playing. */
  enterWorld(): Promise<void>;
  /** Uploads an avatar image file for the persona. */
  uploadAvatar(file: File): Promise<void>;

  sendChatMessage(text: string): Promise<void>;
  generateCharacter(): Promise<void>;
  cancel(): void;
  handleSend(): Promise<void>;
  handleKeydown(event: KeyboardEvent): void;
  incrementStat(statKey: ScoreLabel['key']): void;
  decrementStat(statKey: ScoreLabel['key']): void;
  updateAppearanceDescription(value: string): void;
  /** Navigates to the Config dev dashboard to set up image generation. */
  configureImageGen(): void;
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type PersonaCreateViewModelOptions = BaseViewModelOptions & {
  personaCreation: PersonaCreationCapabilities;
  imageGeneration: ImageGenerationCapabilities;
  textGeneration: TextGenerationCapabilities;
  auth: AuthCapabilities;
  storage: StorageCapabilities;
  inventory: InventoryCapabilities;
  equipment: EquipmentCapabilities;
  worldState: WorldStateCapabilities;
  playerState: PlayerStateCapabilities;
  personas: PersonaServiceCapabilities;
  router: RouterCapabilities;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class PersonaCreateViewModel
  extends BaseViewModel<PersonaCreateViewModelOptions>
  implements PersonaCreateViewModelInterface
{
  phase: CreationPhase = $state('CHAT');
  messages: ChatMessage[] = $state([]);
  chatInput = $state('');
  debugOpen = $state(false);
  isUploading = $state(false);

  // Regeneration state
  regenerationMode: 'appearance' | 'direct' | 'edit' = $state('appearance');
  showRegenerationPanel = $state(false);
  isRegenerating = $state(false);
  directPrompt = $state('');
  editInstruction = $state('');

  // LPC sprite recipe from extraction
  lpcRecipe: Record<string, string> | null = $state(null);

  /** Whether the character has been saved in this session. */
  characterSaved = $state(false);
  /** Message shown after successful save. */
  characterSavedMessage = $state('');

  private readonly _personaCreation: PersonaCreationCapabilities;
  private readonly _imageGeneration: ImageGenerationCapabilities;
  private readonly _textGeneration: TextGenerationCapabilities;
  private readonly _auth: AuthCapabilities;
  private readonly _storage: StorageCapabilities;
  private readonly _inventory: InventoryCapabilities;
  private readonly _equipment: EquipmentCapabilities;
  private readonly _worldState: WorldStateCapabilities;
  private readonly _playerState: PlayerStateCapabilities;
  private readonly _personas: PersonaServiceCapabilities;
  private readonly _router: RouterCapabilities;

  constructor(options: PersonaCreateViewModelOptions) {
    super(options);
    this._personaCreation = options.personaCreation;
    this._imageGeneration = options.imageGeneration;
    this._textGeneration = options.textGeneration;
    this._auth = options.auth;
    this._storage = options.storage;
    this._inventory = options.inventory;
    this._equipment = options.equipment;
    this._worldState = options.worldState;
    this._playerState = options.playerState;
    this._personas = options.personas;
    this._router = options.router;
  }

  private static readonly _scoreLabels: readonly ScoreLabel[] = [
    { key: 'strength', label: 'STR', desc: 'Strength' },
    { key: 'dexterity', label: 'DEX', desc: 'Dexterity' },
    { key: 'constitution', label: 'CON', desc: 'Constitution' },
    { key: 'intelligence', label: 'INT', desc: 'Intelligence' },
    { key: 'wisdom', label: 'WIS', desc: 'Wisdom' },
    { key: 'charisma', label: 'CHA', desc: 'Charisma' },
  ] as const;

  get persona(): PersonaData | undefined {
    return this._personaCreation.persona;
  }

  get avatarUrl(): string {
    return this._personaCreation.avatarUrl;
  }

  get isStreaming(): boolean {
    return this._personaCreation.isStreaming;
  }

  get scoreLabels(): readonly ScoreLabel[] {
    return PersonaCreateViewModel._scoreLabels;
  }

  get isImageGenReady(): boolean {
    return this._imageGeneration.isReady;
  }

  get hasMessages(): boolean {
    // Only count user messages — the initial assistant welcome doesn't count
    return this.messages.some((m) => m.role === 'user');
  }

  get generateButtonLabel(): string {
    return this.hasMessages ? '✨ Generate Character' : '🎲 Try My Luck';
  }

  /**
   * Builds LpcLayerRecipe[] from the extracted lpcRecipe (C-417 AC-6).
   * Ordered by engine slot priority so the inline preview matches the
   * in-game composite. `hexPalette` is a zero LUT — extraction carries no
   * palette overrides.
   */
  get lpcPreviewRecipes(): readonly LpcLayerRecipe[] {
    if (!this.lpcRecipe) {
      return [];
    }
    const recipes: LpcLayerRecipe[] = [];
    for (const slot of _ENGINE_SLOTS) {
      const assetId = this.lpcRecipe[slot];
      if (!assetId) {
        continue;
      }
      recipes.push({ slot, assetId, hexPalette: new Uint8Array(1024) });
    }
    return recipes;
  }

  /** LPC preview URL — opens the LPC dev page with this character's recipe. */
  get lpcPreviewUrl(): string | null {
    if (!this.lpcRecipe) {
      return null;
    }
    const params = new URLSearchParams();
    let layerIdx = 0;
    for (const [slotName, assetId] of Object.entries(this.lpcRecipe)) {
      // Use the slot ordering from the generated catalog
      const slotIdx = _getLpcSlotIndex().get(slotName);
      if (slotIdx === undefined) {
        continue;
      }
      const variants = _getLpcVariantMap().get(slotName);
      const vIdx = variants?.indexOf(assetId) ?? -1;
      if (vIdx < 0) {
        continue;
      }
      params.set(`l${layerIdx}`, `${slotIdx}:${vIdx}`);
      layerIdx++;
    }
    params.set('zoom', '0.7');
    return `/dev/lpc?${params.toString()}`;
  }

  configureImageGen(): void {
    // Navigate to the Config dev dashboard
    void this._router.goToDevRoute('config');
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  override async initialize(): Promise<void> {
    this.messages = [
      {
        role: 'system',
        content: DND_CREATION_SYSTEM_PROMPT,
      },
      {
        role: 'assistant',
        content:
          'Welcome, brave adventurer! I am your Dungeon Master, here to guide you through creating a hero worthy of legend. Tell me — what kind of character do you envision? A cunning rogue, a wise wizard, a stalwart warrior? Describe your concept and we shall forge your destiny together, following the sacred rules of D&D 2024.',
      },
    ];
    await super.initialize();
  }

  // ── Public API ────────────────────────────────────────────────────────

  async sendChatMessage(text: string): Promise<void> {
    if (!text.trim()) {
      return;
    }

    // Optimistically add user message to chat IMMEDIATELY
    this.messages = [...this.messages, { role: 'user' as const, content: text }];

    // Then get the AI response
    try {
      this.messages = await this._personaCreation.sendMessage({
        text,
        messages: this.messages,
      });
    } catch {
      // If streaming fails, remove the optimistic user message
      this.messages = this.messages.filter((m) => m.content !== text || m.role !== 'user');
      return;
    }

    // Auto-detect: if the AI signals the character is ready, start extraction
    // in the BACKGROUND while keeping the chat visible for 4s so the user
    // can read the AI's response.
    const lastMsg = this.messages[this.messages.length - 1];
    if (lastMsg?.role === 'assistant' && /YOUR CHARACTER IS READY/i.test(lastMsg.content)) {
      // Start extraction immediately in the background (don't await)
      const extractionPromise = this._extractCharacter();

      // Wait 4 seconds before transitioning — user gets to read the response
      await new Promise((resolve) => setTimeout(resolve, 4000));

      // If extraction is already done, go straight to TWEAK
      const persona = await extractionPromise;
      if (persona) {
        this._personaCreation.persona = persona;
        this._startAvatarIfReady();
        this.phase = 'TWEAK';
      } else {
        this.phase = 'CHAT';
        this.errorMessage = 'Failed to generate character. Please try again.';
      }
    }
  }

  async handleSend(): Promise<void> {
    const text = this.chatInput.trim();
    if (!text || this.isStreaming) {
      return;
    }
    this.chatInput = '';
    await this.sendChatMessage(text);
  }

  handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void this.handleSend();
    }
  }

  async generateCharacter(): Promise<void> {
    // If no conversation happened, add a system message requesting a random character
    if (!this.hasMessages) {
      this.messages = [
        ...this.messages.filter((m) => m.role === 'system'),
        {
          role: 'user' as const,
          content:
            'Surprise me with a completely random D&D 2024 character! Pick any species, any class, any alignment, and create a unique, interesting backstory. Make them memorable and flavorful.',
        },
        {
          role: 'assistant' as const,
          content:
            'Excellent! Let me conjure a hero from the mists of fate... YOUR CHARACTER IS READY! Creating your character now...',
        },
      ];
    }

    this.phase = 'GENERATING';

    const persona = await this._extractCharacter();
    if (persona) {
      this._personaCreation.persona = persona;
      this._startAvatarIfReady();
      this.phase = 'TWEAK';
    } else {
      this.phase = 'CHAT';
      // Preserve specific error messages (e.g., AbortError) set by _extractCharacter()
      if (!this.errorMessage) {
        this.errorMessage = 'Failed to generate character. Please try again.';
      }
    }
  }

  cancel(): void {
    this._personaCreation.cancel();
    this.phase = 'CHAT';
  }

  incrementStat(statKey: ScoreLabel['key']): void {
    const scores = this.persona?.abilityScores;
    if (scores && typeof scores[statKey] === 'number' && (scores[statKey] as number) < 15) {
      scores[statKey] = (scores[statKey] as number) + 1;
    }
  }

  decrementStat(statKey: ScoreLabel['key']): void {
    const scores = this.persona?.abilityScores;
    if (scores && typeof scores[statKey] === 'number' && (scores[statKey] as number) > 8) {
      scores[statKey] = (scores[statKey] as number) - 1;
    }
  }

  updateAppearanceDescription(value: string): void {
    if (!this.persona) {
      return;
    }
    if (!this.persona.appearance) {
      this.persona.appearance = {};
    }
    this.persona.appearance.physicalDescription = value;
  }

  // ── Avatar Upload ───────────────────────────────────────────────────

  async uploadAvatar(file: File): Promise<void> {
    if (this.isUploading) {
      return;
    }

    this.isUploading = true;

    try {
      const uid = this._auth.uid;
      if (!uid) {
        this.warn('uploadAvatar: not authenticated');
        return;
      }

      const url = await this._storage.uploadAvatar({ file, uid });
      if (url) {
        this._personaCreation.avatarUrl = url;
      }
    } catch (error) {
      this.error('uploadAvatar', error);
    } finally {
      this.isUploading = false;
    }
  }

  // ── Regeneration ────────────────────────────────────────────────────

  toggleRegenerationPanel(): void {
    this.showRegenerationPanel = !this.showRegenerationPanel;
    if (this.showRegenerationPanel) {
      // Pre-fill direct prompt with the original avatar prompt
      const appearance = this.persona?.appearance?.physicalDescription ?? '';
      this.directPrompt = appearance ? this._enhanceForComfyUI(appearance) : '';
    }
  }

  setRegenerationMode(mode: 'appearance' | 'direct' | 'edit'): void {
    this.regenerationMode = mode;
  }

  async regenerateAvatar(): Promise<void> {
    if (!this.isImageGenReady) {
      return;
    }

    this.isRegenerating = true;

    try {
      if (this.regenerationMode === 'appearance') {
        const appearance = this.persona?.appearance?.physicalDescription ?? '';
        if (!appearance) {
          return;
        }
        const prompt = this._enhanceForComfyUI(appearance);
        const result = await this._imageGeneration.generateImage({ prompt });
        this._personaCreation.avatarUrl = result.url;
      } else if (this.regenerationMode === 'direct') {
        const prompt = this.directPrompt.trim();
        if (!prompt) {
          return;
        }
        const result = await this._imageGeneration.generateImage({ prompt });
        this._personaCreation.avatarUrl = result.url;
      } else if (this.regenerationMode === 'edit') {
        const instruction = this.editInstruction.trim();
        if (!instruction) {
          return;
        }
        const currentUrl = this._personaCreation.avatarUrl;
        if (!currentUrl) {
          return;
        }
        await this._editAvatarImage(currentUrl, instruction);
      }
    } catch (error) {
      this.error('regenerateAvatar:failed', error);
    } finally {
      this.isRegenerating = false;
      this.showRegenerationPanel = false;
    }
  }

  // ── Save Persona ────────────────────────────────────────────────────

  async saveCharacter(): Promise<void> {
    await this._persistCharacter();
    this.characterSaved = true;
    this.characterSavedMessage = 'Persona saved to your device.';
  }

  async enterWorld(): Promise<void> {
    await this._persistCharacter();

    // Clear any stale game state from a previous play session
    // so the new game starts with a clean inventory, quest log, etc.
    this._inventory.reset();
    this._worldState.reset();
    this._playerState.reset();
    this._equipment.reset();

    // C-374: grant the starter kit — clothes/armour + equipment pre-equipped,
    // plus a couple of potions in the bag.
    this._seedStarterKit();

    // Mark the persona active locally regardless of sign-in (local-first).
    if (this.persona?.id) {
      try {
        await this._personas.setActivePersona(this.persona.id);
        this.info('enterWorld:active-set', { personaId: this.persona.id });
      } catch (error) {
        this.warn('enterWorld:active-set-failed (continuing anyway)', error);
      }
    }

    // Navigate to game
    await this._router.goToRoute('game', {
      queryParameters: undefined,
      pathParameters: undefined,
    });
  }

  // ── Private: starter kit ────────────────────────────────────────────

  /**
   * Seeds the character's starting equipment + bag (C-374).
   *
   * Adds the starter consumables to the bag, then adds each equipment item
   * to the bag and pre-equips it so a fresh character renders fully geared.
   */
  private _seedStarterKit(): void {
    for (const entry of STARTER_KIT.inventory) {
      this._inventory.addItem({ itemId: entry.itemId, quantity: entry.quantity });
    }
    for (const [, itemId] of Object.entries(STARTER_KIT.equipment)) {
      if (!itemId) {
        continue;
      }
      // Equipment items must exist in the bag before equipItem can move
      // them into a slot.
      this._inventory.addItem({ itemId, quantity: 1 });
      this._equipment.equipItem({ itemId });
    }
    this.info('enterWorld:starter-kit-seeded', {
      equipment: Object.keys(STARTER_KIT.equipment).join(','),
    });
  }

  // ── Private: persistence ─────────────────────────────────────────────

  private async _persistCharacter(): Promise<void> {
    const persona = this.persona;
    if (!persona) {
      return;
    }

    // Ensure the persona has an ID
    if (!persona.id) {
      persona.id = crypto.randomUUID();
    }

    // Convert blob URL to data URL so it survives page refresh
    let persistentAvatarUrl = this._personaCreation.avatarUrl;
    if (persistentAvatarUrl?.startsWith('blob:')) {
      try {
        const blobResponse = await fetch(persistentAvatarUrl);
        const blob = await blobResponse.blob();
        persistentAvatarUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
      } catch {
        // If conversion fails, use the original URL (it just won't survive refresh)
      }
    }

    const characterData = {
      persona,
      avatarUrl: persistentAvatarUrl,
      savedAt: new Date().toISOString(),
    };

    // SQLite is authoritative — updatePersona upserts, so this covers both
    // create and update. A failure propagates so the save is never reported
    // successful when nothing was persisted.
    await this._personas.updatePersona(persona.id, {
      ...persona,
      avatarUrl: persistentAvatarUrl || persona.avatarUrl || '',
      isActive: persona.isActive ?? false,
    });
    this.info('saveCharacter:local-table', { id: persona.id });

    // Best-effort legacy mirror for the migration window.
    try {
      const stored = localStorage.getItem('aikami-characters');
      const characters = stored ? (JSON.parse(stored) as unknown[]) : [];
      // Replace existing entry for this character ID or append
      const idx = characters.findIndex(
        (c: unknown) => (c as { persona: { id: string } }).persona?.id === persona.id,
      );
      if (idx >= 0) {
        characters[idx] = characterData;
      } else {
        characters.push(characterData);
      }
      localStorage.setItem('aikami-characters', JSON.stringify(characters));
      this.info('saveCharacter:local', { id: persona.id });
    } catch (error) {
      this.warn('saveCharacter:local-failed', error);
    }
  }

  // ── Private: avatar editing (img2img) ────────────────────────────────

  /**
   * Edits the current avatar via the image engine abstraction (C-388).
   * The engine absorbs the inline init image (base64/data URL) — no private
   * ComfyUI upload or workflow builder here.
   */
  private async _editAvatarImage(imageUrl: string, instruction: string): Promise<void> {
    // Fetch current avatar as blob
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error('Failed to fetch current avatar');
    }
    const blob = await response.blob();

    // Convert blob → data URL so it can ride in ImageGenerationRequest.initImage
    const dataUrl = await blobToDataUrl(blob);

    const result = await this._imageGeneration.generateImage({
      prompt: `${instruction}, same person, same face, high quality`,
      negativePrompt: 'deformed, different person, blurry, low quality',
      initImage: dataUrl,
      denoise: 0.5,
      steps: 25,
      cfgScale: 7.0,
    });

    this._personaCreation.avatarUrl = result.url;
  }

  /** Enhances an appearance description for better ComfyUI image generation. */
  private _enhanceForComfyUI(description: string): string {
    return `${description}, fantasy character portrait, D&D art style, highly detailed, dramatic lighting, digital painting, sharp focus`;
  }

  // ── Private helpers ───────────────────────────────────────────────────

  /** Shared extraction logic — used by both auto-trigger and manual generate. */
  private async _extractCharacter(): Promise<PersonaData | null> {
    const compiledHistory = this._compileChatHistory();

    try {
      const extracted = await this._textGeneration.extractStructure({
        schema: CharacterExtractionSchema as unknown as Record<string, unknown>, // guard-ignore lint/type-safety/casting: Record cast for AI-generated persona data
        schemaName: 'CharacterExtraction',
        prompt: compiledHistory,
        systemPrompt: buildCharacterExtractionPrompt(getLpcCatalog()),
      });

      if (!extracted) {
        return null;
      }

      const extractedObj = extracted as Record<string, unknown>;

      const persona: PersonaData = {
        id: crypto.randomUUID(),
        name: (extractedObj.name as string) || 'Unnamed Adventurer',
        background: (extractedObj.background as string) || '',
        abilityScores: (extractedObj.abilityScores as PersonaData['abilityScores']) || {},
        appearance: (extractedObj.appearance as PersonaData['appearance']) || {},
        hitPoints: 10,
        hitPointsMax: 10,
        temporaryHitPoints: 0,
        armorClass: 10,
        speed: 30,
        experiencePoints: 0,
        savingThrows: [],
        skills: [],
        proficiencies: [],
        languages: ['Common'],
        equipment: [],
        inventory: [],
        isActive: false,
      };

      if (extractedObj.race) {
        persona.race = extractedObj.race as string;
      }
      if ((extractedObj as { class?: string }).class) {
        persona.class = (extractedObj as { class?: string }).class;
      }
      if (extractedObj.subclass) {
        persona.subclass = extractedObj.subclass as string;
      }
      if (extractedObj.alignment) {
        persona.alignment = extractedObj.alignment as string;
      }
      if (extractedObj.level) {
        persona.level = extractedObj.level as number;
      }
      if (extractedObj.personalityTraits) {
        persona.personalityTraits = extractedObj.personalityTraits as string;
      }
      if (extractedObj.ideals) {
        persona.ideals = extractedObj.ideals as string;
      }
      if (extractedObj.bonds) {
        persona.bonds = extractedObj.bonds as string;
      }
      if (extractedObj.flaws) {
        persona.flaws = extractedObj.flaws as string;
      }
      if (extractedObj.proficiencies) {
        persona.proficiencies = extractedObj.proficiencies as string[];
      }
      if (extractedObj.languages) {
        persona.languages = [...(persona.languages ?? []), ...(extractedObj.languages as string[])];
      }
      if (extractedObj.equipment) {
        persona.equipment = extractedObj.equipment as string[];
      }
      if (extractedObj.lpcRecipe) {
        const rawRecipe = extractedObj.lpcRecipe as Record<string, string>;
        // Validate each asset ID against the LPC catalog; replace invalid
        // entries with defaults so the preview never shows missing assets.
        const validatedRecipe: Record<string, string> = {};
        for (const [slot, assetId] of Object.entries(rawRecipe)) {
          const validIds = getLpcCatalog().assetIdsBySlot[slot];
          if (validIds?.includes(assetId)) {
            validatedRecipe[slot] = assetId;
          } else {
            // Fall back to default for this slot
            const defaultId = DEFAULT_LPC_RECIPE[slot as keyof typeof DEFAULT_LPC_RECIPE];
            if (defaultId) {
              validatedRecipe[slot] = defaultId;
            }
            this.debug('_extractCharacter:invalid-lpc-asset', { slot, assetId, defaultId });
          }
        }
        this.lpcRecipe = validatedRecipe;
        // Persist lpcRecipe on the persona so the game engine can use it.
        // Contract C-158
        (persona.appearance as Record<string, unknown>).lpcRecipe = validatedRecipe;
      }

      if (persona.name === 'Unnamed Adventurer' && persona.race && persona.class) {
        persona.name = `${persona.race} ${persona.class}`;
      }

      return persona;
    } catch (error: unknown) {
      const err = error as Error & { name: string };
      this.error('_extractCharacter', err);
      if (err.name === 'AbortError') {
        this.errorMessage = 'Persona generation was cancelled.';
      }
      return null;
    }
  }

  /** Starts avatar generation if ComfyUI is available. */
  private _startAvatarIfReady(): void {
    if (!this.isImageGenReady) {
      return;
    }
    const p = this._personaCreation.persona;
    if (!p) {
      return;
    }
    const imagePrompt =
      p?.appearance?.physicalDescription ||
      (p?.race && p?.class
        ? `${p.race} ${p.class}, fantasy character portrait`
        : p?.name || 'fantasy character');
    this._personaCreation.startAvatarGeneration({ prompt: imagePrompt });
  }

  private _compileChatHistory(): string {
    const lines: string[] = [];

    const systemMsg = this.messages.find((m) => m.role === 'system');
    if (systemMsg) {
      lines.push(systemMsg.content);
    } else {
      lines.push(DND_CREATION_SYSTEM_PROMPT);
    }

    lines.push('');
    lines.push('--- Conversation History ---');

    const conversation = this.messages.filter((m) => m.role !== 'system');
    for (const message of conversation) {
      const label = message.role === 'user' ? 'Player' : 'DM';
      lines.push(`${label}: ${message.content}`);
    }

    if (conversation.length === 0) {
      lines.push('Player: (new conversation — greet the player and start character creation)');
    }

    return lines.join('\n');
  }
}

/**
 * Builds a persona-create ViewModel from explicit capabilities.
 *
 * Tests and sandboxes call this directly; production code goes through
 * `getPersonaCreateViewModel` in ./persona_create_composition.ts.
 */
export const createPersonaCreateViewModel = (
  options: PersonaCreateViewModelOptions,
): PersonaCreateViewModelInterface => PersonaCreateViewModel.create(options);

// ---------------------------------------------------------------------------
// Module helpers
// ---------------------------------------------------------------------------

/**
 * Converts a Blob to a base64 data URL. Uses arrayBuffer + btoa so it works
 * in both browsers and the Bun test environment (FileReader events do not
 * fire in Bun).
 */
const blobToDataUrl = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return `data:${blob.type || 'image/png'};base64,${btoa(binary)}`;
};
