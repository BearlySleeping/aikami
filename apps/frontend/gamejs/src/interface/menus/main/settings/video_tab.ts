// apps/frontend/gamejs/src/interface/menus/main/settings/video_tab.ts
import { type CheckBox, type OptionButton, TabBar } from 'godot';
import AudioManager from '../../../../core/managers/audio_manager';
import ConfigManager from '../../../../core/managers/config_manager';

export default class VideoTab extends TabBar {
    private fullscreenCheck!: CheckBox;
    private borderlessCheck!: CheckBox;
    private vsyncOption!: OptionButton;

    _ready(): void {
        this.assign_nodes();
        this.load_video_settings();
    }

    private assign_nodes(): void {
        this.fullscreenCheck = <CheckBox>this.get_node('%FullscreenCheck');
        this.borderlessCheck = <CheckBox>this.get_node('%BorderlessCheck');
        this.vsyncOption = <OptionButton>this.get_node('%VsyncOption');
    }

    private load_video_settings(): void {
        if (!ConfigManager.instance) return;

        const fullscreen = ConfigManager.instance.get_value(ConfigManager.ConfigKey.VIDEO_FULLSCREEN, false) as boolean;
        if (fullscreen) {
            this.fullscreenCheck.button_pressed = true;
        }

        const borderless = ConfigManager.instance.get_value(ConfigManager.ConfigKey.VIDEO_BORDERLESS, false) as boolean;
        if (borderless) {
            this.borderlessCheck.button_pressed = true;
        }

        const vsync = ConfigManager.instance.get_value(ConfigManager.ConfigKey.VIDEO_VSYNC, 0) as number;
        if (this.vsyncOption) {
            this.vsyncOption.selected = vsync;
        }
    }

    _on_fullscreen_toggled(toggled_on: boolean): void {
        this.play_button_sound();
        ConfigManager.instance?.set_value(ConfigManager.ConfigKey.VIDEO_FULLSCREEN, toggled_on);
    }

    _on_borderless_toggled(toggled_on: boolean): void {
        this.play_button_sound();
        ConfigManager.instance?.set_value(ConfigManager.ConfigKey.VIDEO_BORDERLESS, toggled_on);
    }

    _on_vsync_item_selected(index: number): void {
        this.play_button_sound();
        ConfigManager.instance?.set_value(ConfigManager.ConfigKey.VIDEO_VSYNC, index);
    }

    private play_button_sound(): void {
        AudioManager.instance?.play_sfx(AudioManager.SFXName.MENU);
    }
}
