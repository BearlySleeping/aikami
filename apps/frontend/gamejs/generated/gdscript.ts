import {} from 'gdscript';
import { ResourceLoader } from 'godot';

type GDScriptPaths = string;

type GDScriptClasses = unknown;

/**
 * Instantiate a GDScript class with `.new()`.
 * @param path Local path to the GDScript file.
 */
export function instantiate_gdscript<T extends GDScriptClasses>(path: GDScriptPaths): T {
  return ResourceLoader.load(path).call('new') as T;
}
