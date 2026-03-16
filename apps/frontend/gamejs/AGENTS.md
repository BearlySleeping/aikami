# Game2 GodotJS - Developer Guidelines

This document provides guidelines for AI coding agents working on the Game2 GodotJS project.

## Project Overview

Game2 is a GodotJS game project using TypeScript for game logic. It uses the Godot Engine with JavaScript/TypeScript bindings via godot-ts.

### Tech Stack

- **Game Engine**: Godot 4.3+
- **Scripting**: TypeScript with godot-ts
- **Build Tool**: godot-ts CLI
- **Linting/Formatting**: Biome
- **Testing**: Bun test + Godot unit tests

---

## Project Structure

```
apps/frontend/game2/
├── src/
│   ├── core/           # Core game systems (game state, managers)
│   ├── scenes/         # Game scenes (.tscn + .gd scripts)
│   ├── scripts/        # Utility scripts
│   └── components/     # Reusable game components
├── tests/              # Unit tests (bun test)
├── project.godot       # Godot project configuration
├── tsconfig.json       # TypeScript configuration
├── biome.json          # Biome linting/formatting config
└── moon.yml           # Moon task runner config
```

---

## Coding Standards

### TypeScript

- Use **strict TypeScript** mode
- Always use explicit return types for exported functions
- Use `unknown` over `any`; if `any` is needed, add a comment explaining why
- **NEVER** use `as unknown as SomeType` - fix the root cause instead

### Naming Conventions

- **Files**: kebab-case (e.g., `player-controller.ts`, `game-state.gd`)
- **Classes**: PascalCase (e.g., `PlayerController`, `GameState`)
- **Functions/variables**: camelCase (e.g., `movePlayer`, `currentScore`)
- **Constants**: SCREAMING_SNAKE_CASE for true constants (e.g., `MAX_SPEED`)
- **Godot Nodes**: PascalCase matching the scene node names

### GodotJS Specific

- Use the `_` import from 'godot' for global functions: `_.print()`, `_.randf()`
- Extend Godot classes using `extends` pattern:
  ```typescript
  import { Node, Sprite2D } from 'godot';
  
  export class Player extends Sprite2D {
    override _ready(): void {
      super._ready();
      _.print('Player ready');
    }
  }
  ```
- Use decorators for exported classes: `@export`, `@onready`
- Godot signals should be connected in `_ready()` using `this.signal.connect()`

### Imports

- Use explicit file extensions in relative imports: `./player.gd`
- Group imports: external → Godot → internal → relative
- Use path aliases defined in tsconfig.json:
  - `$game/*` maps to `src/*`

---

## Biome Configuration

The project uses Biome with these settings:

- **Indent**: 4 spaces (Godot convention)
- **Line width**: 120 characters
- **Quotes**: Single quotes for TS, double quotes for JSX
- **Trailing commas**: ES5 style
- **Semicolons**: Always
- **Arrow parentheses**: Always

### Running Biome

```bash
# Check (lint + format)
bun run check

# Auto-fix
bun run lint:write
bun run format:write
```

---

## Commands

### Development

```bash
# Open Godot editor
bun moon run game2:open-editor

# Build TypeScript
bun moon run game2:build

# Watch mode (rebuild on file changes)
bun moon run game2:watch
```

### Testing

```bash
# Run unit tests (bun test)
bun moon run game2:test

# Run Godot unit tests (requires compiled Godot with tests=yes)
godot --test --test-case="[jsb]*"
```

### Validation

```bash
# Lint
bun moon run game2:lint

# Format
bun moon run game2:format

# Typecheck
bun moon run game2:typecheck

# Full validation (lint + typecheck)
bun moon run game2:validate
```

---

## GodotJS Unit Testing

GodotJS uses GDScript-based testing. To run tests:

1. Build Godot with `tests=yes`:
   ```
   scons tests=yes vsproj=yes dev_build=yes p=windows
   ```

2. Run tests:
   ```
   godot --test --test-case="[jsb]*"
   ```

### Test Structure

Tests are written in TypeScript and use Bun for the test runner. Tests validate game logic independently of Godot's runtime.

```typescript
import { describe, expect, test } from 'bun:test';

describe('Game Logic', () => {
  test('should calculate damage correctly', () => {
    const baseDamage = 25;
    const defense = 10;
    const actualDamage = Math.max(0, baseDamage - defense);
    expect(actualDamage).toBe(15);
  });
});
```

---

## Godot MCP Integration

This project can use the Godot MCP server for AI-assisted development:

### Setup

1. Install godot-mcp:
   ```bash
   git clone https://github.com/Coding-Solo/godot-mcp.git
   cd godot-mcp
   npm install
   npm run build
   ```

2. Configure in Cursor/Cline MCP settings:
   ```json
   {
     "mcpServers": {
       "godot": {
         "command": "node",
         "args": ["/path/to/godot-mcp/build/index.js"]
       }
     }
   }
   ```

### Available MCP Tools

- `launch_editor` - Open Godot editor for this project
- `run_project` - Run the project in debug mode
- `get_debug_output` - Capture console output
- `stop_project` - Stop running project
- `get_godot_version` - Get Godot version
- `list_projects` - List Godot projects
- `create_scene` - Create new scenes
- `add_node` - Add nodes to scenes

---

## Compiler Options

These environment variables can be set for GodotJS:

| Variable | Description | Default |
|----------|-------------|---------|
| JSB_MIN_LOG_LEVEL | Minimum log level | Verbose |
| JSB_DEBUG | Debug mode | 1 |
| JSB_LOG_WITH_SOURCE | Log with source info | 0 |
| JSB_WITH_VARIANT_POOL | Use variant pool | 1 |
| JSB_WITH_DEBUGGER | Enable Chrome devtools | 1 |
| JSB_WITH_SOURCEMAP | Enable sourcemap support | 1 |
| JSB_WITH_STACKTRACE_ALWAYS | Always print stacktrace | 0 |

---

## Error Handling

Use Godot's built-in error handling:

```typescript
import { _ } from 'godot';

try {
  // Code that might fail
  const result = someFunction();
} catch (error) {
  _.printerr(`Error: ${error}`);
}
```

For typed errors, use the AppError system from `@aikami/utils` when interacting with backend services.

---

## Scene Management

### Creating Scenes

1. Create the TypeScript script in `src/scenes/`
2. Create the .tscn file:
   ```
   [gd_scene load_steps=2 format=3]
   
   [ext_resource type="Script" path="res://src/scenes/player.gd" id="1_player"]
   
   [node name="Player" type="CharacterBody2D"]
   script = ExtResource("1_player")
   ```

### Node Naming

- Use PascalCase for node names matching class names
- Add `.uid` files for Godot 4.4+ UID support

---

## Best Practices

1. **Always extend proper Godot classes** - Don't use raw Node2D/Node without inheritance when possible
2. **Use type annotations** - GodotJS supports TypeScript; use it
3. **Export variables** - Use `@export` for editor-editable properties
4. **Connect signals properly** - Use `this.signal.connect()` in `_ready()`
5. **Clean up in _exit_tree()** - Disconnect signals and free resources
6. **Use groups** - Add nodes to groups for easy finding: `this.add_to_group('enemies')`
7. **Preload resources** - Use `@preload` decorator for resources loaded at runtime

---

## Git Conventions

- **Commits**: Use conventional commits (e.g., `feat: add player movement`, `fix: scene loading crash`)
- **Branch naming**: `feature/description`, `fix/description`, `refactor/description`
- **PRs**: Include description of changes and testing done
