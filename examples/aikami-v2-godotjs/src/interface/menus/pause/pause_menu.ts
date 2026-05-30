// apps/frontend/gamejs/src/interface/menus/pause/pause_menu.ts
import {
    type Button,
    Callable,
    CanvasLayer,
    Input,
    type InputEvent,
    type PackedScene,
    ResourceLoader,
    type TabContainer,
} from 'godot';
import AudioManager from '../../../core/managers/audio_manager';

const SETTINGS_SCENE = 'res://src/interface/menus/main/settings/settings.tscn';
const MAIN_MENU_SCENE = 'res://src/interface/menus/main/main_menu.tscn';

export default class PauseMenu extends CanvasLayer {
    private isPaused: boolean = false;
    private tabContainer!: TabContainer;
    private resumeButton!: Button;
    private optionsButton!: Button;
    private quitButton!: Button;

    _ready(): void {
        this.tabContainer = <TabContainer>this.get_node('MenuControl/TabContainer');
        this.resumeButton = <Button>this.get_node('%ResumeButton');
        this.optionsButton = <Button>this.get_node('%OptionsButton');
        this.quitButton = <Button>this.get_node('%QuitButton');
        this.connect_signals();
        this.hide_pause_menu();
    }

    private connect_signals(): void {
        this.resumeButton.pressed.connect(Callable.create(this, this._on_resume_pressed), 0);
        this.optionsButton.pressed.connect(Callable.create(this, this._on_options_pressed), 0);
        this.quitButton.pressed.connect(Callable.create(this, this._on_quit_pressed), 0);
    }

    _input(_event: InputEvent): void {
        if (Input.is_action_pressed('pause')) {
            this.toggle_pause();
            this.get_viewport().set_input_as_handled();
        }
    }

    show_pause_menu(): void {
        this.isPaused = true;
        this.visible = true;
        this.resumeButton.grab_focus();
    }

    hide_pause_menu(): void {
        this.isPaused = false;
        this.visible = false;
    }

    toggle_pause(): void {
        if (this.isPaused) {
            this.hide_pause_menu();
        } else {
            this.show_pause_menu();
        }
    }

    private _on_resume_pressed(): void {
        this.hide_pause_menu();
    }

    private _on_options_pressed(): void {
        const audioManager = AudioManager.instance;
        if (audioManager) {
            audioManager.play_sfx(AudioManager.SFXName.MENU);
        }
        const scene = ResourceLoader.load<PackedScene>(SETTINGS_SCENE);
        if (scene) {
            const instance = scene.instantiate();
            this.add_child(instance);
        }
    }

    private _on_quit_pressed(): void {
        this.hide_pause_menu();
        this.get_tree().change_scene_to_file(MAIN_MENU_SCENE);
    }

    change_tab(index: number): void {
        if (this.tabContainer) {
            this.tabContainer.current_tab = index;
        }
    }
}
