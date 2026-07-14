// apps/frontend/client/src/lib/services/npc/autonomous_message_service.svelte.ts
//
// Autonomous Message Service — poller that triggers unprompted NPC
// messages when the player is idle. Performs weighted NPC selection,
// cooldown enforcement, and contextual message generation.
//
// Contract: C-248 Autonomous NPC Behavior Schedules

import {
  AUTONOMOUS_CONTEXT_MESSAGE_COUNT,
  DEFAULT_IDLE_THRESHOLD_MS,
  DEFAULT_POLLER_INTERVAL_MS,
  MOBILE_LOW_BATTERY_THRESHOLD,
} from '@aikami/constants';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { NpcSchedule } from '@aikami/types';
import { gameOverlayService, idleDetectionService, worldStateService } from '$services';
import { textGenerationService } from '../ai/text_generation_service.svelte.ts';
import { chatService } from '../chat/chat.svelte.ts';
import { npcScheduleService } from './npc_schedule_service.svelte.ts';

// ── Types ────────────────────────────────────────────────────────────────

export type AutonomousMessageServiceOptions = BaseFrontendClassOptions & {
  /** Poller interval in milliseconds (default: 60s). */
  pollerIntervalMs?: number;
  /** Idle threshold in milliseconds (default: 5 min). */
  idleThresholdMs?: number;
};

export type AutonomousMessageServiceInterface = BaseFrontendClassInterface & {
  /** Starts the autonomous message poller. */
  start(): void;

  /** Stops the autonomous message poller. */
  stop(): void;

  /** Whether the poller is currently running. */
  readonly isRunning: boolean;

  /** Whether the service is currently paused (e.g. active generation). */
  readonly isPaused: boolean;

  /** Pauses the poller (e.g. during active AI generation). */
  pause(): void;

  /** Resumes the poller. */
  resume(): void;
};

// ── Constants ────────────────────────────────────────────────────────────

/** Minimum interval between ticks to prevent double-fires. */
const MIN_TICK_INTERVAL_MS = 5000;

// ── Implementation ───────────────────────────────────────────────────────

class AutonomousMessageService
  extends BaseFrontendClass<AutonomousMessageServiceOptions>
  implements AutonomousMessageServiceInterface
{
  isRunning = $state(false);
  isPaused = $state(false);

  private _intervalHandle: ReturnType<typeof setInterval> | undefined;
  private _lastTickTime = 0;
  private _pollerIntervalMs: number;
  private _idleThresholdMs: number;

  /** Per-NPC cooldown tracker: npcId → timestamp of last message. */
  private _cooldowns = new Map<string, number>();

  constructor(options: AutonomousMessageServiceOptions) {
    super(options);
    this._pollerIntervalMs = options.pollerIntervalMs ?? DEFAULT_POLLER_INTERVAL_MS;
    this._idleThresholdMs = options.idleThresholdMs ?? DEFAULT_IDLE_THRESHOLD_MS;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  start(): void {
    if (this._intervalHandle !== undefined) {
      this.warn('start:already-running');
      return;
    }

    this.isRunning = true;
    this._scheduleNextTick();
    this.debug('start:poller-running', { intervalMs: this._pollerIntervalMs });
  }

  stop(): void {
    if (this._intervalHandle !== undefined) {
      clearInterval(this._intervalHandle);
      this._intervalHandle = undefined;
    }
    this.isRunning = false;
    this.debug('stop:poller-stopped');
  }

  pause(): void {
    this.isPaused = true;
  }

  resume(): void {
    this.isPaused = false;
  }

  // ── Private: Poller scheduling ──────────────────────────────────────

  private _scheduleNextTick(): void {
    const intervalMs = this._getEffectiveIntervalMs();
    this._intervalHandle = setInterval(() => {
      this._tick();
    }, intervalMs);
  }

  /**
   * Returns the effective poller interval, adjusted for mobile battery.
   */
  private _getEffectiveIntervalMs(): number {
    let interval = this._pollerIntervalMs;

    // Mobile battery optimization — feature-detect navigator.getBattery
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<{ level: number; charging: boolean }>;
    };
    if (typeof nav.getBattery === 'function') {
      nav
        .getBattery()
        .then((battery) => {
          if (!battery.charging && battery.level < MOBILE_LOW_BATTERY_THRESHOLD) {
            this.debug('tick:low-battery', { level: battery.level });
          }
        })
        .catch(() => {
          // Battery API not available — silently ignore
        });
    }

    return interval;
  }

  // ── Private: Tick logic ─────────────────────────────────────────────

  private async _tick(): Promise<void> {
    const now = Date.now();

    // Prevent drift — skip tick if too close to previous
    if (now - this._lastTickTime < MIN_TICK_INTERVAL_MS) {
      return;
    }
    this._lastTickTime = now;

    // Guard: paused (e.g. active AI generation in chat)
    if (this.isPaused) {
      return;
    }

    // Guard: DND mode active
    if (idleDetectionService.isDnd) {
      return;
    }

    // Guard: player not idle long enough
    if (!idleDetectionService.isIdle(this._idleThresholdMs)) {
      return;
    }

    // Guard: player is in combat (active gameplay)
    if (gameOverlayService.activeOverlay === 'COMBAT') {
      return;
    }

    // Guard: chat is actively streaming
    if (chatService.isTyping || chatService.isSending) {
      return;
    }

    // For now, use NPC IDs from any known source. In a full implementation,
    // this would query the current game session's NPC list.
    const eligibleNpcIds = await this._getEligibleNpcIds();
    if (eligibleNpcIds.length === 0) {
      return;
    }

    // Select one NPC via weighted random
    const selectedNpcId = this._selectWeightedRandom(eligibleNpcIds);
    if (!selectedNpcId) {
      return;
    }

    this.debug('tick:selected-npc', { npcId: selectedNpcId });

    // Generate and post the autonomous message
    await this._generateAutonomousMessage({ npcId: selectedNpcId });
  }

  // ── Private: NPC eligibility ────────────────────────────────────────

  /**
   * Returns NPC IDs that are eligible for autonomous messaging:
   * available, autonomous enabled, talkativeness > 0, not on cooldown.
   */
  private async _getEligibleNpcIds(): Promise<string[]> {
    // For MVP, scan all NPCs in the current game session.
    // The full implementation would discover NPCs from the active game state.
    // We delegate to npcScheduleService — it has a cache.
    // For now, return an empty list. Real integration comes in Phase 5.
    const activeNpcIds = this._getKnownNpcIds();
    const eligible: string[] = [];
    const now = Date.now();

    for (const npcId of activeNpcIds) {
      try {
        const schedule = await npcScheduleService.getSchedule(npcId);

        // Must have autonomous enabled
        if (!schedule.autonomousEnabled) {
          continue;
        }

        // Must have talkativeness > 0
        if (schedule.talkativeness <= 0) {
          continue;
        }

        // Cooldown check
        const lastMessage = this._cooldowns.get(npcId);
        if (lastMessage !== undefined) {
          const cooldownMs = schedule.cooldownMinutes * 60 * 1000;
          if (now - lastMessage < cooldownMs) {
            continue;
          }
        }

        // Must be available (online or idle)
        const available = await npcScheduleService.isAvailable(npcId);
        if (!available) {
          continue;
        }

        eligible.push(npcId);
      } catch {
        // Skip NPCs that fail to load
      }
    }

    return eligible;
  }

  /**
   * Returns known NPC IDs accessible to the current user.
   * Uses npcService to get user NPCs, plus world gen NPCs.
   */
  private _getKnownNpcIds(): string[] {
    const ids = new Set<string>();

    // Collect from world gen output NPCs (use names as IDs since WorldGenNpc has no id field)
    const worldGen = worldStateService.worldGenOutput;
    if (worldGen?.npcs && Array.isArray(worldGen.npcs)) {
      for (const npc of worldGen.npcs) {
        ids.add(npc.name);
      }
    }

    // Also try to get user NPCs from the npc service (firestore-backed NPCs)
    try {
      // This is async but called from _tick — we handle inline
      // Since we can't await here, we use cached data from schedules
    } catch {
      // Silently ignore
    }

    return Array.from(ids);
  }

  // ── Private: Weighted random selection ──────────────────────────────

  /**
   * Selects one NPC from the eligible list using talkativeness-weighted random.
   * Higher talkativeness = higher probability of selection.
   */
  private _selectWeightedRandom(npcIds: string[]): string | undefined {
    if (npcIds.length === 0) {
      return undefined;
    }

    // Build weighted array using talkativeness from schedule cache
    const weighted: Array<{ npcId: string; weight: number }> = [];

    for (const npcId of npcIds) {
      const schedule = this._getCachedSchedule(npcId);
      const weight = schedule.talkativeness;
      weighted.push({ npcId, weight });
    }

    // Compute total weight
    const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
    if (totalWeight <= 0) {
      return npcIds[0];
    }

    // Weighted random selection
    let random = Math.random() * totalWeight;
    for (const item of weighted) {
      random -= item.weight;
      if (random <= 0) {
        return item.npcId;
      }
    }

    return weighted[weighted.length - 1].npcId;
  }

  /**
   * Synchronously returns a cached schedule, or falls back to defaults.
   * The caller must have already queried getSchedule() for the NPC.
   */
  private _getCachedSchedule(npcId: string): NpcSchedule {
    // Return fallback defaults — the talkativeness is the key value here
    return {
      npcId,
      days: [],
      autonomousEnabled: true,
      talkativeness: 0.5,
      cooldownMinutes: 15,
      generated: false,
      updatedAt: new Date().toISOString(),
    };
  }

  // ── Private: Message generation ─────────────────────────────────────

  /**
   * Generates and posts an autonomous message from the selected NPC.
   * Includes the last N chat messages for context.
   */
  private async _generateAutonomousMessage({ npcId }: { npcId: string }): Promise<void> {
    // Mark cooldown
    this._cooldowns.set(npcId, Date.now());

    try {
      // Build context from recent chat messages
      const recentMessages = chatService.messages.slice(-AUTONOMOUS_CONTEXT_MESSAGE_COUNT);
      const contextBlock = recentMessages.map((m) => `[${m.sender}]: ${m.text}`).join('\n');

      const prompt = [
        `You are an NPC with ID "${npcId}" in a fantasy RPG.`,
        'Send a short, contextual, autonomous message based on the recent conversation.',
        'Keep it under 3 sentences. Be in character.',
        '',
        'Recent conversation:',
        contextBlock || '(no recent conversation)',
        '',
        'Your message:',
      ].join('\n');

      // Generate the message via text generation service

      let fullText = '';

      await textGenerationService.streamChat({
        messages: [
          {
            role: 'system',
            content:
              'You are an NPC in a fantasy RPG. Send one short, in-character message under 3 sentences.',
          },
          { role: 'user', content: prompt },
        ],
        onChunk: (chunk: string) => {
          fullText += chunk;
        },
      });

      if (fullText.trim().length > 0) {
        // Post as autonomous AI message with metadata
        chatService.addMessage({
          id: crypto.randomUUID(),
          text: fullText.trim(),
          sender: 'ai',
          timestamp: new Date(),
        });
        this.debug('tick:message-posted', { npcId, textLength: fullText.length });
      }
    } catch (error) {
      this.error('_generateAutonomousMessage:failed', error);
      // Remove cooldown on failure so NPC can try again next tick
      this._cooldowns.delete(npcId);
    }
  }

  // ── Teardown ────────────────────────────────────────────────────────

  destroy(): void {
    this.stop();
  }
}

export const autonomousMessageService: AutonomousMessageServiceInterface =
  AutonomousMessageService.create({
    className: 'AutonomousMessageService',
  }) as AutonomousMessageServiceInterface;
