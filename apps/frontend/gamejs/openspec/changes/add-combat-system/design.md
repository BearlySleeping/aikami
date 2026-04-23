# Design: Combat System

## Architecture

```
src/
├── core/
│   └── combat/
│       ├── DamageCalculator.ts
│       └── HealthComponent.ts
├── scenes/
│   └── combat/
│       └── combat.tscn
└── tests/
    └── combat.test.ts
```

## Class Design

### DamageCalculator

| Property | Type | Description |
|----------|-----|-------------|
| N/A | - | Utility class, no state |

| Method | Parameters | Returns | Description |
|--------|------------|---------|-------------|
| calculate | base: number, defense: number | number | Calculate damage after defense |

### HealthComponent

| Property | Type | Default | Description |
|---------|-----|---------|-------------|
| _maxHealth | number | 100 | Maximum health |
| _currentHealth | number | 100 | Current health |
| _healthLabel | Label | undefined | UI reference |

| Method | Parameters | Returns | Description |
|--------|------------|---------|-------------|
| setMaxHealth | value: number | void | Set max and reset current |
| takeDamage | amount: number | number | Reduce health, return actual damage |
| heal | amount: number | void | Increase health |
| isAlive | - | boolean | Check if alive |

## Scene Structure

```
Main (Node2D)
├── DamageCalculator
├── Player (CharacterBody2D)
│   └── HealthComponent
├── HUD (Control)
│   └── HealthLabel (Label)
```

## Integration Points

- Player uses HealthComponent for health
- DamageCalculator used by combat system
- HUD updates via HealthComponent signals

---

**Status**: draft
