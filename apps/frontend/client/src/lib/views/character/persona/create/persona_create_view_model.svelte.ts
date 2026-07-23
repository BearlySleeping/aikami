// apps/frontend/client/src/lib/views/character/persona/create/persona_create_view_model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { PersonaData } from '@aikami/types';
import {
  CHARACTER_EXTRACTION_SYSTEM_PROMPT,
  CharacterExtractionSchema,
} from '$lib/data/ai_prompts/character_extraction_schema';
import { DND_CREATION_SYSTEM_PROMPT } from '$lib/data/ai_prompts/dnd_creation';
import { GENERATED_LPC_SLOTS } from '$lib/data/lpc_asset_catalog_generated';
import {
  aiSettingsService,
  authService,
  characterService,
  equipmentService,
  imageGenerationService,
  inventoryService,
  personaCreationService,
  personaService,
  playerStateService,
  routerService,
  storageService,
  textGenerationService,
  worldStateService,
} from '$services';

// LPC Slot → index lookup (built at module init)
const _LPC_SLOT_INDEX = new Map<string, number>();
const _LPC_VARIANT_MAP = new Map<string, string[]>();
for (let i = 0; i < GENERATED_LPC_SLOTS.length; i++) {
  const slot = GENERATED_LPC_SLOTS[i];
  _LPC_SLOT_INDEX.set(slot.slot, i);
  _LPC_VARIANT_MAP.set(
    slot.slot,
    slot.variants.map((v) => v.assetId),
  );
}

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

export type PersonaCreateViewModelOptions = BaseViewModelOptions & {};

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

  private static readonly _SCORE_LABELS: readonly ScoreLabel[] = [
    { key: 'strength', label: 'STR', desc: 'Strength' },
    { key: 'dexterity', label: 'DEX', desc: 'Dexterity' },
    { key: 'constitution', label: 'CON', desc: 'Constitution' },
    { key: 'intelligence', label: 'INT', desc: 'Intelligence' },
    { key: 'wisdom', label: 'WIS', desc: 'Wisdom' },
    { key: 'charisma', label: 'CHA', desc: 'Charisma' },
  ] as const;

  get persona(): PersonaData | undefined {
    return personaCreationService.persona;
  }

  get avatarUrl(): string {
    return personaCreationService.avatarUrl;
  }

  get isStreaming(): boolean {
    return personaCreationService.isStreaming;
  }

  get scoreLabels(): readonly ScoreLabel[] {
    return PersonaCreateViewModel._SCORE_LABELS;
  }

  get isImageGenReady(): boolean {
    return imageGenerationService.isReady;
  }

  get hasMessages(): boolean {
    // Only count user messages — the initial assistant welcome doesn't count
    return this.messages.some((m) => m.role === 'user');
  }

  get generateButtonLabel(): string {
    return this.hasMessages ? '✨ Generate Character' : '🎲 Try My Luck';
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
      const slotIdx = _LPC_SLOT_INDEX.get(slotName);
      if (slotIdx === undefined) {
        continue;
      }
      const variants = _LPC_VARIANT_MAP.get(slotName);
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
    void routerService.goToDevRoute('config');
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  override async initialize(): Promise<void> {
    const model = (import.meta.env.PUBLIC_OPENROUTER_MODEL as string) || undefined;

    if (model) {
      aiSettingsService.setTextProvider({ model });
    }

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
      this.messages = await personaCreationService.sendMessage({
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
        personaCreationService.persona = persona;
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
      personaCreationService.persona = persona;
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
    personaCreationService.cancel();
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
      const uid = (authService as { uid?: string }).uid;
      if (!uid) {
        this.warn('uploadAvatar: not authenticated');
        return;
      }

      const url = await storageService.uploadAvatar({ file, uid });
      if (url) {
        personaCreationService.avatarUrl = url;
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
        const result = await imageGenerationService.generateImage({ prompt });
        personaCreationService.avatarUrl = result.url;
      } else if (this.regenerationMode === 'direct') {
        const prompt = this.directPrompt.trim();
        if (!prompt) {
          return;
        }
        const result = await imageGenerationService.generateImage({ prompt });
        personaCreationService.avatarUrl = result.url;
      } else if (this.regenerationMode === 'edit') {
        const instruction = this.editInstruction.trim();
        if (!instruction) {
          return;
        }
        const currentUrl = personaCreationService.avatarUrl;
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
    // Redirect to persona list
    await routerService.goToRoute('personas', {
      pathParameters: undefined,
      queryParameters: undefined,
    });
  }

  async enterWorld(): Promise<void> {
    await this._persistCharacter();

    // Clear any stale game state from a previous play session
    // so the new game starts with a clean inventory, quest log, etc.
    inventoryService.reset();
    worldStateService.reset();
    playerStateService.reset();
    equipmentService.reset();

    // Set persona as active if user is logged in
    const uid = (authService as { uid?: string }).uid;
    if (uid && this.persona?.id) {
      try {
        await personaService.setActivePersona(this.persona.id);
        this.info('enterWorld:active-set', { personaId: this.persona.id });
      } catch (error) {
        this.warn('enterWorld:active-set-failed (continuing anyway)', error);
      }
    }

    // Navigate to game
    await routerService.goToRoute('game', {
      queryParameters: undefined,
      pathParameters: undefined,
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
    let persistentAvatarUrl = personaCreationService.avatarUrl;
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

    // 1. Save locally to localStorage
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
      this.error('saveCharacter:local-failed', error);
    }

    // 2. Save to Firestore if user is signed in
    const uid = (authService as { uid?: string }).uid;
    if (uid) {
      try {
        // Upload avatar to Firebase Storage first, then save persona to Firestore
        let firestoreAvatarUrl = personaCreationService.avatarUrl;

        if (firestoreAvatarUrl?.startsWith('blob:')) {
          // Convert blob URL to a file and upload
          const blobResponse = await fetch(firestoreAvatarUrl);
          const blob = await blobResponse.blob();
          const file = new File([blob], `${persona.id}.png`, { type: blob.type || 'image/png' });

          // Use the character service's uploadAvatar
          const uploadedUrl = await characterService.uploadAvatar({
            file,
            characterId: persona.id,
          });
          if (uploadedUrl) {
            firestoreAvatarUrl = uploadedUrl;
          }
        }

        // Save to Firestore via personaService
        try {
          // Try update first (if exists), fallback is OK — updatePersona throws on missing doc
          await personaService.updatePersona(persona.id, {
            ...persona,
            avatarUrl: firestoreAvatarUrl || persona.avatarUrl || '',
          });
        } catch {
          // If update fails (doc doesn't exist), we'd need a create endpoint.
          // For now, log and move on — local save succeeded.
          this.warn(
            'saveCharacter:firestore-update-failed (doc may not exist — create not yet available)',
          );
        }

        this.info('saveCharacter:firestore', { id: persona.id });
      } catch (error) {
        this.error('saveCharacter:firestore-failed', error);
      }
    }
  }

  // ── Private: avatar editing (img2img) ────────────────────────────────

  private async _editAvatarImage(imageUrl: string, instruction: string): Promise<void> {
    // Fetch current avatar as blob
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error('Failed to fetch current avatar');
    }
    const blob = await response.blob();

    // Upload to ComfyUI
    const formData = new FormData();
    formData.append('image', blob, 'avatar.png');

    const uploadResponse = await fetch('/api/image/upload/image', {
      method: 'POST',
      body: formData,
    });

    if (!uploadResponse.ok) {
      throw new Error('Failed to upload image to ComfyUI');
    }
    const uploadResult = (await uploadResponse.json()) as { name?: string };
    const imageName = uploadResult.name;
    if (!imageName) {
      throw new Error('No image name returned from upload');
    }

    // Build img2img workflow
    const checkpoint = imageGenerationService.selectedCheckpoint || 'sd_xl_base_1.0';
    const ckptName = `${checkpoint}.safetensors`;

    const workflow = {
      '3': {
        // biome-ignore lint/style/useNamingConvention: API contract field name
        class_type: 'KSampler',
        inputs: {
          seed: Math.floor(Math.random() * 2 ** 32),
          steps: 25,
          cfg: 7.0,
          // biome-ignore lint/style/useNamingConvention: API contract field name
          sampler_name: 'euler',
          scheduler: 'normal',
          denoise: 0.5,
          model: ['4', 0],
          positive: ['6', 0],
          negative: ['7', 0],
          // biome-ignore lint/style/useNamingConvention: API contract field name
          latent_image: ['11', 0],
        },
      },
      // biome-ignore lint/style/useNamingConvention: API contract field name
      '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckptName } },
      '6': {
        // biome-ignore lint/style/useNamingConvention: API contract field name
        class_type: 'CLIPTextEncode',
        inputs: { text: `${instruction}, same person, same face, high quality`, clip: ['4', 1] },
      },
      '7': {
        // biome-ignore lint/style/useNamingConvention: API contract field name
        class_type: 'CLIPTextEncode',
        inputs: { text: 'deformed, different person, blurry, low quality', clip: ['4', 1] },
      },
      // biome-ignore lint/style/useNamingConvention: API contract field name
      '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
      '9': {
        // biome-ignore lint/style/useNamingConvention: API contract field name
        class_type: 'SaveImage',
        // biome-ignore lint/style/useNamingConvention: API contract field name
        inputs: { filename_prefix: 'aikami-edit', images: ['8', 0] },
      },
      // biome-ignore lint/style/useNamingConvention: API contract field name
      '10': { class_type: 'LoadImage', inputs: { image: imageName } },
      // biome-ignore lint/style/useNamingConvention: API contract field name
      '11': { class_type: 'VAEEncode', inputs: { pixels: ['10', 0], vae: ['4', 2] } },
    };

    // Queue the workflow
    const queueResponse = await fetch('/api/image/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // biome-ignore lint/style/useNamingConvention: API contract field name
      body: JSON.stringify({ client_id: `aikami-edit-${Date.now()}`, prompt: workflow }),
    });

    if (!queueResponse.ok) {
      throw new Error('Failed to queue image edit workflow');
    }

    // biome-ignore lint/style/useNamingConvention: API contract field name
    const { prompt_id: promptId } = (await queueResponse.json()) as { prompt_id: string };

    // Poll for result
    for (let attempt = 1; attempt <= 60; attempt++) {
      await new Promise((r) => setTimeout(r, 1000));
      const historyResponse = await fetch(`/api/image/history/${promptId}`);
      if (!historyResponse.ok) {
        continue;
      }

      const history = (await historyResponse.json()) as Record<string, unknown>;
      const entry = history[promptId] as Record<string, unknown> | undefined;
      const outputs = entry?.outputs as Record<string, unknown> | undefined;
      const node9 = outputs?.['9'] as
        | { images?: Array<{ filename: string; subfolder?: string }> }
        | undefined;
      const images = node9?.images;

      if (images && images.length > 0) {
        const img = images[0];
        const viewUrl = `/api/image/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder ?? '')}&type=output`;
        const blobResponse = await fetch(viewUrl);
        const newBlob = await blobResponse.blob();
        personaCreationService.avatarUrl = URL.createObjectURL(newBlob);
        return;
      }
    }

    throw new Error('Image edit timed out');
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
      const extracted = await textGenerationService.extractStructure({
        schema: CharacterExtractionSchema as unknown as Record<string, unknown>,
        schemaName: 'CharacterExtraction',
        prompt: compiledHistory,
        systemPrompt: CHARACTER_EXTRACTION_SYSTEM_PROMPT,
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
        this.lpcRecipe = extractedObj.lpcRecipe as Record<string, string>;
        // Persist lpcRecipe on the persona so the game engine can use it.
        // Contract C-158
        (persona.appearance as Record<string, unknown>).lpcRecipe = extractedObj.lpcRecipe;
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
    const p = personaCreationService.persona;
    if (!p) {
      return;
    }
    const imagePrompt =
      p?.appearance?.physicalDescription ||
      (p?.race && p?.class
        ? `${p.race} ${p.class}, fantasy character portrait`
        : p?.name || 'fantasy character');
    personaCreationService.startAvatarGeneration({ prompt: imagePrompt });
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

export const getPersonaCreateViewModel = (
  options: PersonaCreateViewModelOptions,
): PersonaCreateViewModelInterface => {
  return new PersonaCreateViewModel(options);
};
