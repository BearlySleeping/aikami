## 1. Project Structure Setup

- [x] 1.1 Create src/core/managers/ directory structure
- [x] 1.2 Create src/interface/menus/ directory structure (main/settings, pause, credits, tutorial)
- [x] 1.3 Create tests/ mirroring src structure
- [x] 1.4 Update project.godot autoloads

## 2. Core Managers

- [x] 2.1 Implement ConfigManager (read/write settings to file)
- [x] 2.2 Implement AudioManager (play UI sounds)
- [x] 2.3 Write ConfigManager tests
- [x] 2.4 Write AudioManager tests

## 3. Main Menu

- [x] 3.1 Create main_menu.tscn scene
- [x] 3.2 Implement MainMenu class in main_menu.ts
- [x] 3.3 Write MainMenu tests
- [x] 3.4 Connect Start → (stub scene for now)
- [x] 3.5 Connect Options → Settings
- [x] 3.6 Connect Credits → Credits screen
- [x] 3.7 Connect Quit → get_tree().quit()

## 4. Options/Settings Menu

- [x] 4.1 Create settings.tscn with TabContainer
- [x] 4.2 Implement Settings class
- [x] 4.3 Implement VideoTab (fullscreen, borderless, vsync)
- [x] 4.4 Implement AudioTab (master, music, sfx, voice sliders)
- [x] 4.5 Implement InputTab (static key display for now)
- [x] 4.6 Implement ApiTab (OpenAI key config)
- [x] 4.7 Write Settings tests

## 5. Pause Menu

- [x] 5.1 Create pause_menu.tscn
- [x] 5.2 Implement PauseMenu class
- [x] 5.3 Connect pause input toggle
- [x] 5.4 Connect Resume → unpause
- [x] 5.5 Connect Options → (link to settings)
- [x] 5.6 Connect Quit → return to main
- [x] 5.7 Write PauseMenu tests

## 6. Credits

- [x] 6.1 Create credits.tscn with scrolling text
- [x] 6.2 Implement Credits class
- [x] 6.3 Write Credits tests

## 7. Tutorial

- [x] 7.1 Create tutorial.tscn overlay
- [x] 7.2 Implement Tutorial class
- [x] 7.3 Add basic tutorial steps
- [x] 7.4 Write Tutorial tests