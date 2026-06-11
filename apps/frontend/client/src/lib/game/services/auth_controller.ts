// apps/frontend/client/src/lib/game/core/auth/auth_controller.ts
/**
 * Device Flow Auth Handoff between game and PWA.
 *
 * Generates a short auth code, prompts the user to visit the PWA,
 * and polls Firestore `auth_requests/{code}` for the custom token.
 * Once received, authenticates the internal Firebase REST client.
 *
 * State changes are communicated via the `onStateChange` callback.
 */

import {
  BaseGameClass,
  type BaseGameClassInterface,
  type BaseGameClassOptions,
} from '../core/base_game_class.ts';
import { getFirebase } from './firebase/firebase_app.ts';

const AUTH_REQUEST_COLLECTION = 'auth_requests';
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 120_000;
const CODE_LENGTH = 6;

/**
 * State machine for the auth handoff.
 */
export type AuthHandoffState =
  | { type: 'idle' }
  | { type: 'waiting'; code: string; pwaUrl: string }
  | { type: 'authenticated'; uid: string }
  | { type: 'error'; message: string }
  | { type: 'expired' };

/**
 * Data written to Firestore when a device flow auth request is initiated.
 */
type AuthRequestDocument = {
  code: string;
  status: 'pending' | 'completed' | 'expired';
  customToken?: string;
  uid?: string;
  createdAt: string;
  completedAt?: string;
};

export type AuthControllerOptions = BaseGameClassOptions;

export type AuthControllerInterface = BaseGameClassInterface & {
  readonly state: AuthHandoffState;
  onStateChange(callback: (state: AuthHandoffState) => void): void;
  startHandoff(options: { pwaBaseUrl: string }): Promise<void>;
  cancel(): void;
  reset(): void;
};

/**
 * Controller for the Device Flow authentication handoff.
 * Game → PWA → Firestore → Game token retrieval flow.
 */
class AuthController
  extends BaseGameClass<AuthControllerOptions>
  implements AuthControllerInterface
{
  private _state: AuthHandoffState = { type: 'idle' };
  private _onChange: ((state: AuthHandoffState) => void) | null = null;

  /** Current handoff state. */
  get state(): AuthHandoffState {
    return this._state;
  }

  /**
   * Registers a callback for state changes.
   * @param callback - Called whenever the auth state changes
   */
  onStateChange(callback: (state: AuthHandoffState) => void): void {
    this._onChange = callback;
  }

  /**
   * Initiates the device flow auth handoff.
   * Generates a short code, writes it to Firestore, and begins polling.
   * @param pwaBaseUrl - Base URL of the PWA (e.g. "http://localhost:5274")
   */
  async startHandoff(options: { pwaBaseUrl: string }): Promise<void> {
    const { pwaBaseUrl } = options;
    const fb = getFirebase();
    const code = this._generateCode();

    const pwaUrl = `${pwaBaseUrl}/auth/game?code=${code}`;

    // Write auth request to Firestore
    const doc: AuthRequestDocument = {
      code,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    const written = await fb.firestore.setDocument(
      `${AUTH_REQUEST_COLLECTION}/${code}`,
      doc as unknown as Record<string, unknown>,
    );

    if (!written) {
      this._setState({ type: 'error', message: 'Failed to initiate auth handoff' });
      return;
    }

    this._setState({ type: 'waiting', code, pwaUrl });

    // Open PWA in new window/tab
    window.open(pwaUrl, '_blank', 'width=480,height=640');

    // Start polling for the token
    this._pollForToken(code);
  }

  /**
   * Cancels the current auth handoff.
   */
  cancel(): void {
    this._setState({ type: 'idle' });
  }

  /**
   * Resets the controller to idle state.
   */
  reset(): void {
    this._setState({ type: 'idle' });
  }

  // ── Private Helpers ────────────────────────────────────────

  /**
   * Updates state and notifies the callback.
   */
  private _setState(state: AuthHandoffState): void {
    this._state = state;
    this._onChange?.(state);
  }

  /**
   * Generates a short alphanumeric code for the handoff.
   */
  private _generateCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  /**
   * Polls Firestore for the auth token at regular intervals.
   * @param code - Auth code to poll for
   */
  private async _pollForToken(code: string): Promise<void> {
    const fb = getFirebase();
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    const poll = async (): Promise<void> => {
      // Check timeout
      if (Date.now() > deadline) {
        this._setState({ type: 'expired' });
        return;
      }

      // Check cancellation
      if (this._state.type !== 'waiting') {
        return;
      }

      const doc = await fb.firestore.getDocument<AuthRequestDocument>(
        `${AUTH_REQUEST_COLLECTION}/${code}`,
      );

      if (!doc) {
        // Document may not exist yet — try again
        setTimeout(poll, POLL_INTERVAL_MS);
        return;
      }

      if (doc.status === 'completed' && doc.customToken) {
        // Authenticate with the custom token
        const user = await fb.auth.signInWithCustomToken(doc.customToken);

        if (user) {
          this._setState({ type: 'authenticated', uid: user.uid });
        } else {
          this._setState({ type: 'error', message: 'Authentication failed' });
        }
      } else if (doc.status === 'expired') {
        this._setState({ type: 'expired' });
      } else {
        // Still pending — poll again
        setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    // Start polling after a brief delay
    setTimeout(poll, POLL_INTERVAL_MS);
  }

  override async setup(): Promise<void> {}
}

export const getAuthController = (options: AuthControllerOptions): AuthControllerInterface =>
  new AuthController(options);
