// apps/frontend/client/src/lib/services/media/audio_context_manager.ts

/**
 * Singleton AudioContext manager for the PWA.
 *
 * Handles browser autoplay policy by attaching a one-shot user-gesture listener
 * (`pointerdown` / `keydown`) that calls `audioContext.resume()` and removes
 * itself upon success.
 */
class AudioContextManager {
  private _context: AudioContext | undefined;

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
   * Attaches a one-shot pointerdown / keydown listener that resumes the
   * AudioContext. The listeners are removed after the first successful
   * resume — either via a later user gesture or the immediate resume
   * attempt below.
   */
  unlock(): void {
    const ctx = this.context;
    if (ctx.state === 'running') {
      return;
    }

    // Register the gesture listeners FIRST so the immediate resume attempt
    // can also remove them on success — otherwise they would leak when the
    // direct resume succeeds without any subsequent user gesture.
    const resume = async () => {
      try {
        await ctx.resume();
        if (ctx.state === 'running') {
          window.removeEventListener('pointerdown', resume);
          window.removeEventListener('keydown', resume);
        }
      } catch {
        // Autoplay policy may still block — listener stays attached
      }
    };

    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);

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
        }
      })
      .catch(() => {
        // Autoplay policy still blocks — the gesture listener will retry.
      });
  }
}

/** Singleton instance — use this everywhere. */
export const audioContextManager = new AudioContextManager();
