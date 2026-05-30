// apps/frontend/gamejs/src/interface/auth/login_view.ts
/**
 * @fileoverview Authentication login view for GameJS
 * @description Provides email/password login, Google sign-in (via PWA bridge),
 * anonymous play, and links to SvelteKit PWA for registration.
 */
import { type Button, Callable, Color, Control, type Label, type LineEdit, OS } from 'godot';
import Env from '../../core/env';
import FirebaseAuth from '../../core/firebase/auth';
import { logger } from '../../utils/logger';

const MAIN_MENU_SCENE = 'res://src/interface/menus/main/main_menu.tscn';

export default class LoginView extends Control {
    private emailInput!: LineEdit;
    private passwordInput!: LineEdit;
    private signInButton!: Button;
    private googleSignInButton!: Button;
    private tokenInput!: LineEdit;
    private tokenSignInButton!: Button;
    private createAccountButton!: Button;
    private guestButton!: Button;
    private statusLabel!: Label;
    private buttons: Button[] = [];

    _ready(): void {
        logger.debug('LoginView: _ready');
        this.find_nodes();
        this.connect_signals();
        this.check_existing_session();
    }

    private find_nodes(): void {
        this.emailInput = <LineEdit>this.get_node('%EmailInput');
        this.passwordInput = <LineEdit>this.get_node('%PasswordInput');
        this.signInButton = <Button>this.get_node('%SignInButton');
        this.googleSignInButton = <Button>this.get_node('%GoogleSignInButton');
        this.tokenInput = <LineEdit>this.get_node('%TokenInput');
        this.tokenSignInButton = <Button>this.get_node('%TokenSignInButton');
        this.createAccountButton = <Button>this.get_node('%CreateAccountButton');
        this.guestButton = <Button>this.get_node('%GuestButton');
        this.statusLabel = <Label>this.get_node('%StatusLabel');
        this.buttons = [
            this.signInButton,
            this.googleSignInButton,
            this.tokenSignInButton,
            this.createAccountButton,
            this.guestButton,
        ];

        // Token input is hidden by default
        this.tokenInput.visible = false;
        this.tokenSignInButton.visible = false;
    }

    private connect_signals(): void {
        this.signInButton.pressed.connect(Callable.create(this, this._on_sign_in_pressed), 0);
        this.googleSignInButton.pressed.connect(Callable.create(this, this._on_google_sign_in_pressed), 0);
        this.tokenSignInButton.pressed.connect(Callable.create(this, this._on_token_sign_in_pressed), 0);
        this.createAccountButton.pressed.connect(Callable.create(this, this._on_create_account_pressed), 0);
        this.guestButton.pressed.connect(Callable.create(this, this._on_guest_pressed), 0);
    }

    // ==================== SESSION MANAGEMENT ====================

    private check_existing_session(): void {
        logger.debug('LoginView: checking existing session');
        const auth = this.get_auth();
        if (!auth) {
            this.show_status('Auth service not available', true);
            return;
        }

        auth.restore_session();

        if (auth.isAuthenticated) {
            logger.debug('LoginView: existing session found, skipping to main menu');
            this.go_to_main_menu();
        }
    }

    // ==================== EMAIL/PASSWORD AUTH ====================

    private async _on_sign_in_pressed(): Promise<void> {
        logger.debug('LoginView: sign in pressed');
        this.clear_status();

        const email = this.emailInput.text.trim();
        const password = this.passwordInput.text;

        if (!email || !password) {
            this.show_status('Please enter email and password', true);
            return;
        }

        this.set_buttons_enabled(false);
        this.show_status('Signing in...', false);

        const auth = this.get_auth();
        if (!auth) {
            this.show_status('Auth service not available', true);
            this.set_buttons_enabled(true);
            return;
        }

        const user = await auth.sign_in_with_email(email, password);
        if (user) {
            logger.debug('LoginView: sign in success', user.email);
            this.go_to_main_menu();
        } else {
            this.show_status('Invalid email or password', true);
            this.passwordInput.text = '';
            this.set_buttons_enabled(true);
        }
    }

    // ==================== GOOGLE SIGN-IN ====================

    private _on_google_sign_in_pressed(): void {
        logger.debug('LoginView: Google sign in pressed');
        this.clear_status();

        const env = this.get_env();
        if (!env) {
            this.show_status('Environment not configured', true);
            return;
        }

        const pwaUrl = env.pwa_registration_url;
        const authUrl = `${pwaUrl.replace(/\/?$/, '')}/auth/game?game=1`;

        logger.debug('LoginView: opening PWA auth bridge', authUrl);
        OS.shell_open(authUrl);

        this.show_status(
            'Browser opened for sign-in. Copy the token from the browser and paste it below, then click "Sign in with Token".',
            false,
        );

        // Show token input
        this.tokenInput.visible = true;
        this.tokenSignInButton.visible = true;
    }

    private async _on_token_sign_in_pressed(): Promise<void> {
        logger.debug('LoginView: token sign in pressed');
        this.clear_status();

        const token = this.tokenInput.text.trim();
        if (!token) {
            this.show_status('Please paste the token from the browser', true);
            return;
        }

        this.set_buttons_enabled(false);
        this.show_status('Authenticating with token...', false);

        const auth = this.get_auth();
        if (!auth) {
            this.show_status('Auth service not available', true);
            this.set_buttons_enabled(true);
            return;
        }

        const user = await auth.sign_in_with_google(token);
        if (user) {
            logger.debug('LoginView: token sign in success', user.email);
            this.go_to_main_menu();
        } else {
            this.show_status('Invalid or expired token. Please try again.', true);
            this.tokenInput.text = '';
            this.set_buttons_enabled(true);
        }
    }

    // ==================== PWA REGISTRATION LINK ====================

    private _on_create_account_pressed(): void {
        logger.debug('LoginView: create account pressed');
        const env = this.get_env();
        if (!env) {
            this.show_status('Environment not configured', true);
            return;
        }

        const url = env.pwa_registration_url;
        logger.debug('LoginView: opening PWA registration', url);
        OS.shell_open(url);
    }

    // ==================== ANONYMOUS PLAY ====================

    private async _on_guest_pressed(): Promise<void> {
        logger.debug('LoginView: guest pressed');
        this.clear_status();
        this.set_buttons_enabled(false);
        this.show_status('Signing in as guest...', false);

        const auth = this.get_auth();
        if (!auth) {
            this.show_status('Auth service not available', true);
            this.set_buttons_enabled(true);
            return;
        }

        const user = await auth.sign_in_anonymous();
        if (user) {
            logger.debug('LoginView: anonymous sign in success', user.uid);
            this.show_status('Signed in as guest. Cloud save and leaderboard are unavailable.', false);
            setTimeout(() => {
                this.go_to_main_menu();
            }, 1500);
        } else {
            this.show_status('Failed to sign in as guest', true);
            this.set_buttons_enabled(true);
        }
    }

    // ==================== NAVIGATION ====================

    private go_to_main_menu(): void {
        logger.debug('LoginView: transitioning to main menu');
        this.get_tree().change_scene_to_file(MAIN_MENU_SCENE);
    }

    // ==================== HELPERS ====================

    private get_auth(): FirebaseAuth | null {
        return (
            FirebaseAuth.instance ??
            ((globalThis as Record<string, unknown>).firebaseAuthInstance as FirebaseAuth | null)
        );
    }

    private get_env(): Env | null {
        return Env.instance ?? ((globalThis as Record<string, unknown>).envInstance as Env | null);
    }

    private show_status(message: string, isError: boolean): void {
        this.statusLabel.text = message;
        this.statusLabel.modulate = isError ? new Color(1, 0.3, 0.3, 1) : new Color(0.7, 0.9, 0.7, 1);
    }

    private clear_status(): void {
        this.statusLabel.text = '';
    }

    private set_buttons_enabled(enabled: boolean): void {
        this.buttons.forEach((button) => {
            button.disabled = !enabled;
        });
    }
}
