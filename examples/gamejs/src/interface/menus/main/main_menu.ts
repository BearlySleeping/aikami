// apps/frontend/gamejs/src/interface/menus/main/main_menu.ts
import { type Button, Callable, Control, type InputEventKey, type PackedScene, ResourceLoader } from 'godot';
import FirebaseAuth from '../../../core/firebase/auth';
import AudioManager from '../../../core/managers/audio_manager';
import { logger } from '../../../utils/logger';

const SETTINGS_SCENE = 'res://src/interface/menus/main/settings/settings.tscn';
const FIREBASE_TEST_SCENE = 'res://src/scenes/test/firebase_test.tscn';
const LOGIN_SCENE = 'res://src/interface/auth/login_view.tscn';
const TEST_EMAIL = 'user@example.com';
const TEST_PASSWORD = 'asdasd';

export default class MainMenu extends Control {
    private startButton!: Button;
    private optionsButton!: Button;
    private authTestButton!: Button;
    private firebaseTestButton!: Button;
    private logoutButton!: Button;
    private quitButton!: Button;

    _ready(): void {
        logger.debug('MainMenu LOADED');
        this.startButton = <Button>this.get_node('%StartButton');
        this.optionsButton = <Button>this.get_node('%OptionsButton');
        this.authTestButton = <Button>this.get_node('%AuthTestButton');
        this.firebaseTestButton = <Button>this.get_node('%FirebaseTestButton');
        this.logoutButton = <Button>this.get_node('%LogoutButton');
        this.quitButton = <Button>this.get_node('%QuitButton');
        this.connect_signals();
        this.reset_focus();
        this.set_process_input(true);
        this.update_auth_state();
    }

    _input(event: InputEventKey): void {
        if (event.pressed && event.keycode === 4194329) {
            this.run_firebase_test();
        }
    }

    private connect_signals(): void {
        this.startButton.pressed.connect(Callable.create(this, this._on_start_button_pressed), 0);
        this.optionsButton.pressed.connect(Callable.create(this, this._on_options_button_pressed), 0);
        this.authTestButton.pressed.connect(Callable.create(this, this._on_auth_test_button_pressed), 0);
        this.firebaseTestButton.pressed.connect(Callable.create(this, this.run_firebase_test), 0);
        this.logoutButton.pressed.connect(Callable.create(this, this._on_logout_pressed), 0);
        this.quitButton.pressed.connect(Callable.create(this, this._on_quit_button_pressed), 0);
    }

    private reset_focus(): void {
        this.startButton.grab_focus();
    }

    private update_auth_state(): void {
        const auth =
            FirebaseAuth.instance ??
            ((globalThis as Record<string, unknown>).firebaseAuthInstance as FirebaseAuth | null);
        const isAuth = auth?.isAuthenticated ?? false;
        this.logoutButton.visible = isAuth;
        if (auth?.currentUser?.email) {
            logger.debug('MainMenu: logged in as', auth.currentUser.email);
        }
    }

    private _on_start_button_pressed(): void {
        this.play_button_sound();
        this.load_game();
    }

    private _on_options_button_pressed(): void {
        this.play_button_sound();
        this.open_options();
    }

    private async _on_auth_test_button_pressed(): Promise<void> {
        logger.debug('Auth Test Button Pressed');
        this.play_button_sound();
        const auth =
            FirebaseAuth.instance ??
            ((globalThis as Record<string, unknown>).firebaseAuthInstance as FirebaseAuth | null);
        if (!auth) {
            logger.error('FirebaseAuth instance not available');
            return;
        }
        const user = await auth.sign_in_with_email(TEST_EMAIL, TEST_PASSWORD);
        logger.debug('sign_in_with_email', user);
        if (user) {
            this.authTestButton.text = 'Signed In!';
        } else {
            const newUser = await auth.sign_up_with_email(TEST_EMAIL, TEST_PASSWORD);
            if (newUser) {
                this.authTestButton.text = 'Created Account!';
            } else {
                this.authTestButton.text = 'Auth Failed';
            }
        }
        this.update_auth_state();
    }

    private _on_logout_pressed(): void {
        logger.debug('MainMenu: logout pressed');
        this.play_button_sound();
        const auth =
            FirebaseAuth.instance ??
            ((globalThis as Record<string, unknown>).firebaseAuthInstance as FirebaseAuth | null);
        if (auth) {
            auth.sign_out();
        }
        this.get_tree().change_scene_to_file(LOGIN_SCENE);
    }

    private _on_quit_button_pressed(): void {
        this.play_button_sound();
        this.quit_game();
    }

    private load_game(): void {
        this.get_tree().change_scene_to_file('res://src/scenes/main.tscn');
    }

    private open_options(): void {
        const scene = ResourceLoader.load<PackedScene>(SETTINGS_SCENE);
        if (scene) {
            const instance = scene.instantiate();
            this.add_child(instance);
        }
    }

    private quit_game(): void {
        this.get_tree().quit();
    }

    private play_button_sound(): void {
        const audioManager = AudioManager.instance;
        if (audioManager) {
            audioManager.play_sfx(AudioManager.SFXName.MENU);
        }
    }

    private run_firebase_test(): void {
        this.play_button_sound();
        logger.debug('MainMenu: Running Firebase test scene');
        this.get_tree().change_scene_to_file(FIREBASE_TEST_SCENE);
    }
}
