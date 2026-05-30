import { Node } from 'godot';

export default class GameState extends Node {
    private static _instance: GameState | null = null;
    private _score: number = 0;
    private _isPaused: boolean = false;
    private _currentLevel: number = 1;

    static get instance(): GameState | null {
        return GameState._instance;
    }

    get score(): number {
        return this._score;
    }

    set score(value: number) {
        this._score = value;
    }

    get isPaused(): boolean {
        return this._isPaused;
    }

    set isPaused(value: boolean) {
        this._isPaused = value;
    }

    get currentLevel(): number {
        return this._currentLevel;
    }

    set currentLevel(value: number) {
        this._currentLevel = value;
    }

    _ready() {
        GameState._instance = this;
    }

    reset(): void {
        this._score = 0;
        this._isPaused = false;
        this._currentLevel = 1;
    }
}
