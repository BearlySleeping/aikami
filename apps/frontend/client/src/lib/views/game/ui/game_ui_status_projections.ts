// apps/frontend/client/src/lib/views/game/ui/game_ui_status_projections.ts
//
// C-543 — pure projections for the HUD status surfaces.
//
// The player and party status surfaces are projections of existing domain state,
// not new state. Keeping them here (a cohesive, dependency-light module) means
// the overlay-router ViewModel stays within its reviewed size budget, and the
// "what counts as low health / unhappy companion" policy has one owner that is
// testable without a browser.

import type { PartyRosterEntry } from '@aikami/types';
import { type HudHealthTone, hpPercent, hpTone, hpToneLabel } from './game_ui_hud_visibility.ts';

/** Projected player status for the HUD status surface. */
export type HudPlayerStatus = {
  readonly hp: number;
  readonly maxHp: number;
  readonly percent: number;
  readonly tone: HudHealthTone;
  readonly toneLabel: string;
  readonly valueLabel: string;
};

/** One companion row in the party status surface. */
export type HudPartyMember = {
  readonly npcId: string;
  readonly name: string;
  readonly initial: string;
  readonly classId: string;
  readonly level: number;
  readonly approval: number;
  /** Presentation band derived from approval — never the raw color alone. */
  readonly approvalTone: 'neutral' | 'warning' | 'danger';
  readonly approvalLabel: string;
};

/** The projected party status surface. */
export type HudPartyStatus = {
  readonly count: number;
  readonly maxSize: number;
  readonly isEmpty: boolean;
  readonly label: string;
  readonly members: readonly HudPartyMember[];
  /** True when a companion needs the player's attention (low approval). */
  readonly needsAttention: boolean;
};

/** The party-state fields the projection reads. */
export type GameUIPartyStatusSource = {
  readonly activeCount: number;
  readonly maxSize: number;
  readonly members: readonly PartyRosterEntry[];
};

/** Projects HP + severity into the player status surface. */
export const projectPlayerStatus = (hp: number, maxHp: number): HudPlayerStatus => {
  const percent = hpPercent(hp, maxHp);
  const tone = hpTone(percent);
  return {
    hp,
    maxHp,
    percent,
    tone,
    toneLabel: hpToneLabel(tone),
    valueLabel: `${hp}/${maxHp}`,
  };
};

const projectPartyMember = (member: PartyRosterEntry): HudPartyMember => {
  let approvalTone: HudPartyMember['approvalTone'] = 'neutral';
  let approvalLabel = 'Content';
  if (member.approval <= -50) {
    approvalTone = 'danger';
    approvalLabel = 'Hostile';
  } else if (member.approval < 0) {
    approvalTone = 'warning';
    approvalLabel = 'Unhappy';
  }
  return {
    npcId: member.npcId,
    name: member.name,
    initial: member.name.charAt(0).toUpperCase(),
    classId: member.classId,
    level: member.level,
    approval: member.approval,
    approvalTone,
    approvalLabel,
  };
};

/**
 * Projects the party roster into the status surface.
 *
 * Identity uses the real member name/class/level the domain exposes; there is no
 * portrait capability, so each member renders a neutral initial avatar. An
 * approval below the "unhappy" band raises an explicit attention marker instead
 * of hiding it.
 */
export const projectPartyStatus = (party: GameUIPartyStatusSource): HudPartyStatus => {
  const members = party.members.map(projectPartyMember);
  return {
    count: party.activeCount,
    maxSize: party.maxSize,
    isEmpty: party.activeCount === 0,
    label: `${party.activeCount}/${party.maxSize}`,
    members,
    needsAttention: members.some((member) => member.approvalTone !== 'neutral'),
  };
};
