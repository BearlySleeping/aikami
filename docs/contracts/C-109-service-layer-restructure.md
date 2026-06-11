# Contract C-109: Service Layer Restructure & Client Flattening

## Context
Since the PWA is strictly a Tauri SPA, the `src/lib/client/` directory is redundant. Furthermore, the `client/services/` folder has become a "junk drawer" organized by technology (`api/`, `database/`, `media/`) rather than by feature. We need to flatten the folder structure and reorganize the services into cohesive, feature-based modules.

## Scope
- `apps/frontend/client/src/lib/client/*` -> `apps/frontend/client/src/lib/*`

## Acceptance Criteria
- [x] **Flatten Client:** Move the contents of `src/lib/client/game`, `src/lib/client/services`, and `src/lib/client/utils` up one level to `src/lib/game`, `src/lib/services`, and `src/lib/utils`. Delete the empty `client/` folder.
- [x] **Feature-Based Grouping:** Inside the new `src/lib/services/`, eliminate technology-based folders (`api/`, `database/`, `media/`). Move their contents into feature-based folders. For example:
  - `database/chat.svelte.ts` -> `chat/chat_repository.ts` (or merged into `chat.svelte.ts`)
  - `media/tts.svelte.ts` -> `audio/tts_service.svelte.ts`
  - `database/npc.svelte.ts` -> `npc/npc_repository.ts`
  - `api/ai.svelte.ts` -> `ai/ai_service.svelte.ts`
- [x] **Import Fixes:** Perform a massive workspace search-and-replace to fix all broken imports caused by moving `client/*` and restructuring the services.
- [x] **Shared Packages Enforcement:** While moving these files, ensure they are strictly importing schemas/types from `@aikami/shared-types` or `@aikami/shared-schemas` rather than defining local domain interfaces.

## Implementation Notes
1. Take this slow. The `src/lib/client/services/` folder has a lot of files. Do not try to rewrite the logic of the files yet. Focus purely on physically moving them into the new feature-folders and fixing the import paths so the app compiles.
2. If you find a file in `database/` that is purely making fetch/Firebase calls, rename it to `[feature]_repository.ts` when moving it to its feature folder to clearly distinguish it from Svelte `$state` services.

## Edge Cases
- Watch out for barrel exports (`index.ts`) in the services folder. They will need to be heavily updated or removed.

---

## Execution Log — 2026-06-10

### Step 1: Flatten `src/lib/client/`
- Moved `client/game/` → `lib/game/`
- Moved `client/services/` → `lib/services/`
- Moved `client/utils/` → `lib/utils/`
- Deleted empty `client/` directory

### Step 2: Analyze tech-folders and create mapping
Analyzed all 28 files across `api/` (4), `database/` (5), and `media/` (19). Identified 11 new feature-domain folders: `ai`, `analytics`, `audio`, `auth`, `expression`, `image`, `notification`, `npc`, `persona`, `storage`, `user`.

### Step 3: Feature-based move & rename

| # | Source | Destination |
|---|--------|-------------|
| 1 | `api/ai.svelte.ts` | `ai/ai_service.svelte.ts` |
| 2 | `api/analytic.svelte.ts` | `analytics/analytics_service.svelte.ts` |
| 3 | `api/auth.svelte.ts` | `auth/auth_service.svelte.ts` |
| 4 | `api/storage.svelte.ts` | `storage/storage_service.svelte.ts` |
| 5 | `database/chat.svelte.ts` | `chat/npc_chat_repository.svelte.ts` |
| 6 | `database/notification.svelte.ts` | `notification/notification_repository.svelte.ts` |
| 7 | `database/npc.svelte.ts` | `npc/npc_repository.svelte.ts` |
| 8 | `database/persona.svelte.ts` | `persona/persona_repository.svelte.ts` |
| 9 | `database/user.svelte.ts` | `user/user_repository.svelte.ts` |
| 10 | `media/ai_text_intelligence_service.svelte.ts` | `ai/ai_text_intelligence_service.svelte.ts` |
| 11 | `media/ai_text_intelligence_service.test.ts` | `ai/ai_text_intelligence_service.test.ts` |
| 12 | `media/sentence_boundary_chunker.ts` | `ai/sentence_boundary_chunker.ts` |
| 13 | `media/sentence_boundary_chunker.test.ts` | `ai/sentence_boundary_chunker.test.ts` |
| 14 | `media/stream_orchestrator.svelte.ts` | `ai/stream_orchestrator_service.svelte.ts` |
| 15 | `media/stream_orchestrator.test.ts` | `ai/stream_orchestrator_service.test.ts` |
| 16 | `media/audio_context_manager.ts` | `audio/audio_context_manager.ts` |
| 17 | `media/audio_queue_player.ts` | `audio/audio_queue_player.ts` |
| 18 | `media/audio_queue_player.test.ts` | `audio/audio_queue_player.test.ts` |
| 19 | `media/tts.svelte.ts` | `audio/tts_service.svelte.ts` |
| 20 | `media/context_builder.ts` | `chat/context_builder.ts` |
| 21 | `media/context_builder.test.ts` | `chat/context_builder.test.ts` |
| 22 | `media/conversation_repository.svelte.ts` | `chat/conversation_repository.svelte.ts` |
| 23 | `media/expression_asset_resolver.ts` | `expression/expression_asset_resolver.ts` |
| 24 | `media/expression_asset_resolver.test.ts` | `expression/expression_asset_resolver.test.ts` |
| 25 | `media/image_generation.svelte.ts` | `image/image_generation_service.svelte.ts` |
| 26 | `media/image_generation.test.ts` | `image/image_generation_service.test.ts` |
| 27 | `media/pixi_texture_injector.ts` | `game/pixi_texture_injector.ts` |
| 28 | `media/pixi_texture_injector.test.ts` | `game/pixi_texture_injector.test.ts` |

Deleted empty tech-folders: `api/`, `database/`, `media/`.

### Step 4: Internal import fixes (moved files)
- `ai/stream_orchestrator_service.svelte.ts`: updated 5 cross-feature imports (`audio/`, `chat/`, `expression/`, `game/`, and same-folder `sentence_boundary_chunker`)
- `ai/ai_text_intelligence_service.svelte.ts`: `$lib/client/services/config/` → `$lib/services/config/`
- `auth/auth_service.svelte.ts`: `./analytic.svelte.ts` → `../analytics/analytics_service.svelte.ts`

### Step 5: Barrel export update
Updated `services/index.ts`: removed old `api/`, `database/`, `media/` paths; added new feature paths including renamed files.

### Step 6: SvelteKit alias updates (`svelte.config.js`)
- `$services`: `lib/client/services` → `lib/services`
- `$i18n`: `lib/client/utils/i18n` → `lib/utils/i18n`

### Step 7: Bulk import path replacement
- `$lib/client/game/` → `$lib/game/` (28 files in game engine)
- `$lib/client/services/` → `$lib/services/` (components, views, config)
- `$lib/client/utils/` → `$lib/utils/` (config service)
- Old file-name references (`media/ai_text_intelligence_service.svelte.ts`, `media/stream_orchestrator.svelte.ts`, `media/tts.svelte.ts`, `media/image_generation.svelte.ts`) → new names
- Relative `/client/services/`, `/client/game/`, `/client/utils/` → `/services/`, `/game/`, `/utils/`

### Step 8: Validation
- `client:typecheck` — 0 errors, 0 warnings ✅
- `client:build` — passed ✅
- `client:test` — passed ✅
