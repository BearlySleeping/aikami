// apps/frontend/gamejs/src/interface/menus/credits/credits.ts
import { type Button, Callable, Control, type Label } from 'godot';

export default class Credits extends Control {
    private backButton!: Button;
    private creditsLabel!: Label;

    private creditsText: string = `
AIKAMI

A Game by Aikami Team

Programming
------------
Lead Developer

Art
----
Artist

Music
-----
Composer

Special Thanks
---------------
Community

© 2026 Aikami
`;

    _ready(): void {
        this.backButton = <Button>this.get_node('%BackButton');
        this.creditsLabel = <Label>this.get_node('%CreditsLabel');
        this.setup_credits();
    }

    private setup_credits(): void {
        if (this.creditsLabel) {
            this.creditsLabel.text = this.creditsText;
        }
        this.backButton.pressed.connect(Callable.create(this, this._on_back_button_pressed), 0);
    }

    private _on_back_button_pressed(): void {
        this.back_to_main();
    }

    private back_to_main(): void {
        this.queue_free();
    }
}
