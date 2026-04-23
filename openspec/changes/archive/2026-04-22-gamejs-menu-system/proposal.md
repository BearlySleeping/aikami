## Why

The gamejs project needs a functional menu system to serve as the foundation for the Aikami game. The Godot-Game-Template provides all required features (main menu, options, pause, credits, tutorial) but in GDScript form. We need to migrate these to TypeScript using godot-ts, aligning with aikami's architecture pattern for maintainability and consistency across the monorepo.

## What Changes

- Restructure `src/` to mirror aikami-old: `core/managers/`, `interface/menus/`, `components/`, `utilities/`
- Create core TypeScript managers as autoloads: ConfigManager, AudioManager
- Migrate Main Menu with Start/Options/Credits/Quit buttons
- Create Options menu with 4 tabs: Video, Audio, Input, API (replacing "game" tab from template)
- Implement Pause Menu accessible during gameplay
- Add simple Credits screen
- Add basic Tutorial overlay
- Set up test folder structure paralleling src

## Capabilities

### New Capabilities
- `main-menu`: Main entry screen with navigation to game, options, credits
- `options-menu`: Settings with video/audio/input/API configuration tabs
- `pause-menu`: In-game pause menu with resume/options/quit
- `credits`: Simple scrolling credits screen
- `tutorial`: Basic tutorial overlay for first-time players

### Modified Capabilities
(empty)

## Impact

**Code**: `apps/frontend/gamejs/` - new src structure, TypeScript scripts, test files
**Dependencies**: godot-ts bindings, Biome for linting
**Systems**: Godot 4.6 scene management, audio bus system