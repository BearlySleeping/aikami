// apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_pending_queue.svelte.ts
//
// Overlay-session FIFO queue of player messages submitted while a turn was
// active. Extracted from the dialogue ViewModel so the FIFO/auto-drain rules
// are unit-testable and the ViewModel stays within its size budget.

export type DialoguePendingQueueOptions = {
  /** Delivers one queued entry; resolves when that turn commits. */
  deliver(text: string): Promise<void>;
  /** Whether a new turn may start now (idle stream, no check, FREE_TEXT). */
  canDrain(): boolean;
  /** Contextual logging hook — the owning ViewModel forwards this. */
  onLog?(event: string, data?: Record<string, unknown>): void;
};

/**
 * FIFO queue for text submitted mid-turn. Auto-drains one entry per completed
 * turn while enabled; a failed/cancelled turn disables auto-drain so entries
 * stay visibly pending until an explicit retry.
 */
export class DialoguePendingQueue {
  private _queue = $state<string[]>([]);

  private _drainEnabled = true;

  private _isDraining = false;

  private readonly _deliver: (text: string) => Promise<void>;

  private readonly _canDrain: () => boolean;

  private readonly _onLog: ((event: string, data?: Record<string, unknown>) => void) | undefined;

  constructor(options: DialoguePendingQueueOptions) {
    this._deliver = options.deliver;
    this._canDrain = options.canDrain;
    this._onLog = options.onLog;
  }

  /** Snapshot of queued entries, oldest first. */
  get messages(): readonly string[] {
    return [...this._queue];
  }

  get length(): number {
    return this._queue.length;
  }

  /** Adds player text submitted while a turn is active. */
  enqueue(text: string): void {
    this._queue.push(text);
  }

  /** Clears the queue and resets drain state (session end). */
  reset(): void {
    this._queue = [];
    this._drainEnabled = true;
    this._isDraining = false;
  }

  /** Holds the queue until an explicit retry (cancellation). */
  hold(): void {
    this._drainEnabled = false;
    this._isDraining = false;
  }

  /** Re-enables auto-drain and delivers the queue. */
  retry(): void {
    this._onLog?.('retryPending', { count: this._queue.length });
    this._drainEnabled = true;
    this._maybeDrain();
  }

  /**
   * Called when a turn finishes. On success, drains FIFO if auto-drain is
   * enabled. On failure or cancellation, disables auto-drain so queued entries
   * are retained until an explicit retry.
   */
  onTurnCompleted(succeeded: boolean): void {
    if (!succeeded) {
      this._drainEnabled = false;
      this._isDraining = false;
      this._onLog?.('turnCompleted:failed-drain-disabled', { queued: this._queue.length });
      return;
    }
    this._maybeDrain();
  }

  /** Delivers the next entry when auto-drain is enabled and the turn is idle. */
  private _maybeDrain(): void {
    if (!this._drainEnabled || this._isDraining || !this._canDrain()) {
      return;
    }
    const next = this._queue.shift();
    if (!next) {
      return;
    }
    this._isDraining = true;
    this._onLog?.('drainQueue:delivering', { text: next, remaining: this._queue.length });
    void this._deliver(next).finally(() => {
      this._isDraining = false;
      this._maybeDrain();
    });
  }
}
