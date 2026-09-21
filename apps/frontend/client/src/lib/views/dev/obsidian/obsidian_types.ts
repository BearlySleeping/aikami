// apps/frontend/client/src/lib/views/dev/obsidian/obsidian_types.ts
//
// Feature-local projection types for the Obsidian Chronicle sandbox. These
// describe the fixture-driven display model only — they are not domain
// contracts and never cross a package boundary. The sandbox is a Phase 1
// design probe (docs/design/game_ui_hud_overhaul.md), so it deliberately owns
// its own typed timeline instead of depending on the production dialogue VM.

/** Who a composer draft is addressed to. */
export type ObsidianRecipient = 'npc' | 'party' | 'dm';

/** Whether the player is speaking or taking an in-world action. */
export type ObsidianIntentMode = 'say' | 'act';

/** The active presentation surface in the play shell. */
export type ObsidianPresentationMode =
  | 'exploration'
  | 'dialogue'
  | 'combat'
  | 'management'
  | 'focus';

/** Exclusive surface on compact viewports. */
export type ObsidianCompactSurface = 'scene' | 'chronicle' | 'codex';

/** Management sections inside the Codex. */
export type ObsidianCodexSection = 'character' | 'inventory' | 'journal' | 'party' | 'world';

/** History filter — never changes message destination. */
export type ObsidianHistoryFilter = 'all' | 'conversation' | 'encounter';

/** Sandbox display scale switch (proves large-text reflow). */
export type ObsidianTextScale = 'default' | 'large';

/** Sandbox viewport switch (proves compact reflow). */
export type ObsidianViewport = 'desktop' | 'compact';

/** A status condition rendered next to an actor's HP. */
export type ObsidianCondition = {
  readonly id: string;
  readonly label: string;
  readonly tone: 'warning' | 'danger';
};

/** A single modifier contributing to a value. */
export type ObsidianModifier = {
  readonly label: string;
  readonly delta: number;
};

/** Equipment slots the item inspector compares against. */
export type ObsidianEquipSlot = 'mainHand' | 'offHand' | 'armor' | 'trinket';

/** A spell or activated action in the actor inspector. */
export type ObsidianSpell = {
  readonly id: string;
  readonly name: string;
  readonly level: number;
  readonly cost: string;
  readonly range: string;
  readonly concentration: boolean;
  readonly description: string;
};

/** An inventory item with structured comparison data. */
export type ObsidianItem = {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly quantity: number;
  readonly weight: number;
  readonly value: string;
  readonly description: string;
  readonly equippedSlot?: ObsidianEquipSlot;
  readonly favorite: boolean;
  readonly properties: readonly string[];
  readonly modifiers: readonly ObsidianModifier[];
  readonly attunement: boolean;
};

/** A quest with authoritative progress. */
export type ObsidianQuest = {
  readonly id: string;
  readonly title: string;
  readonly status: 'active' | 'complete' | 'failed';
  readonly objective: string;
  readonly steps: readonly {
    readonly id: string;
    readonly label: string;
    readonly done: boolean;
  }[];
};

/** A player-authored journal note. */
export type ObsidianNote = {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly updatedLabel: string;
};

/** An AI-generated, source-linked summary. */
export type ObsidianSummary = {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly sourceLabel: string;
  readonly stale: boolean;
};

/** A party member or known actor. */
export type ObsidianActor = {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly kind: 'player' | 'companion' | 'npc';
  readonly hp: number;
  readonly maxHp: number;
  readonly ac: number;
  readonly hue: number;
  readonly conditions: readonly ObsidianCondition[];
  readonly relationship?: { readonly standing: string; readonly recent: string };
  readonly summary: string;
  readonly abilities: readonly { readonly label: string; readonly value: number }[];
  readonly skills: readonly {
    readonly label: string;
    readonly bonus: number;
    readonly proficient: boolean;
  }[];
  readonly features: readonly { readonly name: string; readonly description: string }[];
  readonly spells: readonly ObsidianSpell[];
};

/** The in-world context shown in the header and scene panel. */
export type ObsidianScene = {
  readonly locationName: string;
  readonly timeLabel: string;
  readonly weatherLabel: string;
  readonly saveLabel: string;
  readonly objective: string;
  readonly objectiveDetail: string;
  readonly sceneCaption: string;
  readonly sceneHue: number;
};

/** A check's full authoritative record. */
export type ObsidianCheck = {
  readonly id: string;
  readonly label: string;
  readonly abilityLabel: string;
  readonly abilityModifier: number;
  readonly proficient: boolean;
  readonly proficiencyBonus: number;
  readonly dc: number;
  readonly hiddenDc: boolean;
  readonly stakes: { readonly success: string; readonly failure: string };
  readonly phase: 'pending' | 'rolling' | 'resolved';
  readonly natural?: number;
  readonly total?: number;
  readonly isSuccess?: boolean;
  readonly committed: boolean;
};

/** A typed timeline entry. Rendering one never executes it. */
export type ObsidianTimelineEntry =
  | {
      readonly kind: 'narration';
      readonly id: string;
      readonly text: string;
      readonly speaker?: string;
    }
  | {
      readonly kind: 'speech';
      readonly id: string;
      readonly speaker: string;
      readonly actorId?: string;
      readonly text: string;
      readonly recipient: ObsidianRecipient;
      readonly altCount: number;
      readonly streaming: boolean;
    }
  | {
      readonly kind: 'action';
      readonly id: string;
      readonly actorName: string;
      readonly text: string;
    }
  | { readonly kind: 'check'; readonly id: string; readonly check: ObsidianCheck }
  | {
      readonly kind: 'consequence';
      readonly id: string;
      readonly text: string;
      readonly sourceId?: string;
    }
  | {
      readonly kind: 'image';
      readonly id: string;
      readonly alt: string;
      readonly status: 'generating' | 'ready' | 'failed';
      readonly source?: string;
    }
  | { readonly kind: 'event'; readonly id: string; readonly label: string; readonly text: string }
  | {
      readonly kind: 'error';
      readonly id: string;
      readonly text: string;
      readonly recoverable: boolean;
    };

/** A legal or unavailable combat action. */
export type ObsidianCombatAction = {
  readonly id: string;
  readonly label: string;
  readonly cost: 'action' | 'bonus' | 'reaction' | 'movement';
  readonly description: string;
  readonly available: boolean;
  readonly unavailableReason?: string;
  readonly targetLabel?: string;
};

/** One row in the initiative/turn surface. */
export type ObsidianInitiativeEntry = {
  readonly actorId: string;
  readonly name: string;
  readonly hue: number;
  readonly initiative: number;
  readonly isCurrent: boolean;
  readonly hp: number;
  readonly maxHp: number;
};

/** A discovered person, place, or faction. */
export type ObsidianWorldEntry = {
  readonly id: string;
  readonly name: string;
  readonly kind: 'person' | 'place' | 'faction';
  readonly detail: string;
};

/** A gallery media reference (not a copy). */
export type ObsidianGalleryItem = {
  readonly id: string;
  readonly alt: string;
  readonly source: string;
  readonly hue: number;
};

/** Precomputed party rail row (no transformation in the view). */
export type ObsidianPartyRow = {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly hue: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly hpPercent: number;
  readonly hpTone: 'success' | 'warning' | 'danger';
  readonly isActive: boolean;
  readonly isPlayer: boolean;
  readonly conditionLabels: readonly string[];
};

/** One item-comparison row against the matching equipped slot. */
export type ObsidianComparisonRow = {
  readonly label: string;
  readonly currentLabel: string;
  readonly incomingLabel: string;
  readonly delta: number;
  readonly isGain: boolean;
};

/** One equipped-slot summary row. */
export type ObsidianEquippedRow = {
  readonly slot: ObsidianEquipSlot;
  readonly slotLabel: string;
  readonly itemName: string;
};

/** A Codex navigation entry. */
export type ObsidianNavItem = {
  readonly id: ObsidianCodexSection;
  readonly label: string;
  readonly shortcut: string;
};

/** A recipient option in the composer. */
export type ObsidianRecipientOption = {
  readonly id: ObsidianRecipient;
  readonly label: string;
  readonly hint: string;
};

/** A secondary suggestion chip. */
export type ObsidianSuggestion = {
  readonly id: string;
  readonly label: string;
  readonly prefill: string;
};

/** Precomputed check labels so the view never transforms values. */
export type ObsidianCheckDisplay = {
  readonly abilityLabel: string;
  readonly abilityModifierLabel: string;
  readonly proficiencyLabel: string;
  readonly modifierLabel: string;
  readonly dcLabel: string;
  readonly targetLabel: string;
};

/** The single encounter result summary. */
export type ObsidianEncounterSummary = {
  readonly xp: number;
  readonly loot: string;
  readonly injuries: string;
  readonly questEffects: string;
};
