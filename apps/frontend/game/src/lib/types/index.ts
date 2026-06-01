// apps/frontend/game/src/lib/types/index.ts

export type { InteractableData } from '$lib/components/interactable.ts';
export type { NPCDataPayload } from '$lib/components/npc_data.ts';
export type { AuthPixiSceneInterface } from '$lib/menu/auth_pixi_scene.ts';
export type { MenuControllerInterface } from '$lib/menu/menu_controller.ts';
export type { AuthControllerInterface, AuthHandoffState } from '$lib/services/auth_controller.ts';
export type { FirebaseAuthInterface, FirebaseUser } from '$lib/services/firebase/auth.ts';
export type { FirebaseConfig } from '$lib/services/firebase/config.ts';
export type {
  FirebaseHttpClientInterface,
  HttpResult,
} from '$lib/services/firebase/http_client.ts';
export type {
  InteractableNpcEntry,
  InteractionCallbacks,
} from '$lib/systems/interaction_system.ts';
export type {
  CharacterCreationCallbacks,
  CharacterCreationControllerInterface,
} from '$lib/ui/character_creation_controller.ts';
export type { DialogueControllerInterface } from '$lib/ui/dialogue_controller.ts';
