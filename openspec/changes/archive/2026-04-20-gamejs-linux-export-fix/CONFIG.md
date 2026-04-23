# GameJS Linux Export - Working Configuration

## Summary

The Linux export now works correctly. The key fix was changing the godot-ts output path and copying the source files to the export.

## Key Configuration Changes

### package.json godot-ts config

```json
"godot-ts": {
    "src": "src",
    "out": "./.godot/GodotJS/src",
    "minifyClasses": false
}
```

The key change was changing `"out": "./.godot/GodotJS"` to `"out": "./.godot/GodotJS/src"` so the JavaScript files are output directly to the location Godot expects.

### Scene File Script Paths

All .tscn files now reference script paths like:
```
path="res://.godot/GodotJS/src/interface/menus/main/main_menu.js"
```

### Autoload Paths in project.godot

```godot
[autoload]
GameState="*res://.godot/GodotJS/src/core/game_state.js"
ConfigManager="*res://.godot/GodotJS/src/core/managers/config_manager.js"
AudioManager="*res://.godot/GodotJS/src/core/managers/audio_manager.js"
```

### Export Script

The export script (`scripts/export.ts`) copies both `.godot/` and `src/` directories to the output:

```typescript
fs.cpSync('.godot', `${outDir}/.godot`, { recursive: true });
fs.cpSync('src', `${outDir}/src`, { recursive: true });
```

This ensures the .tscn files and JavaScript are available in the export.

## Dev Workflow

```bash
# Build
bun run dev

# Run locally
godot --headless

# Export Linux
bun run export:linux

# Run exported
cd dist/linux && ./game --headless
```

## What Was Fixed

1. **Script paths** - Changed all .tscn files to use `res://.godot/GodotJS/src/...` paths
2. **godot-ts output** - Changed from `.godot/GodotJS` to `.godot/GodotJS/src` 
3. **Removed problematic imports** - Removed `_.print()` and `console.log()` that used unavailable Godot APIs
4. **Export script** - Added `src/` directory copy to export package