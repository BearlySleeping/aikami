// apps/frontend/gamejs/src/core/managers/config_manager.ts
import { FileAccess, Node } from 'godot';

enum ConfigKey {
    VIDEO_FULLSCREEN = 'video_fullscreen',
    VIDEO_BORDERLESS = 'video_borderless',
    VIDEO_VSYNC = 'video_vsync',
    AUDIO_MASTER_VOLUME = 'audio_master_volume',
    AUDIO_MUSIC_VOLUME = 'audio_music_volume',
    AUDIO_SFX_VOLUME = 'audio_sfx_volume',
    AUDIO_VOICE_VOLUME = 'audio_voice_volume',
    API_OPENAI_KEY = 'api_openai_key',
}

const DEFAULT_VALUES: Record<ConfigKey, unknown> = {
    [ConfigKey.VIDEO_FULLSCREEN]: false,
    [ConfigKey.VIDEO_BORDERLESS]: false,
    [ConfigKey.VIDEO_VSYNC]: 0,
    [ConfigKey.AUDIO_MASTER_VOLUME]: 1.0,
    [ConfigKey.AUDIO_MUSIC_VOLUME]: 1.0,
    [ConfigKey.AUDIO_SFX_VOLUME]: 1.0,
    [ConfigKey.AUDIO_VOICE_VOLUME]: 1.0,
    [ConfigKey.API_OPENAI_KEY]: '',
};

const BUS_NAMES: Record<ConfigKey, string> = {
    [ConfigKey.VIDEO_FULLSCREEN]: '',
    [ConfigKey.VIDEO_BORDERLESS]: '',
    [ConfigKey.VIDEO_VSYNC]: '',
    [ConfigKey.AUDIO_MASTER_VOLUME]: 'Master',
    [ConfigKey.AUDIO_MUSIC_VOLUME]: 'Music',
    [ConfigKey.AUDIO_SFX_VOLUME]: 'SFX',
    [ConfigKey.AUDIO_VOICE_VOLUME]: 'Voice',
    [ConfigKey.API_OPENAI_KEY]: '',
};

export default class ConfigManager extends Node {
    private static _instance: ConfigManager | null = null;
    private config: Map<ConfigKey, unknown> = new Map();
    private config_path: string = 'user://config.cfg';

    static get instance(): ConfigManager | null {
        return ConfigManager._instance;
    }

    static get ConfigKey() {
        return ConfigKey;
    }

    _ready(): void {
        ConfigManager._instance = this;
        this.load_config();
    }

    private load_config(): void {
        // FileAccess.READ = 1 (from Godot enum)
        const file = FileAccess.open(this.config_path, 1);
        if (file === null) {
            this.load_defaults();
            return;
        }

        while (!file.eof_reached()) {
            const line = file.get_line().trim();
            if (line === '' || line.startsWith('#')) {
                continue;
            }
            const equal_pos = line.indexOf('=');
            if (equal_pos < 0) {
                continue;
            }
            const key_str = line.slice(0, equal_pos).trim();
            const value_str = line.slice(equal_pos + 1).trim();
            const key = key_str as ConfigKey;
            if (key in ConfigKey) {
                let value: unknown = value_str;
                if (value_str === 'true') {
                    value = true;
                } else if (value_str === 'false') {
                    value = false;
                } else if (!Number.isNaN(Number(value_str))) {
                    value = Number(value_str);
                }
                this.config.set(key, value);
            }
        }
        file.close();
        this.load_defaults();
    }

    private load_defaults(): void {
        for (const key of Object.values(ConfigKey)) {
            if (!this.config.has(key)) {
                this.config.set(key, DEFAULT_VALUES[key]);
            }
        }
    }

    private save_config(): void {
        // FileAccess.WRITE = 2 (from Godot enum)
        const file = FileAccess.open(this.config_path, 2);
        if (file === null) {
            return;
        }

        for (const [key, value] of this.config) {
            file.put_line(`${key}=${value}`);
        }
        file.close();
    }

    get_value(key: ConfigKey, default_value?: unknown): unknown {
        return this.config.get(key) ?? default_value ?? DEFAULT_VALUES[key];
    }

    set_value(key: ConfigKey, value: unknown): void {
        this.config.set(key, value);
        this.save_config();
    }

    get_audio_bus_id(key: ConfigKey): number {
        const bus_name = BUS_NAMES[key];
        if (bus_name === '') {
            return -1;
        }
        return 0;
    }

    reset(): void {
        this.config.clear();
        this.load_defaults();
        this.save_config();
    }
}
