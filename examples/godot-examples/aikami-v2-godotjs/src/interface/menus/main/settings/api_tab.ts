// apps/frontend/gamejs/src/interface/menus/main/settings/api_tab.ts
import { type LineEdit, TabBar } from 'godot';
import AudioManager from '../../../../core/managers/audio_manager';
import ConfigManager from '../../../../core/managers/config_manager';

export default class ApiTab extends TabBar {
    private openAIKeyEdit!: LineEdit;

    _ready(): void {
        this.assign_nodes();
        this.load_api_settings();
    }

    private assign_nodes(): void {
        this.openAIKeyEdit = <LineEdit>this.get_node('%OpenAIKeyEdit');
    }

    private load_api_settings(): void {
        const apiKey = ConfigManager.instance?.get_value(ConfigManager.ConfigKey.API_OPENAI_KEY, '') as string;
        if (this.openAIKeyEdit && apiKey) {
            this.openAIKeyEdit.text = apiKey;
        }
    }

    _on_save_button_pressed(): void {
        if (this.openAIKeyEdit) {
            ConfigManager.instance?.set_value(ConfigManager.ConfigKey.API_OPENAI_KEY, this.openAIKeyEdit.text);
        }
        this.play_button_sound();
    }

    private play_button_sound(): void {
        AudioManager.instance?.play_sfx(AudioManager.SFXName.MENU);
    }
}
