// apps/frontend/gamejs/src/interface/menus/main/settings/audio_tab.ts
import { Callable, type HSlider, TabBar } from 'godot';
import AudioManager from '../../../../core/managers/audio_manager';
import ConfigManager from '../../../../core/managers/config_manager';

const BUS_MAP: Record<string, string> = {
    audio_master_volume: 'Master',
    audio_music_volume: 'Music',
    audio_sfx_volume: 'SFX',
    audio_voice_volume: 'Voice',
};

export default class AudioTab extends TabBar {
    private sliders: Map<string, HSlider> = new Map();

    _ready(): void {
        this.assign_nodes();
        this.connect_signals();
        this.load_audio_settings();
    }

    private assign_nodes(): void {
        const sliderNames = [
            'VolumeContainer/audiomastervolumeSlider',
            'VolumeContainer/audiomusicvolumeSlider',
            'VolumeContainer/audiosfxvolumeSlider',
            'VolumeContainer/audiovoicevolumeSlider',
        ];
        const configKeys = ['audio_master_volume', 'audio_music_volume', 'audio_sfx_volume', 'audio_voice_volume'];
        for (let i = 0; i < sliderNames.length; i++) {
            const slider = <HSlider>this.get_node(sliderNames[i]);
            if (slider) {
                this.sliders.set(configKeys[i], slider);
            }
        }
    }

    private load_audio_settings(): void {
        for (const [key, slider] of this.sliders) {
            const volume = ConfigManager.instance?.get_value(
                ConfigManager.ConfigKey[key as keyof typeof ConfigManager.ConfigKey],
                1.0,
            ) as number;
            if (slider && volume !== undefined) {
                slider.value = volume;
            }
        }
    }

    private connect_signals(): void {
        const master = this.sliders.get('audio_master_volume');
        const music = this.sliders.get('audio_music_volume');
        const sfx = this.sliders.get('audio_sfx_volume');
        const voice = this.sliders.get('audio_voice_volume');
        master?.value_changed.connect(Callable.create(this, this._on_master_changed), 0);
        music?.value_changed.connect(Callable.create(this, this._on_music_changed), 0);
        sfx?.value_changed.connect(Callable.create(this, this._on_sfx_changed), 0);
        voice?.value_changed.connect(Callable.create(this, this._on_voice_changed), 0);
    }

    private _on_master_changed(value: number): void {
        this.on_slider_changed('audio_master_volume', value);
    }
    private _on_music_changed(value: number): void {
        this.on_slider_changed('audio_music_volume', value);
    }
    private _on_sfx_changed(value: number): void {
        this.on_slider_changed('audio_sfx_volume', value);
    }
    private _on_voice_changed(value: number): void {
        this.on_slider_changed('audio_voice_volume', value);
    }

    private on_slider_changed(key: string, value: number): void {
        const busName = BUS_MAP[key];
        const audioManager = AudioManager.instance;
        if (!audioManager) return;

        switch (busName) {
            case 'Master':
                audioManager.set_master_volume(value);
                break;
            case 'Music':
                audioManager.set_music_volume(value);
                break;
            case 'SFX':
                audioManager.set_sfx_volume(value);
                break;
            case 'Voice':
                audioManager.set_voice_volume(value);
                break;
        }

        ConfigManager.instance?.set_value(ConfigManager.ConfigKey[key as keyof typeof ConfigManager.ConfigKey], value);
        this.play_button_sound();
    }

    private play_button_sound(): void {
        AudioManager.instance?.play_sfx(AudioManager.SFXName.MENU);
    }
}
