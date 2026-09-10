// apps/frontend/client/src/lib/services/media/audio_context_manager.ts

/**
 * Singleton AudioContext manager for the PWA.
 *
 * Handles browser autoplay policy by attaching a one-shot user-gesture listener
 * (`pointerdown` / `keydown` / `touchstart`) that calls `audioContext.resume()`
 * and removes itself upon success.
 *
 * C-XXX: The AudioContext is now constructed inside the FIRST user gesture
 * rather than eagerly at module load. Browsers emit
 * "An AudioContext was prevented from starting automatically" when a context
 * is created/resumed outside a gesture, and AudioService used to build its
 * graph (and thus the context) in its constructor — producing that warning on
 * every boot before the app even initialized. The context is therefore only
 * materialized here, inside a gesture, or on the first explicit `context`
 * access (AudioService defers its graph to first use).
 */
class AudioContextManager {
  private _context: AudioContext | undefined;

  constructor() {
    // Autoplay policy: an AudioContext must be created/resumed after a user
    // gesture. Register one-shot listeners for the first gesture so the shared
    // context is constructed (and resumed) inside it — avoiding the
    // "was prevented from starting automatically" console warning at boot.
    // `unlock()` registers its own retry listeners, so this just needs to
    // fire once on the very first interaction.
    if (typeof window !== 'undefined') {
      const ensure = (): void => this._ensureRunning();
      window.addEventListener('pointerdown', ensure, { once: true });
      window.addEventListener('keydown', ensure, { once: true });
      window.addEventListener('touchstart', ensure, { once: true });
    }
  }

  /**
   * Returns the shared AudioContext, creating it lazily on first access.
   * The context is created in a suspended state and must be unlocked via
   * a user gesture (see {@link unlock}).
   */
  get context(): AudioContext {
    if (!this._context) {
      const Ctor = (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }) // guard-ignore lint/type-safety/casting: webkitAudioContext polyfill - browser-specific API not in TS types
          .webkitAudioContext) as typeof AudioContext;

      this._context = new Ctor();
      // context starts suspended under autoplay policy
    }
    return this._context;
  }

  /**
   * Creates (if needed) and resumes the shared AudioContext. Safe to call from
   * within a user gesture. Outside a gesture the resume is best-effort — it
   * resolves only when a later gesture unlocks it.
   */
  private _ensureRunning(): void {
    const ctx = this.context;
    if (ctx.state === 'running') {
      return;
    }
    void ctx
      .resume()
      .then(() => {
        // If the first-gesture creation was racing an autoplay-policy block,
        // a later gesture listener in `unlock()` will retry the resume.
      })
      .catch(() => {
        // Autoplay policy still blocks — the gesture listeners will retry.
      });
  }

  /**
   * Attaches a one-shot pointerdown / keydown / touchstart listener that
   * resumes the AudioContext. The listeners are removed after the first
   * successful resume — either via a later user gesture or the immediate
   * resume attempt below.
   */
  unlock(): void {
    const ctx = this.context;
    if (ctx.state === 'running') {
      return;
    }

    // Register the gesture listeners FIRST so the immediate resume attempt
    // can also remove them on success — otherwise they would leak when the
    // direct resume succeeds without any subsequent user gesture.
    const resume = async (): Promise<void> => {
      try {
        await ctx.resume();
        if (ctx.state === 'running') {
          window.removeEventListener('pointerdown', resume);
          window.removeEventListener('keydown', resume);
          window.removeEventListener('touchstart', resume);
        }
      } catch {
        // Autoplay policy may still block — listener stays attached
      }
    };
    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);
    window.addEventListener('touchstart', resume);

    // Actively attempt resume — succeeds only when called within a user
    // gesture (e.g. clicking "New Game"). On success, remove both gesture
    // listeners immediately. Outside a gesture this is a harmless rejected
    // promise; the gesture listeners above cover the next interaction.
    void ctx
      .resume()
      .then(() => {
        if (ctx.state === 'running') {
          window.removeEventListener('pointerdown', resume);
          window.removeEventListener('keydown', resume);
          window.removeEventListener('touchstart', resume);
        }
      })
      .catch(() => {
        // Autoplay policy still blocks — the gesture listener will retry.
      });
  }
}

/** Singleton instance — use this everywhere. */
export const audioContextManager = new AudioContextManager();
