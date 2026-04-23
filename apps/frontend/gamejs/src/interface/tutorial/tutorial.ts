// apps/frontend/gamejs/src/interface/tutorial/tutorial.ts
import { type Button, Callable, Control, type Label } from 'godot';

const TUTORIAL_STEPS = [
    {
        title: 'Welcome to Aikami!',
        text: 'This tutorial will teach you the basics.',
    },
    {
        title: 'Movement',
        text: 'Use W, A, S, D or arrow keys to move your character.',
    },
    {
        title: 'Interaction',
        text: 'Press E or the action button to interact with objects and NPCs.',
    },
    {
        title: 'Pause',
        text: 'Press Escape to pause the game and access the menu.',
    },
    {
        title: "You're Ready!",
        text: 'Enjoy your adventure in Aikami!',
    },
];

export default class Tutorial extends Control {
    private currentStep: number = 0;
    private titleLabel!: Label;
    private textLabel!: Label;
    private nextButton!: Button;
    private skipButton!: Button;

    _ready(): void {
        this.titleLabel = <Label>this.get_node('%TitleLabel');
        this.textLabel = <Label>this.get_node('%TextLabel');
        this.nextButton = <Button>this.get_node('%NextButton');
        this.skipButton = <Button>this.get_node('%SkipButton');
        this.connect_signals();
        this.show_step(0);
    }

    private connect_signals(): void {
        this.nextButton.pressed.connect(Callable.create(this, this._on_next_pressed), 0);
        this.skipButton.pressed.connect(Callable.create(this, this._on_skip_pressed), 0);
    }

    private show_step(index: number): void {
        if (index < 0 || index >= TUTORIAL_STEPS.length) {
            this.complete();
            return;
        }

        this.currentStep = index;
        const step = TUTORIAL_STEPS[index];

        if (this.titleLabel) {
            this.titleLabel.text = step.title;
        }
        if (this.textLabel) {
            this.textLabel.text = step.text;
        }

        const isLast = index === TUTORIAL_STEPS.length - 1;
        if (this.nextButton) {
            this.nextButton.text = isLast ? 'Finish' : 'Next';
        }
    }

    private _on_next_pressed(): void {
        if (this.currentStep >= TUTORIAL_STEPS.length - 1) {
            this.complete();
        } else {
            this.show_step(this.currentStep + 1);
        }
    }

    private _on_skip_pressed(): void {
        this.complete();
    }

    private complete(): void {
        this.hide();
    }
}
