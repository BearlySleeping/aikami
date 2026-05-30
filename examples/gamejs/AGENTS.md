# GameJS GodotJS - Developer Guidelines

> **CRITICAL**: Before any task, first read the [Root AGENTS.md](../../AGENTS.md) for shared monorepo standards, then read [CODING_STANDARD.md](CODING_STANDARD.md) for GameJS-specific strict rules.

## Project Overview

GameJS is a GodotJS game project using TypeScript for game logic. It uses the Godot Engine with JavaScript/TypeScript bindings via godot-ts.

### Tech Stack

| Component | Technology |
|-----------|-----------|
| Game Engine | Godot 4.6+ |
| Scripting | TypeScript with godot-ts |
| Build Tool | godot-ts CLI |
| Linting/Formatting | Biome (currently disabled for gamejs — see CODING_STANDARD.md) |
| Testing | Bun test |
| Task Runner | moon |

---

## Project Structure

```
apps/frontend/gamejs/
├── src/
│   ├── core/           # Autoload singletons (Env, Firebase*, GameState, Managers)
│   ├── interface/      # UI views (menus, HUD, auth screens)
│   │   ├── auth/       # Authentication views
│   │   └── menus/      # Menu views
│   ├── scenes/         # Game scenes (.tscn + .ts)
│   │   ├── main/       # Main game scenes
│   │   └── test/       # Test/debug scenes
│   ├── entities/       # Game entities (player, enemies, items)
│   ├── systems/        # Game systems (combat, physics, AI)
│   ├── utils/          # Utility functions, helpers, constants
│   └── components/     # Reusable Godot components
├── tests/              # Unit tests (bun test)
├── project.godot       # Godot project configuration
├── tsconfig.json       # TypeScript configuration
├── biome.json          # Biome linting/formatting config (if enabled)
├── CODING_STANDARD.md  # STRICT GameJS coding standard (READ FIRST)
└── moon.yml            # Moon task runner config
```

---

## Commands

### Development

```bash
# Build TypeScript
bun run build

# Watch mode (rebuild on file changes)
# Note: Use manual build in practice — godot-ts watch is unreliable
bun run build

# Open Godot editor
bun run editor

# Run game
bun run dev
```

### Testing & Validation

```bash
# Run unit tests (bun test)
bun run test

# Type check
bun run typecheck

# Full validation
bun run validate
```

---

## Key References

| Document | Purpose |
|----------|---------|
| [Root AGENTS.md](../../AGENTS.md) | Shared monorepo standards (moon, biome, error handling, file path comments) |
| [CODING_STANDARD.md](CODING_STANDARD.md) | **GameJS-specific strict coding standard** — READ BEFORE EVERY TASK |
| `.opencode/skills/godotjs-scripting/SKILL.md` | GodotJS-specific patterns (signals, decorators, lifecycle) |
| `.opencode/skills/godotjs-tdd/SKILL.md` | Test-driven development workflow |

---

## Quick Standards Reminder

- **File path comments** mandatory at top of every file
- **Private members** prefixed with `_`
- **Options objects** for all multi-arg methods
- **Arrow functions** default; regular functions only in classes for `this`/`super`
- **`type` over `interface`** unless extending
- **No `any`**, no `null`, no `!` assertions
- **Escape early**, avoid `else`
- **JSDoc** on classes, public methods, complex private methods
- **Logging** at start of every method (`this.debug()` or `logger.debug()`)
- **Try-catch + rethrow** in view methods
- **`Callable.create()`** for signal connections (never arrow functions)
- **Default export** on every script file

---

## Git Conventions

- **Commits**: Use conventional commits (e.g., `feat: add player movement`, `fix: scene loading crash`)
- **Branch naming**: `feature/description`, `fix/description`, `refactor/description`
- **PRs**: Include description of changes and testing done
