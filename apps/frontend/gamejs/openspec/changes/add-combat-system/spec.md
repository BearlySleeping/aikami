# Spec: Combat System

## Overview

A combat system that handles damage calculation, health management, and attack mechanics.

## Technical Design

### DamageCalculator Class

```typescript
import { Node } from "godot";

export default class DamageCalculator extends Node {
  calculate(baseDamage: number, defense: number): number {
    return Math.max(0, baseDamage - defense);
  }
}
```

### Health Component

```typescript
import { Node, Label } from "godot";

export default class HealthComponent extends Node {
  private _maxHealth: number = 100;
  private _currentHealth: number = 100;
  private _healthLabel!: Label;

  setMaxHealth(value: number): void {
    this._maxHealth = value;
    this._currentHealth = value;
  }

  takeDamage(amount: number): number {
    const actual = Math.min(this._currentHealth, amount);
    this._currentHealth -= actual;
    this.updateDisplay();
    return actual;
  }

  heal(amount: number): void {
    this._currentHealth = Math.min(this._maxHealth, this._currentHealth + amount);
    this.updateDisplay();
  }

  isAlive(): boolean {
    return this._currentHealth > 0;
  }
}
```

## Dependencies

- None (pure game logic)

## Data Structures

```typescript
interface Combat_stats {
  maxHealth: number;
  currentHealth: number;
  defense: number;
  attack: number;
}
```

## Acceptance Criteria

1. Damage calculation returns correct values
2. Health cannot go below 0
3. Health cannot exceed max
4. UI displays current health
5. Unit tests pass for all calculations

---

**Status**: draft
