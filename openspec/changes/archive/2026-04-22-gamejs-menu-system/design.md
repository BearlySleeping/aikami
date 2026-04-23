## Context

The gamejs project currently has only a bare `GameState` autoloader and empty main scene. The Godot-Game-Template provides all menu features in GDScript, but we need TypeScript for consistency with the monorepo. The aikami-old project shows the architecture pattern we should follow.

## Goals / Non-Goals

**Goals:**
- Create TypeScript-based menu system matching template functionality
- Establish clean folder structure that scales
- Enable TDD with tests mirroring src structure
- Support video/audio/input/API settings tabs

**Non-Goals:**
- Firebase auth/storage integration (future change)
- Gameplay logic (wind, loose conditions)
- Complex inventory system

## Decisions

### 1. Folder Structure - Match aikami-old pattern

```
src/
├── core/
│   ├── managers/
│   │   ├── config_manager.ts
│   │   └── audio_manager.ts
├── scenes/           # .tscn only entry points
├── interface/
│   ├── menus/
│   │   ├── main/
│   │   │   ├── main_menu.tscn
│   │   │   └── main_menu.ts
│   │   │   └── settings/
│   │   │       ├── settings.tscn
│   │   │       ├── settings.ts
│   │   │       ├── video_tab.ts
│   │   │       ├── audio_tab.ts
│   │   │       ├── input_tab.ts
│   │   │       └── api_tab.ts
│   │   ├── pause/
│   │   │   ├── pause_menu.tscn
│   │   │   └── pause_menu.ts
│   │   └── credits/
│   │       ├── credits.tscn
│   │       └── credits.ts
│   └── tutorial/
│       ├── tutorial.tscn
│       └── tutorial.ts
├── components/      # Reusable widgets
└── utilities/      # Helper functions

tests/              # Mirrors src exactly
```

**Rationale**: aikami-old proven pattern; keeps logic near scenes; easy to discover tests.

### 2. TypeScript-First - Minimal .tscn

.tscn files exist only to:
- Define node tree structure
- Set exported properties
- Reference script via `ext_resource`

All logic lives in .ts files.

**Rationale**: TypeScript provides type safety; .tscn as declarative UI, not logic bearer.

### 3. Settings Tab Structure

Order: Video → Audio → Input → API

- **Video**: Fullscreen, Borderless, Vsync
- **Audio**: Master/Music/SFX/Voice volume sliders
- **Input**: Key binding (template has full rebinding - start simpler)
- **API**: OpenAI key configuration (from aikami-old)

**Rationale**: API tab for future Firebase keys; keep input simple initially.

### 4. Core Managers - Minimal First

Start with:
- `ConfigManager`: Read/write video/audio settings to file
- `AudioManager`: Play UI sounds via AudioServer

Later add:
- `SaveManager`: Player data persistence
- `SceneManager`: Scene loading
- `TimeManager`: Game time

**Rationale**: Main menu needs ConfigManager + AudioManager only; other managers for gameplay.

### 5. Test Structure

```tests/
├── core/
│   └── managers/
├── interface/
│   └── menus/
│       ├── main/
│       │   ├── main_menu.test.ts
│       │   └── settings/
│       │       ├── settings.test.ts
│       │       └── audio_tab.test.ts
│       ├── pause/
│       │   └── pause_menu.test.ts
│       └── credits/
│           └── credits.test.ts
└── components/
```

**Rationale**: Exact path match enables discoverability; use Bun test.

## Risks / Trade-offs

- [Risk] godot-ts API differences from GDScript
  - Mitigation: Check existing game_state.ts pattern; stay simple
- [Risk] Audio bus setup differs between template and aikami-old
  - Mitigation: Use Godot's default buses; add buses as needed
- [Risk] Input rebinding complex in TypeScript
  - Mitigation: Start with static key mapping; add rebinding later

## Open Questions

- Should controls use Godot's InputMap or custom system?
- How to handle save reset - file delete or flag?