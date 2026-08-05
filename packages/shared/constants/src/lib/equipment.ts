// packages/shared/constants/src/lib/equipment.ts
//
// Equipment paperdoll constants: slot order/labels, UI-slot → LPC-layer
// mapping, canonical LPC layer z-order, and the character starter kit.
//
// The equipment slot union itself lives in @aikami/schemas
// (EquipmentSlotSchema) — this file only carries presentation/derived data.
//
// Contract: C-374 Equipment, Armour & Weapon Inventory UI

import type { EquipmentSlot } from '@aikami/types';

// ── Slot order & labels ──────────────────────────────────────────────────

/** Canonical paperdoll slot order (top → bottom / left → right). */
export const EQUIPMENT_SLOT_ORDER: readonly EquipmentSlot[] = [
  'head',
  'leftHand',
  'rightHand',
  'body',
  'feet',
] as const;

/** Display label per slot. */
export const EQUIPMENT_SLOT_LABELS: Readonly<Record<EquipmentSlot, string>> = {
  leftHand: 'Left Hand',
  rightHand: 'Right Hand',
  head: 'Head',
  body: 'Body',
  feet: 'Feet',
} as const;

/** Compact icon glyph per slot (empty state). */
export const EQUIPMENT_SLOT_ICONS: Readonly<Record<EquipmentSlot, string>> = {
  leftHand: '🛡️',
  rightHand: '⚔️',
  head: '🪖',
  body: '👕',
  feet: '👢',
} as const;

// ── UI slot → LPC layer mapping ──────────────────────────────────────────

/**
 * Maps a paperdoll equipment slot to the LPC character layer it renders
 * into. Several UI slots map to non-base LPC layers (hat, weapon, shield)
 * which are appended on top of the base recipe; the body/feet slots map to
 * existing base layers and *replace* them.
 */
export const EQUIPMENT_SLOT_TO_LPC_SLOT: Readonly<Record<EquipmentSlot, string>> = {
  leftHand: 'shield',
  rightHand: 'weapon',
  head: 'hat',
  body: 'torso',
  feet: 'feet',
} as const;

// ── LPC layer z-order ────────────────────────────────────────────────────

/**
 * Canonical back-to-front z-order for LPC character layers, shared by the
 * in-game player renderer and any paperdoll preview.
 *
 * Base layers keep their historical order (body → legs → feet → torso →
 * head → hair); equipment layers append above them (shoulders above torso,
 * hat above hair, weapon/shield in front).
 */
export const LPC_SLOT_Z_ORDER: Readonly<Record<string, number>> = {
  body: 0,
  legs: 10,
  feet: 20,
  torso: 30,
  shoulders: 40,
  head: 50,
  hair: 60,
  hat: 70,
  weapon: 80,
  shield: 90,
} as const;

/** Default z-order for unknown LPC slots (renders behind everything). */
export const LPC_DEFAULT_SLOT_Z = 0;

// ── Starter kit (character creation) ─────────────────────────────────────

/**
 * Starting equipment + inventory granted when a new character enters the
 * world (persona_create_view_model.enterWorld). Class-agnostic for v1.
 *
 * All equipment items are pre-equipped; consumables land in the bag.
 */
export const STARTER_KIT: Readonly<{
  inventory: ReadonlyArray<{ itemId: string; quantity: number }>;
  equipment: Readonly<Partial<Record<EquipmentSlot, string>>>;
}> = {
  inventory: [
    { itemId: 'healthPotion', quantity: 2 },
    { itemId: 'manaPotion', quantity: 1 },
  ],
  equipment: {
    body: 'leatherArmor',
    feet: 'leatherBoots',
    rightHand: 'ironSword',
    leftHand: 'woodenShield',
  },
} as const;
