// apps/frontend/game/src/menu/menu_controller.ts

// ---------------------------------------------------------------------------
// MenuController — manages menu ↔ game screen transitions
// ---------------------------------------------------------------------------

type Screen = 'menu' | 'options' | 'game';
type MenuCallback = (screen: Screen) => void;

/** Resolves a DOM element by ID, throws if not found. */
const getEl = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Element #${id} not found`);
  }
  return el;
};

/**
 * Simple menu controller that manages visibility of the three main screens:
 * main menu, options panel, and game canvas.
 *
 * Pure imperative DOM manipulation — no framework needed.
 */
export class MenuController {
  private menuScreen = getEl('menu-screen');
  private optionsPanel = getEl('options-panel');
  private gameScreen = getEl('game-screen');
  private quitOverlay = getEl('quit-overlay');

  private btnStart = getEl('btn-start') as HTMLButtonElement;
  private btnOptions = getEl('btn-options') as HTMLButtonElement;
  private btnQuit = getEl('btn-quit') as HTMLButtonElement;
  private btnOptionsBack = getEl('btn-options-back') as HTMLButtonElement;
  private selectResolution = getEl('select-resolution') as HTMLSelectElement;
  private btnQuitConfirm = getEl('btn-quit-confirm') as HTMLButtonElement;
  private btnQuitCancel = getEl('btn-quit-cancel') as HTMLButtonElement;

  private currentScreen: Screen = 'menu';
  private listeners: MenuCallback[] = [];

  constructor() {
    this.bindEvents();
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

  /** Register a screen-change listener. Returns unsubscribe function. */
  onScreenChange(cb: MenuCallback): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
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
  }

  private notify(screen: Screen): void {
    for (const listener of this.listeners) {
      listener(screen);
    }
  }
}
