import { _ } from 'godot';
import { Node, GodotObject } from 'godot';

export class GameState extends Node {
  private static _instance: GameState | null = null;

  static get instance(): GameState | null {
    return GameState._instance;
  }

  private _score: number = 0;
  private _isPaused: boolean = false;
  private _currentLevel: number = 1;

  get score(): number {
    return this._score;
  }

  set score(value: number) {
    this._score = value;
    _.print(`Score updated: ${this._score}`);
  }

  get isPaused(): boolean {
    return this._isPaused;
  }

  set isPaused(value: boolean) {
    this._isPaused = value;
    _.print(`Game paused: ${this._isPaused}`);
  }

  get currentLevel(): number {
    return this._currentLevel;
  }

  set currentLevel(value: number) {
    this._currentLevel = value;
    _.print(`Level changed: ${this._currentLevel}`);
  }

  override _ready(): void {
    super._ready();
    GameState._instance = this;
    _.print('GameState initialized');
  }

  reset(): void {
    this._score = 0;
    this._isPaused = false;
    this._currentLevel = 1;
    _.print('GameState reset');
  }
}
