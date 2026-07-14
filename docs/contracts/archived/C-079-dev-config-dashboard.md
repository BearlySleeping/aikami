<!-- completed: 2026-06-09 -->
## Metadata

| Field                | Value                                                                            |
| -------------------- | -------------------------------------------------------------------------------- |
| **Source**           | Aikami reference: `knowledge/contracts/TEMPLATE.md`                              |
| **Target**           | `apps/frontend/client/src/lib/views/dev/config/` — Ultimate Configuration Dashboard |
| **Priority**         | P2 — Establishes the central hub for all developer and system configurations     |
| **Dependencies**     | C-078                                                                            |
| **Status**           | **completed**                                                                        |
| **Contract version** | 1.0.0                                                                            |

## Overview

This contract establishes the `/dev/config` dashboard, a centralized interface for managing system settings. It will handle API key storage (local + Firestore sync), preferred model selection across multiple providers (OpenRouter, Gemini, Anthropic, ChatGPT, DeepSeek), and configuration settings for memory, voice, and image systems. It will also feature auto-detection for locally running services (ComfyUI, voice, text).

## Design Reference

**Aikami pattern**: `references/design-draft/config/`

Key structural elements:

- Glassmorphic-Industrial design language (deep space background, electric violet primary, neon cyan secondary).
- Progressive disclosure via collapsible cards.
- Tabbed navigation for categorizing settings (e.g., General, Models, Voice, Image).
- Status indicators for local service detection (green/amber dots).

## Architecture Directives

- Config View Model
- Config Service (handles local storage and Firestore sync)
- Local Service Detector (polls local ports for status)
- Configuration UI Layout (Tabs, Cards, Inputs)

## State & Data Models

    interface ConfigState {
        apiKeys: {
            openrouter?: string;
            gemini?: string;
            anthropic?: string;
            openai?: string;
            deepseek?: string;
        };
        preferredModel: string;
        memoryConfig: MemoryConfig;
        voiceConfig: VoiceConfig;
        imageConfig: ImageConfig;
    }

    interface LocalServiceStatus {
        comfyUi: 'connected' | 'disconnected';
        voice: 'connected' | 'disconnected';
        text: 'connected' | 'disconnected';
    }

## Acceptance Criteria

### AC-1: Tabbed Configuration Layout

**Given** the user navigates to `/dev/config`
**When** the page loads
**Then** a tabbed interface is displayed, organizing settings into logical groups (e.g., API Keys, Models, Voice, Image, Memory), styled according to the Glassmorphic-Industrial design draft.

**Test Hooks**:

- Unit: Verify ConfigViewModel initializes with the correct active tab state.
- Integration: Render the view and assert the presence of tab navigation elements.

### AC-2: API Key Management & Sync

**Given** the user enters an API key in the configuration form
**When** the field loses focus or a save action is triggered
**Then** the key is saved securely to local storage and, if authenticated, synced to the user's Firestore configuration document.

**Test Hooks**:

- Unit: Mock ConfigService and verify that saving an API key triggers both local storage updates and Firestore mutation calls.
- Integration: Test the debounced save behavior in the ConfigViewModel.

### AC-3: Local Service Auto-Detection

**Given** the configuration dashboard is active
**When** local services (ComfyUI on 8188, Voice on 8089, Text on 11436) are running
**Then** the UI displays active status indicators (e.g., green dot "CONNECTED") for each detected service.

**Test Hooks**:

- Unit: Mock LocalServiceDetector HTTP calls and verify status updates in the ViewModel.
- Integration: Ensure status indicators update correctly based on mocked service availability.

### AC-4: Domain Settings (Memory, Voice, Image)

**Given** the user navigates to the Voice, Image, or Memory tabs
**When** interacting with the specific configuration inputs (e.g., voice style, image checkpoint, memory limits)
**Then** the settings update the central `ConfigState` and trigger the save lifecycle.

**Test Hooks**:

- Unit: Verify that modifications to nested configuration objects correctly update the `ConfigState` and emit save events.

## Implementation Notes

1. **Files to create**:
    - `apps/frontend/client/src/lib/views/dev/config/config_view.svelte`
    - `apps/frontend/client/src/lib/views/dev/config/config_view_model.svelte.ts`
    - `apps/frontend/client/src/lib/client/services/config/config_service.svelte.ts`
    - `apps/frontend/client/src/lib/client/services/config/local_service_detector.ts`
    - `apps/frontend/client/src/routes/(dev)/dev/config/+page.svelte`
    - `apps/frontend/client/src/routes/(dev)/dev/config/+page.ts`
2. **Files to modify**:
    - `apps/frontend/client/src/lib/views/dev/dev_view_model.svelte.ts` (Add to navigation)
3. **Order of operations**:
    - Define ConfigState interfaces and ConfigService for local/remote sync.
    - Implement LocalServiceDetector.
    - Build ConfigViewModel to bridge state to UI.
    - Construct the Glassmorphic-Industrial UI in `config_view.svelte`.
    - Wire route and navigation.
4. **Verification**:
    - Ensure `validate({ test: true })` passes.
    - Visually verify the UI matches the design specs in `/dev/config`.

## Edge Cases & Gotchas

- **Firestore Sync Conflict**: Handle cases where local state and remote state drift, prioritizing remote state on initial load but respecting local unsaved changes.
- **Service Detection CORS**: Ensure local service detection doesn't fail silently due to CORS issues when polling local ports from the Client. Use appropriate preflight or no-cors fetch modes if necessary.
