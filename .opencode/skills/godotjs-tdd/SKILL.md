---
name: godotjs-tdd
description: Test-Driven Development workflow for GameJS projects using OpenSpec. Creates test-first implementations with validation gates.
version: 1.0.0
author: Aikami Team
tags: ["godot", "gamedev", "tdd", "testing", "openspec"]
---

# GameJS TDD Workflow

This skill provides a Test-Driven Development (TDD) workflow for GameJS projects using OpenSpec. It enforces test-first development with validation gates.

## Workflow Overview

```
openspec new game <feature-name>
openspec apply <feature-name>
```

Each task will:
1. Write unit tests first (fails)
2. Implement feature
3. Run tests (passes)
4. Run linting + typecheck
5. Build and verify headless

## Directory Structure

```
apps/frontend/gamejs/
├── src/                    # Source code
│   ├── scenes/             # Game scenes
│   ├── core/               # Core game systems
│   └── ...
├── tests/                  # Unit tests (bun test)
│   ├── game-logic.test.ts
│   └── ...
├── dist/                   # Built exports
│   ├── linux/
│   └── web/
└── openspec/              # OpenSpec changes
    └── <change-name>/
        ├── proposal.md
        ├── spec.md
        ├── design.md
        └── tasks.md
```

## Commands

### Development Commands

| Command | Description |
|---------|-------------|
| `bun run dev` | Build TypeScript |
| `bun run dev:run` | Build + run headless |
| `bun run dev:editor` | Open Godot editor |

### Testing & Validation

| Command | Description |
|---------|-------------|
| `bun run test` | Run unit tests |
| `bun run lint` | Check code style |
| `bun run lint:fix` | Auto-fix lint issues |
| `bun run typecheck` | TypeScript check |
| `bun run validate` | Full validation (lint + typecheck + test) |
| `bun run export:linux` | Export for Linux |
| `bun run export:web` | Export for Web |
| `./dist/linux/game --headless` | Run exported game |

### OpenSpec Workflow

| Command | Description |
|---------|-------------|
| `openspec new game <name>` | Create new change |
| `openspec apply <name>` | Apply/implement change |
| `openspec status` | Check status |
| `openspec archive <name>` | Archive completed change |

## TDD Task Structure

Each task in the tasks.md follows this pattern:

```markdown
## Task: <feature-name>

### Subtask: test_<feature>
- **Status**: pending
- **Command**: bun run test:<feature>
- **Validates**: Tests in tests/<feature>.test.ts

### Subtask: implement_<feature>
- **Status**: pending
- **Command**: 
  - bun run dev  # Build
  - bun run test  # Verify tests pass
  - bun run validate  # Full validation
- **Validates**: Feature implemented + tests pass + lint passes
```

## Writing Tests First

### Test File Structure

```typescript
// tests/<feature>.test.ts
import { describe, expect, test } from 'bun:test';

// Unit under test
function calculateDamage(base: number, defense: number): number {
  return Math.max(0, base - defense);
}

describe('<Feature>', () => {
  describe('calculateDamage', () => {
    test('calculates correct damage', () => {
      expect(calculateDamage(100, 50)).toBe(50);
    });

    test('returns 0 when defense exceeds attack', () => {
      expect(calculateDamage(50, 100)).toBe(0);
    });
  });
});
```

### Running Tests

```bash
# Run all tests
bun run test

# Run specific test file
bun test tests/game-logic.test.ts

# Run with coverage (future)
bun test --coverage
```

## Implementation Pattern

```typescript
// src/systems/damage.ts
import { Node } from "godot";

export default class DamageCalculator extends Node {
  override _ready(): void {
    console.log("DamageCalculator ready");
  }

  calculate(base: number, defense: number): number {
    return Math.max(0, base - defense);
  }
}
```

## Scene Integration

```typescript
// src/scenes/combat.ts
import { Node, Label } from "godot";
import DamageCalculator from "../systems/damage";

export default class Combat extends Node {
  private _damageCalc!: DamageCalculator;
  private _healthLabel!: Label;
  private _playerHealth: number = 100;

  override _ready(): void {
    this._damageCalc = this.get_node("DamageCalculator") as DamageCalculator;
    this._healthLabel = this.get_node("HUD/HealthLabel") as Label;
    this.updateHealthDisplay();
  }

  takeDamage(amount: number): void {
    const damage = this._damageCalc.calculate(amount, 0);
    this._playerHealth = Math.max(0, this._playerHealth - damage);
    this.updateHealthDisplay();
  }

  private updateHealthDisplay(): void {
    this._healthLabel.text = `Health: ${this._playerHealth}`;
  }
}
```

## Validation Flow

Before marking any task complete, run:

```bash
# 1. Unit tests must pass
bun run test

# 2. Lint must pass
bun run lint

# 3. Type check must pass
bun run typecheck

# 4. Build must succeed
bun run dev

# 5. (Optional) Export and run headless
bun run export:linux && ./dist/linux/game --headless
```

## Creating a New Feature

```bash
# Step 1: Create OpenSpec change
openspec new game add-combat-system

# Step 2: Edit proposal.md
# Explain: "Add combat system with damage calculation"

# Step 3: Edit spec.md  
# Define: "DamageCalculator class with calculate() method"

# Step 4: Edit design.md
# Show: Class diagram, scene structure

# Step 5: Edit tasks.md
# Include test + implement subtasks

# Step 6: Apply change
openspec apply add-combat-system

# Step 7 (AI follows TDD):
# 1. Write tests in tests/combat.test.ts
# 2. Run tests (fails)
# 3. Implement in src/systems/damage.ts
# 4. Run tests (passes)
# 5. Run bun run validate
# 6. Build with bun run dev
# 7. Mark task complete
```

## Best Practices

### Test Naming

```typescript
// Pattern: <unit>_<behavior>_<expected>
test('damage_calculator_returns_zero_when_defense_exceeds_attack', () => {
  expect(calculateDamage(50, 100)).toBe(0);
});
```

### Test Coverage

- Test edge cases (0, negative, max values)
- Test error conditions
- Test user interactions
- Test state changes

### Import Patterns

```typescript
// Always import from 'godot' for Godot types
import { Node, Sprite2D, Button, Label } from "godot";

// Import game utilities
import { GameState } from "$game/core/game-state";
```

## Common Issues

### Tests Failing After Implementation

1. Check import paths are correct
2. Verify export default is used
3. Ensure scene is loaded before accessing nodes

### Lint Errors

```bash
# Auto-fix most issues
bun run lint:fix

# Check what remains
bun run lint
```

### Type Errors

```bash
# Check type errors
bun run typecheck

# Fix in IDE with TypeScript
```

## GodotJS-Specific Testing

### Unit Tests (bun test)

Pure TypeScript tests that don't require Godot runtime:

```typescript
test('math helpers work', () => {
  expect(lerp(0, 10, 0.5)).toBe(5);
});
```

### Integration Tests

Use the exported game in headless mode:

```bash
bun run export:linux
./dist/linux/game --headless --quit-after 1
```

### Scene Testing

For scene tests, create test scenes:

```
src/scenes/test/
├── test_combat.tscn
└── test_combat.ts
```

## Workflow Summary

```
┌─────────────────────────────────────┐
│  openspec new game <feature>        │
└──────────────┬──────────────────────┘
               ▼
┌─────────────────────────────────────┐
│  Write tests FIRST                   │
│  tests/<feature>.test.ts            │
└──────────────┬──────────────────────┘
               ▼
┌─────────────────────────────────────┐
│  Run tests (RED - fails)            │
│  bun run test                       │
└──────────────┬──────────────────────┘
               ▼
┌─────────────────────────────────────┐
│  Implement feature                  │
│  src/systems/<feature>.ts            │
└──────────────┬──────────────────────┘
               ▼
┌─────────────────────────────────────┐
│  Run tests (GREEN - passes)          │
│  bun run test                       │
└──────────────┬──────────────────────┘
               ▼
┌─────────────────────────────────────┐
│  Run validation                    │
│  bun run validate                   │
│  bun run dev                        │
└──────────────┬──────────────────────┘
               ▼
┌─────────────────────────────────────┐
│  Mark task complete                 │
└─────────────────────────────────────┘
```