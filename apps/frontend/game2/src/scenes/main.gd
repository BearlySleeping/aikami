import { _ } from 'godot';
import { Node, SceneTree } from 'godot';

export class Main extends Node {
  override _ready(): void {
    _.print('Game2 Main Scene loaded');
  }
}
