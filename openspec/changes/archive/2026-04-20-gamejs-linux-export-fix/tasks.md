## 1. Fix Scene Script Paths

- [x] 1.1 Analyze current .tscn files to identify incorrect script paths
- [x] 1.2 Fix main_menu.tscn script path (res://.godot/GodotJS/src/interface/...)
- [x] 1.3 Fix settings/settings.tscn script paths (video_tab, audio_tab, input_tab, api_tab)
- [x] 1.4 Fix pause_menu.tscn script path
- [x] 1.5 Fix credits.tscn script path
- [x] 1.6 Fix any other .tscn files with script references
- [x] 1.7 Rebuild TypeScript with bun run dev

## 2. Fix Autoload Paths

- [x] 2.1 Enable GameState autoload with correct path
- [x] 2.2 Enable ConfigManager autoload with correct path
- [x] 2.3 Enable AudioManager autoload with correct path
- [x] 2.4 Verify autoloads load without errors

## 3. Test Scene Loading

- [x] 3.1 Run dev build and verify main menu loads
- [x] 3.2 Test options button opens settings menu
- [x] 3.3 Verify settings tabs load correctly
- [x] 3.4 Test pause menu functionality

## 4. Fix Linux Export

- [x] 4.1 Review current export script or create new one
- [x] 4.2 Configure export_presets.cfg for Linux
- [x] 4.3 Test bun run export:linux or equivalent
- [x] 4.4 Verify exported executable runs
- [x] 4.5 Verify buttons work in exported game

## 5. Final Verification

- [x] 5.1 Run full test suite if available
- [x] 5.2 Verify all scripts load without errors
- [x] 5.3 Verify all autoloads function correctly
- [x] 5.4 Document final working configuration