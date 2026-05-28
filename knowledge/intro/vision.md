# Product Vision

Aikami is an AI-powered platform for creating and experiencing immersive 2D RPG adventures, built by **BearlySleeping**.

## Core Vision

An AI-driven living world where every NPC has a personality, memory, and agenda. Users create and manage characters (Personas), interact with AI-driven NPCs through natural dialogue, and participate in dynamic storytelling that evolves based on their choices.

## What Makes It Different

- **AI-Driven NPCs**: Every NPC has a unique personality, system prompt, and first message. AI generates dynamic responses based on the character's traits and the conversation context.
- **D&D-Style Character Sheets**: Full ability scores, skills, saving throws, appearance, hit points — the complete tabletop RPG experience in a chat interface.
- **Rich World Building**: Lorebooks, knowledge graphs, character relationships, and world state that persist and evolve.
- **Cross-Platform**: PWA for web/mobile, Godot game client for immersive 2D experience, Firebase real-time sync between all platforms.

## User Experience

1. **Create a Persona**: Your in-game identity with character sheet, avatar, and backstory
2. **Meet NPCs**: Browse public NPCs or create your own with custom personalities
3. **Chat & Roleplay**: Natural dialogue with AI-driven responses that honor character traits
4. **Build Relationships**: Dynamic relationship tracking (ally, enemy, friend, romantic, rival)
5. **Explore Worlds**: Shared or private worlds with lorebooks, knowledge graphs, and persistent state

## Technical Vision

- **Monorepo architecture**: All code in one place, shared packages, consistent tooling
- **Firebase backend**: Serverless, real-time, globally scalable
- **SvelteKit PWA**: Modern, fast, installable on any device
- **Godot Game Client**: Native 2D RPG experience with TypeScript game logic
- **AI Integration**: Direct AI API calls for dialogue generation and image creation

## Current Status (May 2026)

**Phase: Monorepo Refactoring Complete** — 12 contracts implemented.

**Implemented:**
- ✅ PWA with auth, personas, NPCs, chat, dashboard
- ✅ Firebase backend (auth triggers, callable functions, scheduled jobs)
- ✅ 17+ Firestore collections with full Zod schemas
- ✅ GodotJS game client with Firebase integration
- ✅ Landing page and docs site
- ✅ 22-project monorepo with moon task orchestration
- ✅ Blackbox testing infrastructure
- ✅ Developer setup and onboarding scripts
- ✅ i18n (Paraglide)

**Planned / In Progress:**
- Group chats (multiple NPCs in one conversation)
- Character relationships (dynamic, evolving)
- Knowledge graphs and lorebook integration
- Voice synthesis (ElevenLabs TTS)
- AI image generation for character avatars
- Visual regression testing
- CI/CD pipeline (GitHub Actions)

## Target Audience

- RPG enthusiasts who love D&D-style character building
- AI/chatbot enthusiasts (SillyTavern, RisuAI users)
- World builders and storytellers
- Game developers exploring AI-driven narratives
