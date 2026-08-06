# Product Vision

Aikami is an AI-powered platform for creating and experiencing immersive 2D RPG adventures, built by **BearlySleeping**.

## Core Vision

An AI-driven living world where every NPC has a personality, memory, and agenda. Users create and manage characters (Personas), interact with AI-driven NPCs through natural dialogue, and participate in dynamic storytelling that evolves based on their choices. It is a **game first** — the player launches into a spatial world, not a chat dashboard — and it is **offline-first**: campaigns, saves, and chat history live in a local Turso (libSQL) database and work with zero network. A community **Hub** (SvelteKit SSR on Cloud Run) hosts shared assets, maps, mods, and your own characters/personas.

## What Makes It Different

- **AI-Driven NPCs**: Every NPC has a unique personality, system prompt, and first message. AI generates dynamic responses based on the character's traits and the conversation context.
- **D&D-Style Character Sheets**: Full ability scores, skills, saving throws, appearance, hit points — the complete tabletop RPG experience in a chat interface.
- **Rich World Building**: Lorebooks, knowledge graphs, character relationships, and world state that persist and evolve.
- **Cross-Platform**: PWA for web/mobile, desktop via Tauri, SSR Hub on Cloud Run.
- **Offline-First**: Campaigns, saves, and chat history live in a local Turso (libSQL) database — play with zero network; cloud is an optional sync layer, never a boot dependency.
- **Local AI by Default**: Text, image, and voice generation run locally via Docker microservices (Ollama, ComfyUI, Kokoro); BYOK cloud keys are an option.

## User Experience

1. **Create a Persona**: Your in-game identity with character sheet, avatar, and backstory
2. **Meet NPCs**: Browse public NPCs or create your own with custom personalities
3. **Chat & Roleplay**: Natural dialogue with AI-driven responses that honor character traits
4. **Build Relationships**: Dynamic relationship tracking (ally, enemy, friend, romantic, rival)
5. **Explore Worlds**: Shared or private worlds with lorebooks, knowledge graphs, and persistent state

## Technical Vision

- **Monorepo architecture**: All code in one place, shared packages, consistent tooling (moon + Bun)
- **Offline-first**: Turso (libSQL) is the local source of truth — local campaign creation, play, and saving must never depend on Firebase availability or sign-in
- **Game first**: Launch into a spatial world, not a chat dashboard; deterministic rules are authoritative while AI handles character and prose
- **One AI gateway, three modes**: All text/image/voice generation goes through `AiProviderGateway` — offline (local), BYOK (cloud key), or service (Aikami-hosted)
- **Local AI microservices**: Ollama (text), ComfyUI (image), and Kokoro (voice) run locally via Docker/herdr
- **SvelteKit Client + Hub**: Fast, installable PWA plus an SSR community hub on Cloud Run
- **Desktop**: Native 2D RPG experience via Tauri v2

## Current Status (July 2026)

**Phase: Offline-First Playable Slice** — 350+ contracts implemented and verified through the contract pipeline (write → critique → implement → verify → review → merge).

**Implemented:**
- ✅ Client with auth, personas, NPCs, chat, dashboard, and the spatial game client (PixiJS v8 + bitECS engine in `packages/frontend/engine`)
- ✅ Offline-first persistence — Turso (libSQL) is the local source of truth for campaigns, saves, and chat history (C-321); Firebase remains auth + optional sync
- ✅ Hub app — SvelteKit SSR community hub on Google Cloud Run (Bun) for community assets, maps, mods, and managing your own characters/personas
- ✅ Local AI microservices — Ollama (text), ComfyUI (image), Kokoro (voice) via Docker/herdr
- ✅ AiProviderGateway — one wrapper with offline / BYOK / service modes (C-320)
- ✅ TypeBox runtime validation across shared schemas, types, and mocks
- ✅ Firebase backend (auth triggers, callable functions, scheduled jobs)
- ✅ Landing page and docs site
- ✅ 22+ project monorepo with moon task orchestration
- ✅ Blackbox testing infrastructure + Playwright E2E
- ✅ CI/CD pipeline (GitHub Actions: pr-checks + release)
- ✅ Developer setup and onboarding scripts
- ✅ i18n (Paraglide)

**Planned / In Progress:**
- Authored 10–20 minute offline vertical slice (the immediate product goal)
- Group chats (multiple NPCs in one conversation)
- Character relationships (dynamic, evolving)
- Knowledge graphs and lorebook integration
- Turso embedded-replica cloud sync (C-357)
- Visual regression testing

## Target Audience

- RPG enthusiasts who love D&D-style character building
- AI/chatbot enthusiasts (SillyTavern, RisuAI users)
- World builders and storytellers
- Game developers exploring AI-driven narratives
