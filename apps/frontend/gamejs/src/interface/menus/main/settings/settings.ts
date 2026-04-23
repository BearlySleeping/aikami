// apps/frontend/gamejs/src/interface/menus/main/settings/settings.ts
import { type Button, Callable, Control, type TabContainer } from 'godot';
import AudioManager from '../../../../core/managers/audio_manager';

export default class Settings extends Control {
    private _tabContainer!: TabContainer;
    private _backButton!: Button;

    _ready(): void {
        this._tabContainer = <TabContainer>this.get_node('%SettingsTabs');
        this._backButton = <Button>this.get_node('%BackButton');
        this._connect_signals();
    }

    private _connect_signals(): void {
        this._backButton.pressed.connect(Callable.create(this, this._on_back_button_pressed), 0);
    }

    set_tab(tab_index: number): void {
        this._tabContainer.current_tab = tab_index;
        this._reset_focus();
    }

    _reset_focus(): void {
        const current_tab = this._tabContainer.get_tab_bar();
        if (current_tab) {
            current_tab.grab_focus();
        }
    }

    private _on_back_button_pressed(): void {
        this._play_button_sound();
        this._close();
    }

    private _close(): void {
        this.queue_free();
    }

    private _play_button_sound(): void {
        const audioManager = AudioManager.instance;
        if (audioManager) {
            audioManager.play_sfx(AudioManager.SFXName.MENU);
        }
    }
}
