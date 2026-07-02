## Metadata

| Field | Value |
|---|---|
| **Source** | RisuAI Auxiliary Settings (`examples/web/Risuai/src/lib/Setting/Pages/OtherBotSettings.svelte`) |
| **Target** | `apps/frontend/client/src/lib/views/settings/providers/` & `src/lib/services/config/` |
| **Priority** | P2 — Essential for power-user customization of auxiliary AI systems |
| **Dependencies** | ConfigService, ProvidersViewModel |
| **Status** | not_started |
| **Contract version** | 1.0.0 |

## Overview

Aikami currently supports basic configuration for Voice (Kokoro), Image (ComfyUI), and Memory. To support power users, we need to implement the extensive provider ecosystems found in RisuAI (e.g., NovelAI, Dall-E, Stability, ElevenLabs, Voicevox, and advanced vector memory settings). This contract expands the `ConfigService` state to hold these new parameters and refactors the `providers_view.svelte` to cleanly manage the complex UI through dedicated sub-components.

## Design Reference

Look at RisuAI's `OtherBotSettings.svelte` for the exhaustive list of configuration fields per provider. Note how they conditionally render configuration blocks (like `sdConfig`, `NAIImgConfig`, or `comfyConfig`) based on the selected provider. 
We will port this logic into Aikami's MVVM pattern, storing the data in `ConfigService` and exposing it via `ProvidersViewModel`.

For testing: **Playwright** handles functional E2E (`tests/*.spec.ts`). Do NOT create `*_visual.spec.ts` files. See `.pi/skills/testing/SKILL.md` for conventions.

## Architecture Directives

1. **Config Expansion**: Expand `VoiceConfig`, `ImageConfig`, and `MemoryConfig` interfaces in `config_service.svelte.ts` to accommodate the new providers and their specific parameters.
2. **Add Emotion Config**: Add a new `EmotionConfig` section to handle how character emotions are resolved (e.g., via LLM submodel vs. MiniLM embeddings).
3. **View Componentization**: `providers_view.svelte` is getting too large. Extract the tab bodies into separate components in `src/lib/views/settings/providers/tabs/`:
   - `ImageTab.svelte`
   - `VoiceTab.svelte`
   - `MemoryTab.svelte`
   - `EmotionTab.svelte`
4. **Conditional Rendering**: In the new tab components, use the selected provider (e.g., `viewModel.config.image.provider`) to conditionally render the required inputs (URLs, specific API keys, Samplers, CFG scales).

## State & Data Models

    // Expand existing ImageConfig
    interface ImageConfig {
        provider: 'comfyui' | 'webui' | 'novelai' | 'dalle' | 'stability' | 'fal' | 'openai-compat';
        url?: string;
        apiKey?: string;
        model?: string;
        width: number;
        height: number;
        steps: number;
        cfgScale: number;
        sampler?: string;
        enableI2I?: boolean;
        // Provider specific overrides
        comfyWorkflow?: string;
        novelAiNoiseSchedule?: string;
    }

    // Expand existing VoiceConfig
    interface VoiceConfig {
        provider: 'kokoro' | 'elevenlabs' | 'voicevox' | 'openai' | 'fish-speech';
        url?: string; // For local/custom servers like Voicevox
        apiKey?: string;
        voiceId: string;
        speed: number;
        pitch: number;
        autoSpeech: boolean;
        voiceArchetypes: VoiceArchetype[];
    }

    // Expand MemoryConfig
    interface MemoryConfig {
        type: 'none' | 'basic' | 'hypa-style' | 'hanurai';
        embeddingModel: 'minilm' | 'nomic' | 'bge' | 'openai' | 'voyage' | 'custom';
        embeddingUrl?: string;
        embeddingKey?: string;
        contextWindow: number;
        maxTurns: number;
        summarizationThreshold: number;
        chunkSize: number;
        longTermMemory: boolean;
    }

    // New EmotionConfig
    interface EmotionConfig {
        method: 'submodel' | 'embedding';
        targetModel?: string;
    }

## Scope Boundaries

- **In Scope:** - Updating types in `ConfigService`.
  - Creating the new Svelte components for the tabs.
  - Wiring the inputs to `ProvidersViewModel.setField(...)`.
  - Debounced saving of the new configurations.
- **Out of Scope:** - Implementing the actual backend execution logic for NovelAI, WebUI, or Voyage. This contract strictly handles capturing and persisting the user's configuration preferences in the frontend.

## Acceptance Criteria

### AC-1: Image Provider Toggling
**Given** the user is on the Image settings tab
**When** they change the provider dropdown from 'comfyui' to 'novelai'
**Then** the UI should hide ComfyUI workflow settings and display NovelAI specific settings (API Key, Sampler, Noise Schedule).

**Test Hooks**:
- Moon Task: `moon run client:test`
- Integration: Manually toggle between 3 providers and verify UI updates.
- E2E: `tests/client/auxiliary_settings.spec.ts` - Select different providers and verify the correct input fields become visible and writable.

### AC-2: TTS Custom URLs
**Given** the user selects 'voicevox' as their TTS provider
**When** they look at the Voice tab
**Then** an input for a custom server URL should be visible and bound to the config state.

**Test Hooks**:
- Moon Task: `moon run client:test`

### AC-3: Memory Embedding Selection
**Given** the user is on the Memory settings tab
**When** they select a 'custom' embedding model
**Then** inputs for a custom API URL and Key should appear.

**Test Hooks**:
- Moon Task: `moon run client:test`
- E2E: `tests/client/auxiliary_settings.spec.ts` - Verify state binding for memory chunk size and embedding models.

## Implementation Sequence

1. **Phase 1 (Data/Logic)**: Update `ConfigService` interfaces and default states. Extend `ProvidersViewModel` if any new computed properties or specific verification methods (like `verifyVoicevox()`) are needed.
2. **Phase 2 (Integration)**: Refactor `providers_view.svelte`. Extract existing logic into the new `/tabs/` components. Implement the new conditional provider fields based on RisuAI's UI structure.
3. **Phase 3 (Validation)**: Run tests and ensure debounced saving triggers correctly when adjusting the new sliders and inputs.

## Edge Cases & Gotchas

- **Shared API Keys**: RisuAI sometimes falls back to a global OpenAI key if a specific one isn't provided. Consider if `apiKey` fields should show placeholder text indicating it will use the main provider key if left blank.
- **Data Migration**: Existing users will have the old `ImageConfig` shape. Ensure `ConfigService` initialization safely merges new default keys so the app doesn't crash when trying to read `provider` from an older save state.
