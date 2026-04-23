## Why

The GameJS Linux export currently fails to load properly at runtime due to incorrect script paths in `.tscn` files and autoload configurations. The game shows errors about missing scripts and autoloads, preventing proper functionality.

## What Changes

- Fix autoload paths in `project.godot` to point to correct compiled JavaScript locations
- Update all `.tscn` files to use correct script paths that match godot-ts output
- Fix or create CLI export script that properly builds and exports Linux version
- Verify all game systems (GameState, ConfigManager, AudioManager) load and function correctly

## Capabilities

### New Capabilities
- `gamejs-linux-export`: A reliable Linux export process that produces a working executable

### Modified Capabilities
- None (this is fixing existing functionality)

## Impact

- `apps/frontend/gamejs/project.godot` - Autoload configuration
- `apps/frontend/gamejs/src/**/*.tscn` - Scene files with script references
- `apps/frontend/gamejs/scripts/export.ts` - Export CLI script
- Run configuration for building TypeScript and exporting