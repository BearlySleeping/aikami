## ADDED Requirements

### Requirement: Linux Export Builds Successfully
The build process SHALL compile TypeScript to JavaScript without errors and produce a working Linux export.

#### Scenario: TypeScript compilation completes
- **WHEN** `bun run dev` or `bun run build` is executed
- **THEN** all TypeScript files compile without errors
- **AND** JavaScript files are output to `.godot/GodotJS/src/` directory

#### Scenario: Linux export runs without script errors
- **WHEN** Linux export is launched
- **THEN** no errors about missing scripts appear in console
- **AND** main menu scene loads correctly

### Requirement: Autoloads Load at Startup
Game system singletons SHALL be available when scenes load.

#### Scenario: GameState autoload is available
- **WHEN** game starts
- **THEN** GameState is accessible via `GameState.instance`
- **AND** no "autoload not found" errors appear

#### Scenario: ConfigManager autoload is available
- **WHEN** game starts
- **THEN** ConfigManager is accessible via `ConfigManager.instance`
- **AND** can load/save game configuration

#### Scenario: AudioManager autoload is available
- **WHEN** game starts
- **THEN** AudioManager is accessible via `AudioManager.instance`
- **AND** can play sound effects

### Requirement: Scene Script Paths are Correct
All .tscn files SHALL reference the correct compiled JavaScript paths.

#### Scenario: Main menu scene loads
- **WHEN** main_menu.tscn is loaded
- **THEN** main_menu.js script initializes correctly
- **AND** all buttons are functional

#### Scenario: Settings menu loads
- **WHEN** settings.tscn is loaded from main menu
- **THEN** settings.js script initializes
- **AND** all tab scripts (video, audio, input, api) load correctly

#### Scenario: Pause menu loads
- **WHEN** pause_menu.tscn is loaded during gameplay
- **THEN** pause_menu.js script initializes correctly

### Requirement: Linux Export CLI Works
The export command SHALL produce a working Linux executable.

#### Scenario: Export command completes
- **WHEN** `bun run export:linux` or equivalent is executed
- **THEN** a Linux executable is produced in the export directory
- **AND** the executable can be launched

#### Scenario: Exported game runs independently
- **WHEN** exported Linux executable is run outside development environment
- **THEN** game launches with main menu
- **AND** all buttons function correctly