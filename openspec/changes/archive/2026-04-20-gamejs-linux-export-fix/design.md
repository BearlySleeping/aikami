## Context

The GameJS project uses godot-ts to compile TypeScript to JavaScript that Godot can run. The build process outputs JavaScript files to `.godot/GodotJS/src/` but Godot scene files and project.godot reference incorrect paths like `.godot/GodotJS/interface/menus/main/settings/settings.js` (missing the `src/` component).

The autoloads (GameState, ConfigManager, AudioManager) are defined in project.godot but commented out because they fail at runtime.

## Goals / Non-Goals

**Goals:**
- Fix all script path references in .tscn files to match godot-ts output
- Fix autoload paths in project.godot so autoloads work
- Create working CLI export script
- Verify Linux export runs without errors

**Non-Goals:**
- Change godot-ts build configuration (work with existing output structure)
- Add new features - only fix build/export issues

## Decisions

### D1: Script Path Strategy

After analyzing godot-ts output structure:
- godot-ts with `src: "src"` config outputs to `.godot/GodotJS/src/`
- Scene files should reference `res://.godot/GodotJS/src/interface/...` NOT `res://.godot/GodotJS/interface/...`

**Decision**: Update all .tscn files to use correct `src/` path prefix.

### D2: Export Method

Options considered:
1. Godot Editor export via MCP - Reliable but requires GUI
2. `godot-ts export` CLI - Native godot-ts solution
3. Manual `godot --export-release` - Requires proper presets

**Decision**: Use godot-ts build first, then Godot Editor export via CLI command (MCP or direct) or `--export-release` with proper export_presets.cfg.

### D3: Autoload Strategy

Autoloads are singletons that must be loaded before scenes. The paths must exactly match compiled JS locations.

**Decision**: Enable autoloads with correct `.godot/GodotJS/src/` paths after fixing tscn paths.

## Risks / Trade-offs

[R1 godot-ts path changes] → Test each scene individually; may need to rebuild after each fix

[R2 Export presets not working] → Fall back to Editor export MCP tool

[R3 Circular dependency with autoloads] → Ensure GameState has no external dependencies; other autoloads can depend on GameState