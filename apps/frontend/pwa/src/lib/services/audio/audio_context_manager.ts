// apps/frontend/pwa/src/lib/services/media/audio_context_manager.ts

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
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext) as typeof AudioContext;

      this._context = new Ctor();
      // context starts suspended under autoplay policy
    }
    return this._context;
  }

  /**
   * Attaches a one-shot pointerdown / keydown listener that resumes the
   * AudioContext. The listener removes itself after the first successful
   * resume (or immediately if the context is already running).
   */
  unlock(): void {
    const ctx = this.context;
    if (ctx.state === 'running') {
      return;
    }

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
  }
}

/** Singleton instance — use this everywhere. */
export const audioContextManager = new AudioContextManager();
