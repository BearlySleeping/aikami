// apps/frontend/pwa/src/lib/game/menu/menu_controller.ts

import {
  BaseGameClass,
  type BaseGameClassInterface,
  type BaseGameClassOptions,
} from '$lib/game/core/base_game_class.ts';

// ---------------------------------------------------------------------------
// MenuController — manages menu ↔ game screen transitions
// ---------------------------------------------------------------------------

type Screen = 'menu' | 'options' | 'game' | 'login';
type MenuCallback = (screen: Screen) => void;
type LoginCallback = () => void;
type NewGameCallback = () => void;

/** Auth display state for the menu UI. */
type AuthUiState = {
  isLoggedIn: boolean;
  displayName: string;
};

/** Resolves a DOM element by ID, throws if not found. */
const getEl = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Element #${id} not found`);
  }
  return el;
};

export type MenuControllerOptions = BaseGameClassOptions;

export type MenuControllerInterface = BaseGameClassInterface & {
  getScreen(): Screen;
  showMenu(): void;
  showOptions(): void;
  showLogin(): void;
  showGame(): void;
  showQuitConfirm(): void;
  hideQuitConfirm(): void;
  getResolution(): { width: number; height: number };
  setAuthState(state: AuthUiState): void;
  setAuthStatusMessage(message: string): void;
  onScreenChange(cb: MenuCallback): () => void;
  onLoginRequest(cb: LoginCallback): () => void;
  onNewGameRequest(cb: NewGameCallback): () => void;
};

/**
 * Simple menu controller that manages visibility of the four main screens:
 * main menu, options panel, login/auth screen, and game canvas.
 *
 * Pure imperative DOM manipulation — no framework needed.
 */
class MenuController
  extends BaseGameClass<MenuControllerOptions>
  implements MenuControllerInterface
{
  private menuScreen = getEl('menu-screen');
  private optionsPanel = getEl('options-panel');
  private gameScreen = getEl('game-screen');
  private quitOverlay = getEl('quit-overlay');
  private authStatusEl = getEl('auth-status') as HTMLDivElement;

  private btnStart = getEl('btn-start') as HTMLButtonElement;
  private btnOptions = getEl('btn-options') as HTMLButtonElement;
  private btnQuit = getEl('btn-quit') as HTMLButtonElement;
  private btnOptionsBack = getEl('btn-options-back') as HTMLButtonElement;
  private selectResolution = getEl('select-resolution') as HTMLSelectElement;
  private btnQuitConfirm = getEl('btn-quit-confirm') as HTMLButtonElement;
  private btnQuitCancel = getEl('btn-quit-cancel') as HTMLButtonElement;
  private btnLogin = getEl('btn-login') as HTMLButtonElement;
  private btnNewGame = getEl('btn-new-game') as HTMLButtonElement;

  private currentScreen: Screen = 'menu';
  private listeners: MenuCallback[] = [];
  private loginListeners: LoginCallback[] = [];
  private newGameListeners: NewGameCallback[] = [];

  constructor(options: MenuControllerOptions) {
    super(options);
    this.bindEvents();
  }

  /** Returns the current screen. */
  getScreen(): Screen {
    return this.currentScreen;
  }

  /** Shows the main menu. */
  showMenu(): void {
    this.menuScreen.style.display = 'flex';
    this.optionsPanel.style.display = 'none';
    this.gameScreen.style.display = 'none';
    this.quitOverlay.style.display = 'none';
    this.currentScreen = 'menu';
    this.notify('menu');
  }

  /** Shows the options panel. */
  showOptions(): void {
    this.menuScreen.style.display = 'none';
    this.optionsPanel.style.display = 'flex';
    this.gameScreen.style.display = 'none';
    this.quitOverlay.style.display = 'none';
    this.currentScreen = 'options';
    this.notify('options');
  }

  /** Shows the login/auth screen (game screen div with PixiJS auth overlay). */
  showLogin(): void {
    this.menuScreen.style.display = 'none';
    this.optionsPanel.style.display = 'none';
    this.gameScreen.style.display = 'block';
    this.quitOverlay.style.display = 'none';
    this.currentScreen = 'login';
    this.notify('login');
  }

  /** Shows the game screen. */
  showGame(): void {
    this.menuScreen.style.display = 'none';
    this.optionsPanel.style.display = 'none';
    this.gameScreen.style.display = 'block';
    this.quitOverlay.style.display = 'none';
    this.currentScreen = 'game';
    this.notify('game');
  }

  /** Shows the quit confirmation overlay. */
  showQuitConfirm(): void {
    this.quitOverlay.style.display = 'flex';
  }

  /** Hides the quit confirmation overlay. */
  hideQuitConfirm(): void {
    this.quitOverlay.style.display = 'none';
  }

  /** Returns the selected resolution. */
  getResolution(): { width: number; height: number } {
    const [w, h] = this.selectResolution.value.split('x').map(Number);
    return { width: w ?? 800, height: h ?? 600 };
  }

  /**
   * Updates the auth status display in the main menu.
   */
  setAuthState(state: AuthUiState): void {
    if (state.isLoggedIn) {
      this.authStatusEl.textContent = `Logged in as ${state.displayName}`;
      this.authStatusEl.style.color = '#7ec8e3';
      this.btnLogin.style.display = 'none';
      this.btnNewGame.style.display = 'block';
      this.btnStart.style.display = 'none';
    } else {
      this.authStatusEl.textContent = 'Not logged in';
      this.authStatusEl.style.color = '#8899aa';
      this.btnLogin.style.display = 'block';
      this.btnNewGame.style.display = 'none';
      this.btnStart.style.display = 'block';
    }
  }

  /**
   * Shows a temporary status message in the auth area.
   */
  setAuthStatusMessage(message: string): void {
    this.authStatusEl.textContent = message;
  }

  /** Register a screen-change listener. Returns unsubscribe function. */
  onScreenChange(cb: MenuCallback): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  /** Register a login-request listener. Fired when user clicks "Login". */
  onLoginRequest(cb: LoginCallback): () => void {
    this.loginListeners.push(cb);
    return () => {
      this.loginListeners = this.loginListeners.filter((l) => l !== cb);
    };
  }

  /** Register a new-game-request listener. Fired when user clicks "New Game". */
  onNewGameRequest(cb: NewGameCallback): () => void {
    this.newGameListeners.push(cb);
    return () => {
      this.newGameListeners = this.newGameListeners.filter((l) => l !== cb);
    };
  }

  private bindEvents(): void {
    this.btnStart.addEventListener('click', () => this.showGame());
    this.btnOptions.addEventListener('click', () => this.showOptions());
    this.btnQuit.addEventListener('click', () => this.showQuitConfirm());
    this.btnOptionsBack.addEventListener('click', () => this.showMenu());
    this.btnQuitCancel.addEventListener('click', () => this.hideQuitConfirm());
    this.btnQuitConfirm.addEventListener('click', () => {
      this.hideQuitConfirm();
      this.showMenu();
    });
    this.btnLogin.addEventListener('click', () => {
      this.showLogin();
      for (const listener of this.loginListeners) {
        listener();
      }
    });
    this.btnNewGame.addEventListener('click', () => {
      for (const listener of this.newGameListeners) {
        listener();
      }
    });
  }

  private notify(screen: Screen): void {
    for (const listener of this.listeners) {
      listener(screen);
    }
  }

  override async setup(): Promise<void> {}
}

export const getMenuController = (options: MenuControllerOptions): MenuControllerInterface =>
  new MenuController(options);
