## Metadata

| Field | Value |
|---|---|
| **Source** | Marinara-Engine `docs/IMAGE_GENERATION.md` (style profiles, prompt compilation, per-image tags, review-before-generate); TODO.md C-ME-013 |
| **Target** | `apps/frontend/client/src/lib/services/image/` + `apps/frontend/client/src/lib/views/gallery/` — Style profiles, prompt compilation, contextual triggers, review flow, gallery panel |
| **Priority** | P2 — Visuals dramatically enhance immersion; currently a major gap despite existing ComfyUI integration |
| **Dependencies** | `imageGenerationService` (435 lines — EXISTS with ComfyUI + checkpoint loading), C-230 (Connection config — COMPLETED), C-233 (World-Gen Wizard — COMPLETED for art style prompt), `combat_inline_image.svelte` (EXISTS), `combat_gallery.svelte` (EXISTS) |
| **Status** | not_started |
| **Contract version** | 1.0.0 |

## Overview

Aikami already has a strong ComfyUI integration (`imageGenerationService`, 435 lines) with checkpoint loading and image generation via local ComfyUI. What's missing is Marinara's sophisticated prompt pipeline: **style profiles** (named profiles with prompt grammar + positive/negative tags), **prompt compilation** (cleanup near-duplicates, move negative phrases), **contextual triggers** (combat → battle scene, new location → location art), **review-before-generate**, and a unified **gallery panel**. This contract adds these layers on top of the existing generation service.

## Design Reference

**Existing code to extend:**
- `apps/frontend/client/src/lib/services/image/image_generation_service.svelte.ts` (435 lines) — `generateImage()`, `loadCheckpoints()`, `CheckpointInfo`, `ImageGenerationResult`
- `apps/frontend/client/src/lib/views/combat/components/combat_inline_image.svelte` (96 lines) — inline image rendering in combat log
- `apps/frontend/client/src/lib/views/combat/components/combat_gallery.svelte` (65 lines) — gallery tab in combat sidebar
- C-233's `WorldGenOutput.artStylePrompt` — unified art style from world-gen

**Marinara-Engine inspiration:**
- `examples/Marinara-Engine/docs/IMAGE_GENERATION.md` — style profiles, prompt compilation, connection defaults

**Testing conventions:** See `.pi/skills/testing/SKILL.md`.

## Architecture Directives

- **Style profile system**: `ImageStyleProfile[]` stored in `ConfigService`. Built-in profiles: Auto, Anime, Realistic, Cinematic, Fantasy, Pixel Art. Each has `promptGrammar` (naturalLanguage/danbooru/commaTags), `positiveTags`, `negativeTags`, `perImageTags` (background/portrait/illustration/sprite-specific). User-editable.
- **Prompt compiler**: `compileImagePrompt(basePrompt, profile, imageType)` — merges base prompt with style profile, removes near-duplicate tags, moves `avoid text` / `no watermark` to negative prompt, adds per-image-type tags. Returns `{ positive, negative }`.
- **Contextual triggers**: Lightweight system detecting game events and generating image prompts.
  - `location_changed` → background image for new location
  - `combat_started` → battle scene background
  - `npc_introduced` → NPC portrait
  - `dramatic_moment` → scene illustration
  - `quest_completed` → commemorative illustration
- **Review flow**: Global toggle "review prompts before generation". When enabled, a modal shows the compiled prompt → user can edit → confirm or cancel.
- **Gallery panel**: Unified gallery across combat, exploration, and NPC interactions. Per-chat (per-session). Masonry grid layout. Hover to expand. Click for full-res modal. Store image metadata in chat.

## State & Data Models

    interface ImageStyleProfile {
        id: string; name: string; isBuiltIn: boolean;
        promptGrammar: 'naturalLanguage' | 'danbooru' | 'commaTags';
        positiveTags: string;       // "masterpiece, best quality, detailed"
        negativeTags: string;       // "lowres, bad anatomy, watermark"
        perImageTags: {             // Additional tags per image type
            background?: string;    // "scenic, wide shot, environment"
            portrait?: string;      // "portrait, upper body, detailed face"
            illustration?: string;  // "dynamic pose, action scene, dramatic lighting"
            sprite?: string;        // "pixel art, sprite sheet, 32x32"
        };
    }

    interface GalleryImage {
        id: string; chatId: string; url: string;
        prompt: string; imageType: ImageType;
        generatedAt: string; characterName?: string;
    }

    type ImageType = 'background' | 'portrait' | 'illustration' | 'sprite' | 'selfie';

## Scope Boundaries

- **In Scope:**
  - `ImageStyleProfile` data model + 6 built-in profiles
  - `compileImagePrompt()` — tag dedup, negative extraction, per-image-type tags
  - Contextual triggers: location change, combat start, NPC intro, dramatic moment, quest completion
  - Review-before-generate toggle + edit modal
  - Per-chat gallery panel: masonry grid, hover expand, full-res modal
  - Wire contextual triggers into dialogue/combat ViewModels
  - Dev sandbox: `/dev/image-gen`
  - Unit tests, Playwright E2E (`tests/client/image_gen.spec.ts`), Visual (`suites/image_gen.visual.ts`), POM (`src/pom/image_gen_page.ts`)
- **Out of Scope:**
  - New image providers beyond ComfyUI (separate contract)
  - Video generation (separate contract)
  - Sprite sheet generation (LPC handles this)
  - Image-to-image / inpainting (separate contract)

## Acceptance Criteria

### AC-1: Style Profile System
**Given** the user opens Image Generation settings
**When** they select a style profile (e.g. "Anime"), edit the positive tags, and save
**Then** the profile is applied to subsequent image generations; built-in profiles cannot be deleted

**Test Hooks**:
- Unit Test: `style_profiles.test.ts` — CRUD, built-in immutability, profile application
- E2E: `tests/client/image_gen.spec.ts` — select profile → generate → verify tags in prompt
- Visual: `suites/image_gen.visual.ts` — style profile editor

### AC-2: Prompt Compilation
**Given** base prompt "a dark forest, masterpiece, best quality, avoid text" + Anime profile
**When** `compileImagePrompt()` runs
**Then** deduplicated: "a dark forest, masterpiece, best quality"; negative: "lowres, bad anatomy, text, watermark"

**Test Hooks**:
- Unit Test: `prompt_compiler.test.ts` — dedup, negative extraction, per-image-type tag injection

### AC-3: Contextual Triggers
**Given** the party enters a new location "The Crystal Caverns"
**When** the location change event fires
**Then** a background image is auto-generated for "The Crystal Caverns" using the active style profile

**Test Hooks**:
- E2E: `tests/client/image_gen.spec.ts` — enter new location → verify background generated; start combat → verify battle scene generated
- Visual: `suites/image_gen.visual.ts` — contextual generation result

### AC-4: Review & Gallery
**Given** review-before-generate is enabled
**When** an image generation is triggered
**Then** a modal shows the compiled prompt; user can edit + confirm; generated image appears in the gallery panel with prompt metadata

**Test Hooks**:
- E2E: `tests/client/image_gen.spec.ts` — enable review → trigger → edit prompt → confirm → verify in gallery
- Visual: `suites/image_gen.visual.ts` — review modal + gallery panel

### AC-5: Dev Sandbox
**Given** navigate to `/dev/image-gen`
**When** page loads
**Then** style profile editor, prompt compiler test area with live output, contextual trigger simulator, gallery viewer

**Test Hooks**:
- E2E: functional
- Visual: `suites/image_gen.visual.ts` — sandbox

## Implementation Sequence

### Phase 1: Data Layer
1. `ImageStyleProfile` + `GalleryImage` types + Zod schemas
2. 6 built-in style profiles
3. `compileImagePrompt()` pure function
4. Contextual trigger detection + prompt generation
5. Gallery CRUD in chat metadata
6. Unit tests: `style_profiles.test.ts`, `prompt_compiler.test.ts`, `contextual_triggers.test.ts`, `gallery_store.test.ts`

### Phase 2: ViewModel
1. `style_profile_view_model.svelte.ts` — profile editor
2. `gallery_view_model.svelte.ts` — image list, expand, delete
3. Wire contextual triggers into dialogue + combat ViewModels

### Phase 3: Views
1. `style_profile_editor.svelte` — DaisyUI form
2. `review_before_generate_modal.svelte` — prompt preview + edit
3. `gallery_panel.svelte` — masonry grid
4. Dev sandbox: `/dev/image-gen`

### Phase 4: Validation
1. `moon run client:fix && moon run client:typecheck && moon run client:test`
2. `cd apps/e2e && bun run test && bun run test:visual`

## Edge Cases & Gotchas

- **ComfyUI timeout**: Generation can take 30+ seconds. Show spinner with estimated time. Timeout at 120s.
- **Tag dedup**: Case-insensitive. "Masterpiece" = "masterpiece". Keep first occurrence.
- **Contextual trigger flood**: Debounce same-type triggers — max 1 background per 30s, max 1 portrait per NPC per session.
- **Gallery storage**: Store image URLs + metadata only — not base64. Images served from ComfyUI output directory.
- **Built-in profile cloning**: User can clone a built-in profile to create a custom variant. Built-in originals remain immutable.
