# Engineering Hygiene & Maintenance

> Ongoing codebase health items — not contracts, but tracked here.

## Engineering Hygiene & Maintenance

> Items from the former `docs/TODO_DRAFT.md` that are still open and
> actionable — not yet contracted but tracked here.

- **Import discipline:** Several modules import `@aikami/frontend/configs/firestore.ts`
  directly instead of going through repositories (`packages/frontend/repositories`):
    - `apps/frontend/client/src/lib/services/agent/agent_registry_service.svelte.ts`
    - `apps/frontend/client/src/lib/services/chat/connected_chats_service.svelte.ts`
    - `apps/frontend/client/src/lib/services/npc/npc_schedule_service.svelte.ts`
- **Dynamic imports:** There are `await import(...)` calls in `.pi/`, client,
  and engine (and possibly elsewhere) that should be refactored to static imports
  or explicit lazy-loading boundaries.
- **Type assertions:** Prevent using `as` casts; prefer type guards and schema
  validation.
- **JSDoc hygiene:** `@inheritdoc` is not needed and should be removed project-wide.
- **Engine base class:** Consider making all classes in `packages/frontend/engine/`
  use a `BaseClass` pattern with `Class.create()` for auto debug logging.
- **Hardcoded local paths:** Remove all hardcoded absolute paths referencing
  `/home/sonny/Development/Projects/passion/aikami/`.
- **`.pi` tooling:** Convert `.pi/` scripts to use Bun instead of Node
  (e.g. `Bun.file` for optimized file I/O).
- **MCP configuration:** Consider setting up Bun runtime in `.pi/mcp.json`;
  evaluate whether internal MCP tools should replace direct tool calling.
- **Skill bloat:** Refactor `.pi/skills/aikami-conventions/SKILL.md` (too large);
  consider removing `.pi/generated-skills/daisyui` (LLM already knows daisyUI well).
- **Service layer between ViewModels:** ViewModels that subscribe to other
  ViewModels' events should have an intermediate service layer so ViewModels
  remain stateless and focused on presentation.
- **Secrets management:** Use `secretspec` with GCP Secret Manager
  (`https://secretspec.dev/quick-start`) to guarantee secrets are available
  before build/dev.
- **Creator app:** A `creator.aikami.com` content-authoring web app (SSR
  SvelteKit on Cloud Run, similar to NordClaw) for creating/editing tilemaps,
  items, NPCs, quests, with mod upload support — tracked as a future evolution
  of C-358, not Phase 1 scope.

---
