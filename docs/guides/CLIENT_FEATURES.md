# Client Feature Roadmap

Based on research of leading AI roleplay platforms (RisuAI, SillyTavern), this document outlines features to implement for the Aikami Client with a DND/JRPG focus.

## Core Chat Features

### Message Types
- [ ] **Basic Text Messages** - Standard chat messages from user and AI
- [ ] **Action/Strike Messages** - Roleplay actions using `/me` or `*action*` syntax
- [ ] **System Messages** - Game master announcements, dice rolls, combat updates
- [ ] **Image Messages** - Display AI-generated character images inline
- [ ] **Voice Messages** - Text-to-speech for character dialogue

### Chat Interface
- [ ] **Character Avatar Display** - Show character image in chat
- [ ] **Chat History** - Persistent chat history with Firestore sync
- [ ] **Message Formatting** - Support for bold, italic, code blocks
- [ ] **Timestamps** - Message timing display
- [ ] **Typing Indicator** - Show when AI is generating response
- [ ] **Message Copy/Edit** - Copy or edit sent messages

## Character System

### Character Cards (DND/JRPG Focus)
- [ ] **Character Profile** - Name, race, class, background
- [ ] **Character Image** - AI-generated or uploaded character art
- [ ] **Personality Traits** - Detailed personality description
- [ ] **Speech Pattern** - How the character speaks
- [ ] **Example Messages** - Sample dialogues showing character voice
- [ ] **Character Greeting** - First message from character
- [ ] **Character Scenario** - Setting/context for roleplay

### NPC Management
- [ ] **NPC Library** - Browse and select from pre-made NPCs
- [ ] **NPC Creator** - Create custom NPCs with AI assistance
- [ ] **NPC Categories** - Organize NPCs by location, faction, type
- [ ] **NPC Import/Export** - Share NPC definitions
- [ ] **Community NPCs** - Import from RisuRealm-style community

## World & Lore System

### World Info (Lorebook)
- [ ] **Lore Entries** - Create world lore entries with descriptions
- [ ] **Keyword Activation** - Auto-trigger lore based on keywords in chat
- [ ] **Recursive Lore** - Lore entries that reference other entries
- [ ] **Lore Categories** - Organize by location, faction, items, NPCs
- [ ] **Lore Search** - Search through all world lore
- [ ] **Context Budget** - Limit lore tokens inserted into prompts

### Campaign Management
- [ ] **Campaigns** - Separate chat sessions for different campaigns
- [ ] **Campaign Settings** - World description, rules, tone
- [ ] **Character Roster** - Multiple characters per campaign
- [ ] **Campaign Sharing** - Share campaigns with other players

## AI Integration

### Multi-Backend Support
- [ ] **OpenAI** - GPT-4, GPT-4 Turbo integration
- [ ] **Anthropic** - Claude integration
- [ ] **Google AI** - Gemini integration (via Genkit)
- [ ] **OpenRouter** - Unified API for multiple providers
- [ ] **Custom Endpoint** - Connect to self-hosted models

### AI Parameters
- [ ] **Temperature** - Control randomness
- [ ] **Top P** - Nucleus sampling
- [ ] **Max Tokens** - Response length limit
- [ ] **Presence Penalty** - Reduce repetition
- [ ] **Frequency Penalty** - Token diversity

### Prompt Engineering
- [ ] **System Prompt** - Global system instructions
- [ ] **Character Prompt** - Per-character instructions
- [ ] **Context Injection** - Inject game state, inventory, location
- [ ] **Prompt Templates** - Save and reuse prompt configurations

## Game Master Features

### Dice Rolling
- [ ] **Basic Dice** - Roll d4, d6, d8, d10, d12, d20, d100
- [ ] **Custom Dice** - Roll arbitrary combinations (2d6+3)
- [ ] **Dice Commands** - `/roll 2d20`, `/r 1d20+5`
- [ ] **Roll History** - View past dice rolls
- [ ] **Roll Modifiers** - Advantage, disadvantage, bonus

### Game State
- [ ] **Player Stats** - HP, MP, ability scores
- [ ] **Inventory** - Items and equipment
- [ ] **Location Tracking** - Current location in world
- [ ] **Active Effects** - Buffs, debuffs, conditions
- [ ] **Quest Log** - Active and completed quests

### GM Tools
- [ ] **GM Mode** - Separate interface for game master
- [ ] **Scene Control** - Set scene description, NPCs present
- [ ] **Random Encounters** - Trigger random events
- [ ] **Treasure Generation** - Random loot tables
- [ ] **NPC Control** - Switch between speaking as different NPCs

## Advanced Features

### Memory & Context
- [ ] **Short-Term Memory** - Remember current conversation
- [ ] **Long-Term Memory** - Summarize and store important events
- [ ] **Embedding Search** - Semantic search of past chats
- [ ] **Memory Pruning** - Automatically clean old context

### Extensions & Plugins
- [ ] **Plugin System** - Extensible architecture
- [ ] **TTS Integration** - Text-to-speech providers
- [ ] **Image Generation** - Connect to Stable Diffusion, DALL-E
- [ ] **WebSearch** - AI can search the web for information
- [ ] **Custom Tools** - Define custom AI tools/actions

### Multiplayer
- [ ] **Shared Chat** - Multiple players in same campaign
- [ ] **Turn-Based** - Queue system for player turns
- [ ] **GM Override** - GM can edit AI responses
- [ ] **Party Chat** - Private player communication

## User Experience

### Interface
- [ ] **Theme Support** - Light/dark themes
- [ ] **Custom CSS** - User-defined styling
- [ ] **Mobile Responsive** - Works on phones/tablets
- [ ] **Client Install** - Install as native app
- [ ] **Keyboard Shortcuts** - Quick actions

### Data Management
- [ ] **Cloud Sync** - Sync data across devices
- [ ] **Local Backup** - Export/import data
- [ ] **Character Cards Export** - Export as JSON/image
- [ ] **Chat Export** - Export conversations

## Priority Implementation Order

### Phase 1: Core Chat (MVP)
1. Basic text chat interface
2. Character cards with profile
3. Single AI backend (Genkit/Gemini)
4. Simple prompt configuration
5. Chat history persistence

### Phase 2: DND Features
6. Dice rolling system
7. Character stats tracking
8. Basic world info/lore
9. System prompts for DND

### Phase 3: Enhancement
10. Multiple AI backends
11. Advanced lorebook
12. Campaign management
13. Voice output (TTS)

### Phase 4: Advanced
14. Memory system
15. GM tools
16. Multiplayer
17. Extensions/plugins

### Phase 5: Polish
18. Themes and customization
19. Mobile optimization
20. Cloud sync
21. Community features
