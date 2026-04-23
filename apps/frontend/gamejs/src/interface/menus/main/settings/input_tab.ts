// apps/frontend/gamejs/src/interface/menus/main/settings/input_tab.ts
import { type Label, TabBar } from 'godot';

const DEFAULT_KEYS: Record<string, string> = {
    move_up: 'W',
    move_down: 'S',
    move_left: 'A',
    move_right: 'D',
    interact: 'E',
    pause: 'Escape',
};

export default class InputTab extends TabBar {
    private keyLabels: Map<string, Label> = new Map();

    _ready(): void {
        this.assign_nodes();
        this.display_current_keys();
    }

    private assign_nodes(): void {
        const actionNames = Object.keys(DEFAULT_KEYS);
        for (const action of actionNames) {
            const label = this.get_node(`VBoxContainer/${action.replace('_', '')}Key`) as Label;
            if (label) {
                this.keyLabels.set(action, label);
            }
        }
    }

    private display_current_keys(): void {
        for (const [action, defaultKey] of Object.entries(DEFAULT_KEYS)) {
            const label = this.keyLabels.get(action);
            if (label) {
                label.text = defaultKey;
            }
        }
    }
}
