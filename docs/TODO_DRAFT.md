# Aikami Less Organized TODO

> **Merge status:** the 3-modes vision, the legacy-code removal list, and the
> Data Connect scoping note below have been absorbed into `docs/TODO.md`
> (see C-320 AI Provider Gateway, C-321 Turso persistence, C-324 legacy
> cleanup, and the Legacy Backlog Merge Map / Explicitly Deferred sections).
> The remaining engineering-hygiene items further down (import discipline,
> `.pi` tooling, skill bloat, etc.) are still open and not yet contracted —
> they are unrelated to the AI/persistence vision change and can be picked up
> independently.

- 3 Modes to play aikami — **merged into `docs/TODO.md` C-320/C-323/C-356/C-357**
    - Offline first, it can use local ollama, comfyui, kokoro, and does not need firebase (but can enable it)
    - Web client, hosted on firebase hosting with byok (bring your own key) and also firebase is optional
    - No setup required, it uses firebase and cloud run and pay with stripe based on usage (we deploy the docker in apps/backend/image|voice|text to cloud run)
        - For no setup we should have the models in storage not in docker image to speed up cold starts
        - Considering of doing the same with ollama or if we use model garden from gcp
- Remove all legacy, backwards compatible code, and unused code and projects, example i don't think we use — **merged into `docs/TODO.md` C-324**
    - packages/backend/ai
    - packages/backend/image/src/index.ts
    - packages/backend/svelte-kit/package.json
- Migrate firestore database to dataconnect, like npc, chat, items etc. since we are using apps/backend/firebase/dataconnect/dataconnect.yaml and firestore we should use dataconnect where it makes sense and firestore where it makes sense — **superseded**: Turso is now the campaign-runtime source of truth (C-321); Data Connect is revisited only for a genuine dashboard/reporting/admin use case, not as the NPC/chat/items store (see Explicitly Deferred section in `docs/TODO.md`)
- Create a tilemap editor, maybe add a new frontend app that is sveltekit but ssr that we host on cloud run similar to nordclaw, it will be like for creator.aikami.com, and it will be posible to create and edit tilemaps, items, npc, quests, and other game content. maybe even add mod support, like you can upload own — **tracked as a future evolution of C-358** in `docs/TODO.md`, not Phase 1 scope
- Use secretspec with gcsm https://secretspec.dev/quick-start (it garanties that you have the secrets before you build/dev)
- There are some await import('... that should be refactored
    - in .pi and client, and engine (probably other places as well)
- We import @aikami/frontend/configs/firestore.ts directly somewhere, we should force to always use repositories: packages/frontend/repositories/src/lib/.
    - it is in apps/frontend/client/src/lib/services/agent/agent_registry_service.svelte.ts
    - apps/frontend/client/src/lib/services/chat/connected_chats_service.svelte.ts
    - apps/frontend/client/src/lib/services/npc/npc_schedule_service.svelte.ts
- prevent using "as"
- @inheritdoc is not needed
- Consider making all classes in packages/frontend/engine/ use BaseClass and initalize with Class.create() to auto debug log
- Remove all hard local refrences to relative paths: aka /home/sonny/Development/Projects/passion/aikami/
- convert .pi to use bun instead of node (optimized bun tools like Bun.file)
- consider setting up bun in mcp .pi/mcp.json, maybe other mcp tools
- consider creating internal mcp instead of tool calling
- Refactor .pi/skills/aikami-conventions/SKILL.md to bloated.
- consinder removing .pi/generated-skills/daisyui, maybe llm already knows daisyui
