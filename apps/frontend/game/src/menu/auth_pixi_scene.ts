// apps/frontend/game/src/menu/auth_pixi_scene.ts

import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js';

// ---------------------------------------------------------------------------
// AuthPixiScene — PixiJS v8 overlay for device auth code display
//
// Creates a lightweight PixiJS Application on the game canvas to show
// the shortcode and polling status during device flow authentication.
// Destroyed when auth completes or the user cancels.
// ---------------------------------------------------------------------------

/** Callback when the user presses Escape or the cancel button. */
type CancelCallback = () => void;

/**
 * Manages a PixiJS rendering overlay specifically for the device auth flow.
 *
 * Renders the shortcode, PWA URL, and polling status as PixiJS Text objects.
 * Handles cleanup when the scene is dismissed.
 */
export class AuthPixiScene {
  private _app: Application | undefined;
  private _root: Container | undefined;
  private _codeText: Text | undefined;
  private _urlText: Text | undefined;
  private _statusText: Text | undefined;
  private _cancelCallback: CancelCallback | null = null;
  private _canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this._canvas = canvas;
  }

  /**
   * Initializes the PixiJS application and renders the auth UI.
   * @param code - The 6-character auth code
   * @param pwaUrl - The full PWA URL the user should visit
   * @param onCancel - Called when the user dismisses the auth screen
   */
  async show(options: { code: string; pwaUrl: string; onCancel: CancelCallback }): Promise<void> {
    const { code, pwaUrl, onCancel } = options;
    this._cancelCallback = onCancel;

    // Destroy existing app if re-showing
    await this.destroy();

    this._app = new Application();

    await this._app.init({
      canvas: this._canvas,
      width: this._canvas.width,
      height: this._canvas.height,
      backgroundColor: 0x0a0a1a,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    this._root = new Container();
    this._app.stage.addChild(this._root);

    const centerX = this._canvas.width / 2;
    const centerY = this._canvas.height / 2;

    // Background panel
    const panel = new Graphics();
    panel.roundRect(centerX - 220, centerY - 160, 440, 320, 12);
    panel.fill({ color: 0x1a1a2e, alpha: 0.95 });
    panel.stroke({ color: 0x334155, width: 2 });
    this._root.addChild(panel);

    // Title
    const titleStyle = new TextStyle({
      fontFamily: 'monospace',
      fontSize: 22,
      fontWeight: 'bold',
      fill: 0x7ec8e3,
      align: 'center',
    });
    const title = new Text({ text: 'Device Login', style: titleStyle });
    title.anchor.set(0.5);
    title.x = centerX;
    title.y = centerY - 120;
    this._root.addChild(title);

    // Code display
    const codeStyle = new TextStyle({
      fontFamily: 'monospace',
      fontSize: 42,
      fontWeight: 'bold',
      fill: 0xffffff,
      letterSpacing: 6,
      align: 'center',
    });
    this._codeText = new Text({ text: code, style: codeStyle });
    this._codeText.anchor.set(0.5);
    this._codeText.x = centerX;
    this._codeText.y = centerY - 50;
    this._root.addChild(this._codeText);

    // URL display
    const urlStyle = new TextStyle({
      fontFamily: 'monospace',
      fontSize: 12,
      fill: 0x8899aa,
      align: 'center',
      wordWrap: true,
      wordWrapWidth: 380,
    });
    this._urlText = new Text({ text: `Visit: ${pwaUrl}`, style: urlStyle });
    this._urlText.anchor.set(0.5, 0);
    this._urlText.x = centerX;
    this._urlText.y = centerY + 10;
    this._root.addChild(this._urlText);

    // Status text
    const statusStyle = new TextStyle({
      fontFamily: 'monospace',
      fontSize: 14,
      fill: 0x8899aa,
      align: 'center',
    });
    this._statusText = new Text({ text: 'Waiting for authentication...', style: statusStyle });
    this._statusText.anchor.set(0.5);
    this._statusText.x = centerX;
    this._statusText.y = centerY + 70;
    this._root.addChild(this._statusText);

    // Cancel button
    const cancelBg = new Graphics();
    cancelBg.roundRect(0, 0, 120, 36, 6);
    cancelBg.fill({ color: 0x334155, alpha: 0.5 });
    cancelBg.x = centerX - 60;
    cancelBg.y = centerY + 100;
    cancelBg.eventMode = 'static';
    cancelBg.cursor = 'pointer';
    cancelBg.on('pointerdown', () => {
      this._cancelCallback?.();
    });
    this._root.addChild(cancelBg);

    const cancelStyle = new TextStyle({
      fontFamily: 'monospace',
      fontSize: 14,
      fill: 0xc0c8d0,
      align: 'center',
    });
    const cancelText = new Text({ text: 'Cancel', style: cancelStyle });
    cancelText.anchor.set(0.5);
    cancelText.x = centerX;
    cancelText.y = centerY + 118;
    cancelText.eventMode = 'static';
    cancelText.cursor = 'pointer';
    cancelText.on('pointerdown', () => {
      this._cancelCallback?.();
    });
    this._root.addChild(cancelText);

    // Keyboard: Escape to cancel
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        this._cancelCallback?.();
      }
    };
    window.addEventListener('keydown', handleKey, { once: true });
  }

  /**
   * Updates the status text shown below the code.
   */
  updateStatus(text: string): void {
    if (this._statusText) {
      this._statusText.text = text;
    }
  }

  /**
   * Destroys the PixiJS application and releases all resources.
   */
  async destroy(): Promise<void> {
    if (this._app) {
      this._app.destroy(true, { children: true });
      this._app = undefined;
    }
    this._root = undefined;
    this._codeText = undefined;
    this._urlText = undefined;
    this._statusText = undefined;
    this._cancelCallback = null;
  }
}
