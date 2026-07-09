# TODO

---

## 🚧 In Progress / Needs Polish

### 1. Session Zero Conversational Character Creation

- **Current State**: Character pages exist at `routes/characters/` and `routes/(dev)/dev/character/`, but these are static forms — not the conversational DM interview flow.
- **Needed**:
  - `SessionZeroViewModel` — AI Dungeon Master interviews the player
  - AST parsing (via `packages/shared/parser`) to extract structured data (Race, Class, Background, Appearance) from the conversation in real-time
  - Automated webhooks to trigger image generation (avatar) and pixel-art spritesheet generation based on agreed-upon appearance
  - "Advanced Mode" toggle exposing raw `Character` JSON schema for manual stat allocation

### 2. NPC Interaction Intent Macros

- **Current State**: GOAP scheduler, faction system, and NPC dialog components exist. The `context_system.ts` handles proximity but `{{intent:trade}}` / `{{intent:attack}}` macro parsing from LLM output may be incomplete.
- **Needed**:
  - Verify and finalize intent macro extraction from chat output
  - Wire macros to GOAP system (trade → economy, attack → combat)
  - Ensure NPC-to-player `Affection` and `Faction` components drive macro responses

### 3. Quest Graph — Data Connect Schema

- **Current State**: Quest dev page exists (`routes/(dev)/dev/quest/`), but the Firebase Data Connect schema mapping quest nodes, objectives, and rewards may be incomplete.
- **Needed**:
  - Finalize `QuestNode` / `QuestGraph` Data Connect schema
  - Inject relevant quest context into LLM prompts (via `context_system.ts`)
  - Wire quest state into save/load persistence

---

## 🔮 Future Roadmap: The "Omniscient Sandbox"

### 1. Local-First AI Execution (Privacy Pivot)

- [ ] WebGPU LLM Integration — WebLLM / MLC LLM running small quantized models directly in the browser/desktop
- [ ] Ollama / LM Studio adapter — local inference endpoint support in `packages/backend/ai/`
- [ ] Hybrid Fallback Engine — circuit breaker in `AiServiceInterface` to failover between local and cloud
- [ ] Local Voice Models — Piper TTS / Silero running in Tauri backend

> **Cost Warning**: The Director Agent (below) requires local-first execution to avoid runaway cloud API costs.

### 2. Dynamic Ruleset Engine ("Bring Your Own Game")

- [ ] PDF Ingestion & RAG Pipeline — rulebook upload → chunking → pgvector embedding in Data Connect
- [ ] Dynamic UI Generation — AI generates JSON schema for character sheets; Svelte 5 runes render them dynamically
- [ ] Mechanics Enforcement Prompting — inject RAG-retrieved rules into system prompts for dice roll / action adjudication

### 3. The "Director" Agent (Omniscient GM)

- [ ] World State Manager Agent — background LLM monitoring `ChatSummaryData` and updating `WorldStateData`
- [ ] PixiJS Bridge Integration — Director emits `GameCommand` to activate weather particles, lighting, NPC movement
- [ ] NPC Autonomy (GOAP) — background schedules and simulation when player is absent

> **Prerequisite**: Local-first execution (Task 1) is a hard prerequisite for this.

### 4. Total Immersion UI (Voice & Flow)

- [ ] Speech-to-Text (STT) — push-to-talk via Web Speech API or Whisper local
- [ ] Continuous Streaming Mode — STT + TTS loop for hands-free gameplay
- [ ] Session Playback / Export — export completed adventures as PDF or EPUB "Novel"

### 5. Co-Op Multiplayer (Shared Sandbox)

- [ ] Multi-Persona Instancing — invite friend's PersonaId into your WorldId via Data Connect / PowerSync
- [ ] Spatial Chat Routing — route messages by proximity in the 2D engine
- [ ] Party State Tracking — distinguish Human Player vs NPC inputs in GroupChatData

---

## 🍝 Marinara-Engine Feature Inspiration

> All features below reference the Marinara-Engine project at `examples/Marinara-Engine/`. Marinara is a local, AI-powered chat/roleplay/game engine with exceptional UX patterns across Conversation, Roleplay, and Game modes. We adapt its ideas for Aikami's Svelte 5 + DaisyUI + PixiJS stack, focusing on the D&D gaming experience while hiding advanced options behind "Pro" toggles.

---

### 🟢 Tier 1: Critical Foundation (low complexity, highest impact)

> Enabling features — everything else builds on these. Ship these first.

---

#### C-ME-001: Provider & Connection Configuration UI — [📋 Contract C-230](docs/contracts/C-230-provider-connection-config.md)

- **Marinara Reference**: `docs/CONFIGURATION.md`, `docs/GENERATION_PARAMETERS.md`, `docs/FRONTEND.md` (ConnectionEditor, api-client)
- **What Marinara Does**: Rich settings panel for managing multiple AI provider connections (OpenAI, Anthropic, Google Gemini, OpenRouter, local Ollama, etc.), each with API key management (AES-256 encrypted at rest), per-provider model selection, generation parameter sliders (temperature, maxTokens, topP, topK, penalties), connection testing, and per-chat provider overrides.
- **Aikami Adaptation**:
  - [ ] Refactor existing `settings/providers/` ViewModel + views (C-202 already provides OpenRouter model fetching and basic param sliders)
  - [ ] Add **connection management panel**: list saved connections, add/delete/edit with dropdown of known providers
  - [ ] **Per-provider model selector**: dynamic model list fetching per provider (OpenRouter → model list, Ollama → `ollama list`, Anthropic → known models)
  - [ ] **Generation parameter presets**: save/load named parameter profiles (e.g. "Creative", "Precise", "D&D GM")
  - [ ] **Connection test button**: ping endpoint, show latency + token count estimate
  - [ ] **Per-chat overrides**: individual chats can override the default text/image/voice provider
  - [ ] **Quick-start defaults**: auto-create a default "Local Ollama" connection on first boot if none exists
- **Complexity**: Low — mostly DaisyUI form components + existing `AiServiceInterface`
- **Impact**: Critical — blocks all multi-provider features, agent pipelines, per-chat model overrides

#### C-ME-002: Rich Chat System with Streaming — [📋 Contract C-231](docs/contracts/C-231-rich-chat-streaming.md)

- **Marinara Reference**: `docs/CONVERSATION.md`, `docs/FRONTEND.md` (ChatConversationSurface, SSE streaming), `docs/ROLEPLAY.md`
- **What Marinara Does**: Three chat rendering modes — Conversation (Discord-DM style bubbles), Roleplay (immersive dark + sprites), Game (visual novel layout). Features: SSE streaming token-by-token, message branching/swiping (browse alternate AI responses), per-message actions (edit, copy, regenerate, delete, branch, peek prompt), auto-resize input with draft persistence per chat, slash commands, emoji/GIF pickers, per-chat notification sounds, infinite scroll pagination.
- **Aikami Adaptation**:
  - [ ] **Streaming SSE reader**: upgrade `textGenerationService` from request/response to SSE streaming with `ReadableStream` + token-by-token rendering in DialogueOverlay
  - [ ] **Message branching/swiping**: store alternate AI responses per message; swipe left/right to browse; "regenerate" creates new branch
  - [ ] **Message action bar**: edit (inline textarea), copy, retry, delete with confirmation
  - [ ] **Input draft persistence**: auto-save per-chat input drafts to IndexedDB; restore on chat open
  - [ ] **Quick actions & slash commands**: `/roll 2d6`, `/impersonate`, `/ooc` (out of character), `/scene`
  - [ ] **Streaming TTS sync**: as tokens arrive, feed them to Kokoro TTS for real-time voice (C-211 already provides the streaming pipeline)
- **Complexity**: Low-Medium — SSE is straightforward; message branching requires DB schema tweak
- **Impact**: Critical — chat is the primary UX surface; this defines the game feel

#### C-ME-003: Character Sheet & Traits System — [📋 Contract C-232](docs/contracts/C-232-character-sheet-traits.md)

- **Marinara Reference**: `docs/GAME_MODE.md` (party cards, game-specific character sheets), `docs/ROLEPLAY.md` (HUD widgets), `docs/FRONTEND.md` (RPGStatsConfig)
- **What Marinara Does**: Party member cards show stats, levels, abilities, class, strengths, and weaknesses. World-gen creates game-specific character sheets with class, abilities, strengths, and weaknesses for every party member. The Roleplay HUD tracks player stats (HP, mana, custom), inventory, and quests.
- **Aikami Adaptation**:
  - [ ] **D&D-style sheet component**: expand the existing `CharacterDashboard` (C-key overlay) with trait tabs — Abilities (STR/DEX/CON/INT/WIS/CHA), Skills (proficiency checkboxes), Saving Throws, Proficiencies, Equipment
  - [ ] **Traits system**: Personality traits, Ideals, Bonds, Flaws — each with optional +1/-1 modifier hooks
  - [ ] **Likes/Temptations/Keys**: narrative traits that influence AI responses — "Likes: Gold" → NPC bribes work better; "Temptation: Power" → moral choices get harder DCs; "Key: Lost Sister" → GM seeds related plot hooks
  - [ ] **AI context injection**: character sheet serialized into system prompt on every turn — the AI knows your stats, traits, and equipment
  - [ ] **Visual sheet**: DaisyUI card/tabs layout with stat hexagon or radial display inspired by Marinara's party cards
- **Complexity**: Medium — mostly UI + schema design; AI context injection is straightforward
- **Impact**: Critical — defines the RPG identity of the game

---

### 🟡 Tier 2: Core Gameplay (medium complexity, high impact)

> These make it a real RPG — GM, combat feel, world generation, agents.

---

#### C-ME-004: Session Zero / World Generation Wizard

- **Marinara Reference**: `docs/GAME_MODE.md` (full world-gen phase, setup wizard)
- **What Marinara Does**: Five-step wizard — Genre & Setting, Party & GM, You & Model, Goals — generates a structured JSON world document containing: world overview (2-3 paragraphs), story arc + plot twists (secret GM-only), starting map (node graph), NPC roster with roles/reputation, party arcs (personal quest hooks), game-specific character sheets, art style prompt (20-40 words), and HUD blueprint (up to 4 widgets). This is a single large LLM call requiring top-tier models (Claude Opus/Sonnet, GPT-4o class).
- **Aikami Adaptation**:
  - [ ] **Setup wizard ViewModel + views**: multi-step DaisyUI form — Genre (multi-select: Fantasy/Sci-Fi/Horror/Cyberpunk/etc.), Tone (Heroic/Dark/Comedic/Whimsical), Difficulty (Casual/Normal/Hard/Brutal), Setting (free-text with suggestion chips), Player Goals (free-text)
  - [ ] **World-gen LLM call**: structured JSON output via Zod schema validation — world overview, starting location, initial NPCs (name/role/location/reputation), party arcs, art direction hint
  - [ ] **Map seeding**: integrate with C-175 (JTON Map Pipeline) to place NPCs, POIs, and quest items on the starting map based on world-gen output
  - [ ] **GM prompt assembly**: compile world-gen output into the GM system prompt so it persists across sessions
  - [ ] **"Surprise Me!" defaults**: one-click random world generation for quick start
- **Complexity**: High — structured JSON generation is demanding; requires top-tier model; retry logic for malformed output
- **Impact**: Very High — transforms the game from a static map into a living world

#### C-ME-005: Combat Enhancement — Dice UI, Initiative, Turn Tracking — [📋 Contract C-234](docs/contracts/C-234-combat-enhancement-dice-initiative.md)

- **Marinara Reference**: `docs/GAME_MODE.md` (dice rolling, combat encounters), `docs/ROLEPLAY.md` (combat encounters)
- **What Marinara Does**: Dice roller with 8 preset notations (d20, d6, 2d6, d10, d100, d4, d8, d12) + custom notation like `3d8+2`. Rolls are queued, resolved server-side, and appended to message as `[dice: 2d6 = 9 (4,5)]`. GM treats results as canonical. Combat runs as turn-based encounters with initiative, HP tracking, status effects, and an encounter store.
- **Aikami Adaptation**:
  - [ ] **Interactive dice UI**: click-to-roll d20 (C-162 provides BG3-style action menu, expand with visible dice animation). Dice results animate (tumble → settle) in a dedicated dice tray component
  - [ ] **Initiative tracker**: roll initiative on combat start; sort turn order visually; current-turn highlight
  - [ ] **Turn tracking UI**: "Your Turn" / "Enemy Turn" header; action count (action/bonus/reaction per D&D 5e); end-turn button
  - [ ] **Combat log enrichment**: dice roll results highlighted inline; advantage/disadvantage visual indicator; damage type icons
  - [ ] **Quick-dice menu**: preset buttons in the chat input bar for common rolls
- **Complexity**: Medium — dice animation is the bulk; initiative tracking is straightforward state machine
- **Impact**: Very High — combat is a core D&D mechanic; dice are the most visceral feedback

#### C-ME-006: AI Game Master / Narrative Director — [📋 Contract C-235](docs/contracts/C-235-gm-narrative-director.md)

- **Marinara Reference**: `docs/GAME_MODE.md` (GM system, standalone vs character GM), `docs/ROLEPLAY.md` (Narrative Director, Secret Plot)
- **What Marinara Does**: Two GM modes — Standalone (synthetic GM persona) or Character (existing character card as GM). The Narrative Director agent maintains private plot memory: long-term arc memory plus short-term scene directions injected before replies. Secret Plot feature provides hidden arc tracking, scene direction steering, momentum-shift hints. The GM receives full game state per turn: map, party position, NPCs, session summaries, character cards, time, weather, encounter hints, player notes, HUD state.
- **Aikami Adaptation**:
  - [ ] **GM system prompt assembler**: on every AI turn, assemble a rich prompt containing — world overview, story arc + plot twists (GM-only), current map + location, active NPCs + reputation, party character sheets, inventory, quest log, recent chat history summary, current in-world time + weather, encounter state
  - [ ] **Narrative Director agent**: background LLM watching chat context; maintains hidden arc memory (long-term) + scene directions (short-term); injects narrative steering into GM prompt
  - [ ] **GM address mode**: toggle in chat input — "Scene" (in-character action) / "Talk to Party" (party responds) / "Talk to GM" (out-of-character questions, pacing requests)
  - [ ] **Session summarization**: on "End Session", run a low-temperature LLM call to produce structured summary (party dynamics, key discoveries, NPC updates, stat snapshots). Next session starts with recap message.
- **Complexity**: High — prompt assembly is nuanced; session summarization requires reliable structured output; Narrative Director adds a parallel agent
- **Impact**: Very High — the GM is the heart of the D&D experience; this makes the world feel alive and reactive

#### C-ME-007: Agent Pipeline System — [📋 Contract C-236](docs/contracts/C-236-agent-pipeline-system.md)

- **Marinara Reference**: `docs/FRONTEND.md` (Agent System — 21 built-in agents, three phases), `docs/GAME_MODE.md` (automated agents), `docs/ROLEPLAY.md` (agents menu)
- **What Marinara Does**: 21 built-in agents running in three phases — Pre-generation (context injection, knowledge retrieval), Parallel (alongside main generation), Post-processing (rewriting, state extraction, expression selection). Per-chat agent toggles. Agent thought bubbles showing real-time reasoning. Failed-agent retry UI. Agent memory endpoints for per-chat persistent state.
- **Aikami Adaptation**:
  - [ ] **Agent pipeline runner**: define `AgentPhase` (pre/parallel/post), per-agent prompt templates, agent result types. Runner executes agents in order, merges results into main prompt or state patches.
  - [ ] **Built-in agents (Phase 1)**:
    - `world-state-agent`: extracts date, time, location, weather, present characters, inventory changes from narrative
    - `quest-agent`: tracks quest creation, progress updates, completion
    - `expression-agent`: selects character sprite expressions from text (happy/sad/angry/surprised/etc.)
    - `combat-agent`: tracks combat rounds, HP, initiative, outcomes
    - `prose-guardian`: enforces writing quality — anti-repetition, show-don't-tell
  - [ ] **Agent HUD/activity menu**: DaisyUI drawer showing active agents, thought bubbles, retry buttons, token usage
  - [ ] **Per-chat agent toggles**: enable/disable agents per chat in settings
- **Complexity**: High — pipeline orchestration, per-agent error handling, structured output parsing, token budget management
- **Impact**: Very High — agents are the engine's modular intelligence; they make complex state tracking possible without bloating the main LLM prompt

#### C-ME-008: Prompt Template & Macro System — [📋 Contract C-237](docs/contracts/C-237-prompt-template-macro-system.md)

- **Marinara Reference**: `docs/MACROS.md`
- **What Marinara Does**: Rich macro system used everywhere — presets, character fields, lorebook entries, regex scripts. Macros include: identity (`{{user}}`, `{{char}}`, `{{persona}}`), character fields (`{{description}}`, `{{personality}}`, `{{backstory}}`), context (`{{input}}`, `{{model}}`, `{{chatId}}`), time (`{{date}}`, `{{time}}`), random (`{{random}}`, `{{roll:2d6}}`, weighted random `{{random::A@2::B@0.5}}`), variables (`{{getvar}}`, `{{setvar}}`, `{{incvar}}`), formatting (`{{uppercase}}`, `{{#if}}` conditionals, `{{trim}}`).
- **Aikami Adaptation**:
  - [ ] **Macro engine** in `packages/frontend/engine/` or `packages/shared/`: `resolveMacros(template, context)` returning resolved string. Pure function — no side effects.
  - [ ] **Template preset system**: save/load named prompt templates (system prompt, user prefix, assistant prefix, stop sequences). Drag-and-drop section ordering in preset editor.
  - [ ] **Macro UI helper**: macro autocomplete in chat input and prompt editors; macro reference panel
  - [ ] **Prompt peek/preview**: button to show the fully assembled prompt with macros resolved — critical for debugging
- **Complexity**: Low-Medium — regex-based macro engine is straightforward; conditionals add moderate complexity
- **Impact**: High — macros make prompts dynamic and reusable; reduces prompt engineering overhead

---

### 🔵 Tier 3: Immersion & World Building (medium-high complexity, medium-high impact)

> These deepen the experience — lore, expressions, session persistence, chat modes.

---

#### C-ME-009: Lorebook & World Info System — [📋 Contract C-238](docs/contracts/C-238-lorebook-world-info.md)

- **Marinara Reference**: `docs/CONVERSATION.md` (lorebooks in conversation), `docs/ROLEPLAY.md` (lorebooks in roleplay, World Info panel), `docs/GAME_MODE.md` (lorebooks for world-gen)
- **What Marinara Does**: Lorebooks contain entries with keywords, activation rules, and injection settings. Two types: constant entries (always injected) and keyword-triggered entries (injected when keywords appear in recent messages). World Info panel shows active entries. Lorebook editor with folder organization, recursion settings, position control. AI lorebook maker generates entries from source material.
- **Aikami Adaptation**:
  - [ ] **Lorebook data model**: `Lorebook` (id, name, description) → `LorebookEntry[]` (keywords: string[], content: string, constant: boolean, position: 'before' | 'after' | 'system', priority: number)
  - [ ] **Keyword scanner**: on every turn, scan recent messages for entry keywords; collect matched entries; sort by priority; inject into prompt at specified position
  - [ ] **Lorebook editor ViewModel + views**: DaisyUI form for creating/editing entries; keyword chip input; content textarea with macro support; drag-to-reorder
  - [ ] **World Info panel**: DaisyUI drawer showing currently active lorebook entries during chat; inline entry editing
  - [ ] **AI lorebook generator**: "generate a lorebook from these world notes" — LLM call to produce structured entries
- **Complexity**: Medium — keyword scanning is straightforward; editor is standard CRUD
- **Impact**: High — lorebooks are the primary world-building tool; they let GMs author persistent world knowledge without engineering prompts

#### C-ME-010: Expression & Emotion System — [📋 Contract C-239](docs/contracts/C-239-expression-emotion-system.md)

- **Marinara Reference**: `docs/ROLEPLAY.md` (sprite expressions, two-tier system)
- **What Marinara Does**: 16 default expressions (neutral, happy, sad, angry, surprised, scared, embarrassed, love, thinking, laughing, worried, disgusted, smirk, crying, determined, hurt). Two-tier system: Expression agent (LLM reads message → structured output naming expression) + keyword fallback (regex scans message for emotional keywords). Expressions persisted per-message (swiping restores the expression from that swipe).
- **Aikami Adaptation**:
  - [ ] **Expression detection**: lightweight LLM call (or keyword regex fallback for weaker models) that extracts `{ characterId: expressionString }` from AI messages
  - [ ] **LPC expression mapping**: map emotion strings to LPC sprite overlays — e.g. `angry` → eyebrow overlay, `happy` → mouth corner overlay. Requires expanding the LPC asset catalog (C-158)
  - [ ] **Expression keyword fallback**: regex map of `angry|furious|rage` → `angry`, `happy|joy|delight` → `happy`, etc. Runs when LLM detection fails
  - [ ] **Battle expressions**: combat-specific expressions — `hurt` on damage, `determined` on attack, `victorious` on kill
- **Complexity**: Medium-High — needs LPC asset expansion + expression-to-overlay mapping
- **Impact**: Medium-High — expressions bring static LPC sprites to life; key for visual storytelling

#### C-ME-011: Session Management — Summarization, Recap, Persistence — [📋 Contract C-240](docs/contracts/C-240-session-management.md)

- **Marinara Reference**: `docs/GAME_MODE.md` (sessions lifecycle — end session, start new session)
- **What Marinara Does**: Explicit session lifecycle. End Session: runs a low-temperature LLM call → structured JSON with summary (narrative recap + resumePoint, party dynamics, key discoveries, NPC updates, stat snapshot), campaign progression (storyArc + plotTwist updates), and character card updates (class evolution, new abilities, stat bumps). Start Session: creates a numbered fork, runs a recap call anchored on the previous session's resumePoint.
- **Aikami Adaptation**:
  - [ ] **Session state schema**: `GameSession { id, gameId, sessionNumber, startedAt, endedAt, summary, resumePoint, campaignProgression, characterSnapshots }`
  - [ ] **End Session flow**: button triggers summarization LLM call; lock chat; show summary preview; save to Data Connect
  - [ ] **New Session flow**: load previous session summary; generate recap message; carry forward game state (map, NPCs, party, quests, time, weather)
  - [ ] **Session browser**: list past sessions with summary preview, timestamp, duration; click to view (read-only) or continue from
  - [ ] **Auto-summarization threshold**: when chat exceeds N messages, prompt user to end session (prevent context window overflow)
- **Complexity**: Medium — structured summarization call is the main complexity; CRUD is standard
- **Impact**: High — enables long-running campaigns without context window bloat

#### C-ME-012: Chat Modes & Address System — [📋 Contract C-241](docs/contracts/C-241-chat-modes-address-system.md)

- **Marinara Reference**: `docs/GAME_MODE.md` (address modes — Scene/Party/GM, input bar toggle), `docs/CONVERSATION.md` (group chat, character exchanges, manual replies), `docs/ROLEPLAY.md` (impersonation)
- **What Marinara Does**: Three address modes color-coded in input bar — Scene (normal in-game action), Talk to Party (party members respond), Talk to GM (out-of-character). Group chats with character picker and "Only Reply When Mentioned" toggle. Character exchanges (characters talk to each other). Impersonation (`/impersonate [direction]`) drafts a message as your persona.
- **Aikami Adaptation**:
  - [ ] **Address mode toggle**: DaisyUI button group in chat input — "Scene" (default), "Party" (sky color), "GM" (amber color). Toggle prefixes message with `[To the party]` or `[To the GM]`.
  - [ ] **Party chat routing**: when addressing Party, route response through Party Players agent (C-ME-006) — each party member responds in character
  - [ ] **GM chat routing**: when addressing GM, GM responds out-of-character; useful for rules questions, pacing requests, world clarification
  - [ ] **Impersonation mode**: `/impersonate [direction]` — LLM drafts a message as the player's persona; user can keep, edit, or discard
- **Complexity**: Low — mostly prompt routing + UI toggle
- **Impact**: Medium — separates in-character RP from out-of-character mechanics talk

---

### 🟣 Tier 4: Polish & Rich Features (high complexity, medium impact)

> These make it beautiful — images, assets, cross-mode bridges.

---

#### C-ME-013: Image Generation Pipeline

- **Marinara Reference**: `docs/IMAGE_GENERATION.md`, `docs/GAME_MODE.md` (image generation toggle, scene analysis sidecar), `docs/ROLEPLAY.md` (sprites, backgrounds, illustrations)
- **What Marinara Does**: Centralized style profiles (Anime, Realistic, Cinematic, etc.) with prompt grammar, positive/negative tags, per-image type tags. Prompt cleanup/compilation. Provider support: Stability AI, ComfyUI, AUTOMATIC1111, NovelAI, Draw Things, custom OpenAI-compatible. Review-before-generate toggle. Image generation used for: NPC portraits, location backgrounds, character selfies, scene illustrations, sprite generation.
- **Aikami Adaptation**:
  - [ ] **Style profile system**: named profiles with prompt grammar (natural language, Danbooru tags), positive tags, negative tags, per-image-type overrides
  - [ ] **Image gen providers**: existing ComfyUI integration (C-016) + Add SD Web UI / AUTOMATIC1111, OpenAI DALL-E, Stability AI
  - [ ] **Contextual generation**: combat scene → battle background; new location → location art; character intro → NPC portrait; dramatic moment → illustration
  - [ ] **Review & retry**: preview prompt before sending; regenerate with edited prompt
  - [ ] **Gallery panel**: per-chat image gallery; hover expand; masonry layout
- **Complexity**: High — multiple provider integrations, prompt compilation, background/portrait generation triggers
- **Impact**: Medium-High — visuals dramatically enhance immersion; currently a major gap

#### C-ME-014: Asset Management System

- **Marinara Reference**: `docs/GAME_MODE.md` (game-assets folder, manifest.json, categories)
- **What Marinara Does**: Structured asset folder at `data/game-assets/` — `music/` (genre/intensity nested), `sfx/`, `ambient/`, `sprites/`, `backgrounds/`. Auto-generated `manifest.json` mapping tags (e.g. `backgrounds:fantasy:dark-forest`) to files. GM model receives condensed tag list. User upload support with `:user:` namespace. Built-in assets take precedence on collision.
- **Aikami Adaptation**:
  - [ ] **Asset registry**: `AssetManifest { backgrounds: Record<string, string[]>, sprites: Record<string, string[]>, music: Record<string, string[]>, sfx: Record<string, string[]>, ambient: Record<string, string[]> }` — auto-scanned on startup
  - [ ] **Tag-based selection**: agents request assets by tag (e.g. "backgrounds:fantasy:forest:dark") → manifest resolves to file path or URL
  - [ ] **Dynamic loading**: PixiJS `Assets.load()` for sprites/backgrounds on demand; AudioService for music/sfx
  - [ ] **Upload UI**: DaisyUI drag-and-drop zone in settings; auto-categorize by file type; tag editor
  - [ ] **Background crossfade**: smooth transition between scene backgrounds using PixiJS alpha tween
- **Complexity**: Medium — manifest generation + tag-based lookup is straightforward; upload is standard
- **Impact**: Medium — enables dynamic visuals without hardcoded asset paths

#### C-ME-015: Connected Chats & Cross-Mode Bridge

- **Marinara Reference**: `docs/CONVERSATION.md` (connected chats, asymmetric bridge), `docs/ROLEPLAY.md` (connected chats in roleplay, `<influence>` / `<note>` tags)
- **What Marinara Does**: Conversations can be connected to Roleplay or Game chats. Asymmetric bridge: roleplays auto-pull conversation context, but conversations don't auto-pull roleplay context. `<influence>` tags are one-shot steers; `<note>` tags are durable context pulled every turn. Characters can break the fourth wall via `<ooc>...</ooc>` tags that get posted to the linked DM.
- **Aikami Adaptation**:
  - [ ] **Chat link system**: link an "OOC chat" (Conversation mode) to the main "Game chat". Game chat pulls OOC notes/influence as context.
  - [ ] **Tag-based bridge**: `<note>Remember the wizard's warning</note>` → injected every turn; `<influence>Make the next NPC suspicious</influence>` → injected once
  - [ ] **OOC tag routing**: `<ooc>What does my character know about this?</ooc>` in game chat → posted to linked OOC chat
  - [ ] **Chat mode switching UI**: tab bar or sidebar toggle between Game, Party Chat, OOC DM
- **Complexity**: Medium — tag parsing + cross-chat context injection
- **Impact**: Medium — enables the "DM text channel" pattern that D&D players expect

#### C-ME-016: CYOA Choices & Branching Narrative

- **Marinara Reference**: `docs/FRONTEND.md` (CYOA agent, choice blocks), `docs/ROLEPLAY.md`
- **What Marinara Does**: The CYOA (Choose Your Own Adventure) agent runs post-generation and produces structured choice prompts. Choices are rendered as interactive buttons in the chat. Selection feeds back as user input. Choice blocks can be defined in presets with branching logic.
- **Aikami Adaptation**:
  - [ ] **CYOA agent**: post-generation LLM call — "given this narrative, propose 2-4 player choices"
  - [ ] **Choice UI**: DaisyUI button stack rendered inline after AI message; selected choice becomes user message
  - [ ] **Skill-check choices**: choices can include DC hints — `[Persuasion DC 15] Try to convince the guard`
  - [ ] **Choice history**: track which choices were made for narrative callback
- **Complexity**: Low — simple post-processing agent + UI
- **Impact**: Medium — gives non-typing users a guided interaction path; great for mobile

---

### ⚫ Tier 5: Advanced & Specialist (highest complexity, niche impact)

> For when the core is solid. Ship these last.

---

#### C-ME-017: Export & Import System

- **Marinara Reference**: `docs/README.md` (Export & Data section), `docs/FRONTEND.md` (export endpoints, import endpoints)
- **What Marinara Does**: Export individual chats as JSONL or plain text. Bulk transcript zip download. Import from SillyTavern (character cards, chats, lorebooks). Character card import from PNG/JSON. Bulk import from folder. Full backup export.
- **Aikami Adaptation**:
  - [ ] **Chat export**: JSONL format preserving messages, dice rolls, branches, timestamps; plain text prose format
  - [ ] **Character export/import**: Persona and NPC cards as `.aikami.json` + PNG embedded metadata
  - [ ] **Session novel export**: compile a completed session into an EPUB "novel" with narration + dialogue
  - [ ] **Bulk backup**: zip of all chats, characters, lorebooks, world state
- **Complexity**: Medium — JSONL/EPUB generation; file format design
- **Impact**: Medium — enables sharing, backup, and "read your adventure as a book"

#### C-ME-018: Custom Agent Creation

- **Marinara Reference**: `docs/FRONTEND.md` (Agent Editor, custom tools), `docs/EXTENSIONS.md`
- **What Marinara Does**: Users can create custom agents with prompt templates, phase selection (pre/parallel/post), connection assignment, and tool definitions. Custom tools support webhook requests and in-process VM script execution. Built-in agent toggles coexist with custom agents.
- **Aikami Adaptation**:
  - [ ] **Agent editor ViewModel + views**: DaisyUI form — name, description, phase (pre/parallel/post), prompt template (with macro support), output schema (Zod), connection override
  - [ ] **Agent registry**: built-in agents + user-created agents; per-chat enable/disable
  - [ ] **Agent marketplace** (stretch): import/export agent definitions as `.aikami.agent.json`
- **Complexity**: Medium-High — arbitrary agent execution with user-defined prompts + schema validation
- **Impact**: Low-Medium — power-user feature; most users will use built-in agents

#### C-ME-019: Autonomous NPC Behavior & Schedules

- **Marinara Reference**: `docs/CONVERSATION.md` (autonomous messages, character schedules)
- **What Marinara Does**: Characters can send messages unprompted when the user is idle. Schedules define 7-day × 24-hour availability grids (online/idle/dnd/offline) with per-hour activity descriptions. Schedule Planner agent auto-generates weekly patterns from character cards. Autonomous messages respect schedules and user DND status.
- **Aikami Adaptation**:
  - [ ] **NPC schedule system**: per-NPC weekly schedule (day-of-week + hour → activity). Schedule Planner agent generates from NPC personality.
  - [ ] **Autonomous message trigger**: when player is idle in-game (no input for N minutes), check NPC schedules; eligible NPCs send contextual messages ("Where are you headed?" "I found something interesting...")
  - [ ] **Idle detection**: track time since last player input; DND mode toggle to suppress autonomous messages
- **Complexity**: High — scheduling, idle detection, contextual message generation, rate limiting
- **Impact**: Low-Medium — makes the world feel alive but is a polish feature

#### C-ME-020: Music DJ & Audio Player

- **Marinara Reference**: `docs/FRONTEND.md` (spotify agent, youtube agent), `docs/GAME_MODE.md` (game-assets music folder)
- **What Marinara Does**: Music DJ agent controls Spotify (via PKCE auth) or YouTube playback. Picks tracks based on scene context (combat → intense battle music, exploration → calm ambient). Local music files organized by genre/intensity. The agent outputs play/pause/skip/volume commands.
- **Aikami Adaptation**:
  - [ ] **Scene-aware BGM**: AudioService already handles crossfade (C-150); add scene context → track selection mapping
  - [ ] **Spotify integration**: PKCE OAuth flow in Tauri; playlist selection; play/pause/skip control via Web API
  - [ ] **YouTube integration**: embed player in a hidden iframe; control via postMessage API
  - [ ] **Local music browser**: browse game-assets/music/ folder; preview tracks; assign to scene types
  - [ ] **DJ Agent**: agent that reads scene context and emits music cues — `play:combat:intense`, `crossfade:exploration:calm`
- **Complexity**: Very High — OAuth flow, external API integration, audio pipeline coordination
- **Impact**: Low — nice-to-have polish; last tier by explicit request
- **Note**: This is explicitly the last feature to implement per product vision. Scene-aware music is impactful but the implementation complexity (OAuth, external APIs) makes it a late-stage polish item.

---

## 🐛 Known Issues

### Bun Segfault & Test Fixes (2026-07-03) — ✅ RESOLVED

- **Root causes**:
  1. `AudioService` test mock was missing `createDynamicsCompressor()` — the real `AudioService` constructor calls it, causing `TypeError` on all 16 audio tests
  2. `DevViewModel` test asserted 15 navItems but `NAV_ITEMS` grew to 16 (added `/dev/sandbox/party-follow`); test also duplicated `/dev/sandbox/map` check
  3. SIGSEGV at 0x42 was **not reproducible** — full suite ran clean at 483 pass / 0 fail across 28 files. Likely a prior Bun bug or transient VM state.
- **Fixes applied**:
  - `audio_service.test.ts`: Added `createDynamicsCompressor` stub to `createMockAudioContext()`
  - `dev_layout_view_model.test.ts`: Updated `toBe(15)` → `toBe(16)`, added `/dev/sandbox/party-follow` assertion, removed duplicate `/dev/sandbox/map`
  - `$state` polyfills and `$app/navigation` mocks were already correctly in place via `test_preload.ts` — no changes needed
- **Last verified**: 2026-07-03
