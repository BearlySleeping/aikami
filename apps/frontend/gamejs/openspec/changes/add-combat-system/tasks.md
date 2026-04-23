# Tasks: Combat System

## Task: damage-calculation

### Subtask: test_damage_calculation
- **Status**: pending
- **Description**: Write unit tests for damage calculation
- **Files**: tests/combat/damage.test.ts
- **Command**: bun test tests/combat/
- **Validates**: Tests fail (no implementation yet)

### Subtask: implement_damage_calculation
- **Status**: pending
- **Description**: Implement damage calculation logic
- **Files**: src/core/combat/DamageCalculator.ts
- **Command**:
  ```bash
  bun run test  # Tests pass
  bun run lint  # Lint passes
  bun run typecheck  # Types pass
  ```
- **Validates**: Tests pass, lint passes, typecheck passes

---

## Task: health-component

### Subtask: test_health_component
- **Status**: pending
- **Description**: Write unit tests for health component
- **Files**: tests/combat/health.test.ts
- **Command**: bun test tests/combat/
- **Validates**: Tests fail (no implementation yet)

### Subtask: implement_health_component
- **Status**: pending
- **Description**: Implement health component
- **Files**: src/core/combat/HealthComponent.ts
- **Command**:
  ```bash
  bun run test
  bun run lint
  bun run typecheck
  ```
- **Validates**: Tests pass, lint passes, typecheck passes

---

## Task: combat-scene

### Subtask: test_combat_scene
- **Status**: pending
- **Description**: Create combat test scene
- **Files**: src/scenes/test/combat.tscn
- **Command**: bun run dev
- **Validates**: Scene loads without errors

### Subtask: implement_combat_scene
- **Status**: pending
- **Description**: Implement full combat scene integration
- **Files**: src/scenes/combat.tscn, src/scenes/combat.ts
- **Command**:
  ```bash
  bun run dev
  bun run test
  bun run export:linux
  ./dist/linux/game --headless --quit-after 1
  ```
- **Validates**: Scene works in headless mode

---

## Validation Gate

Before marking any subtask complete, run:

```bash
# Run tests
bun test

# Run validation (skip external lint for now)
bun run typecheck
```

All must pass (exit code 0).

---

## Completed Subtasks

### Task: damage-calculation

- [x] test_damage_calculation - Tests written and passing
- [x] implement_damage_calculation - Implementation complete

---

**Dependencies**:
- damage-calculation → test_damage_calculation → implement_damage_calculation
- health-component → test_health_component → implement_health_component
- combat-scene → implement_damage_calculation + implement_health_component

**Total Subtasks**: 6
**Estimated Time**: 2-4 hours
