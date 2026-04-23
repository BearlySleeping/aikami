// apps/frontend/gamejs/src/core/managers/audio_manager.ts
import { AudioServer, Node } from 'godot';

enum SFXName {
    MENU = 'menu',
    CLICK = 'click',
    BACK = 'back',
}

export default class AudioManager extends Node {
    private static _instance: AudioManager | null = null;

    static get instance(): AudioManager | null {
        return AudioManager._instance;
    }

    static get SFXName() {
        return SFXName;
    }

    _ready(): void {
        AudioManager._instance = this;
    }

    play_sfx(_name: SFXName): void {
        // Placeholder - actual audio playback would use AudioStreamPlayer
    }

    set_master_volume(volume: number): void {
        const bus_idx = AudioServer.get_bus_index('Master');
        if (bus_idx >= 0) {
            AudioServer.set_bus_volume_db(bus_idx, this.linear_to_db(volume));
        }
    }

    set_music_volume(volume: number): void {
        const bus_idx = AudioServer.get_bus_index('Music');
        if (bus_idx >= 0) {
            AudioServer.set_bus_volume_db(bus_idx, this.linear_to_db(volume));
        }
    }

    set_sfx_volume(volume: number): void {
        const bus_idx = AudioServer.get_bus_index('SFX');
        if (bus_idx >= 0) {
            AudioServer.set_bus_volume_db(bus_idx, this.linear_to_db(volume));
        }
    }

    set_voice_volume(volume: number): void {
        const bus_idx = AudioServer.get_bus_index('Voice');
        if (bus_idx >= 0) {
            AudioServer.set_bus_volume_db(bus_idx, this.linear_to_db(volume));
        }
    }

    private linear_to_db(linear: number): number {
        if (linear <= 0) {
            return -80;
        }
        return 20 * Math.log10(linear);
    }
}
