// apps/frontend/pwa/src/lib/game/types/index.ts

export type { InteractableData } from '$lib/game/components/interactable.ts';
export type { NPCDataPayload } from '$lib/game/components/npc_data.ts';
export type { AuthPixiSceneInterface } from '$lib/game/menu/auth_pixi_scene.ts';
export type { MenuControllerInterface } from '$lib/game/menu/menu_controller.ts';
export type {
  AuthControllerInterface,
  AuthHandoffState,
} from '$lib/game/services/auth_controller.ts';
export type {
  FirebaseAuthInterface,
  FirebaseUser,
} from '$lib/game/services/firebase/auth.ts';
export type { FirebaseConfig } from '$lib/game/services/firebase/config.ts';
export type {
  FirebaseHttpClientInterface,
  HttpResult,
} from '$lib/game/services/firebase/http_client.ts';
export type {
  InteractableNpcEntry,
  InteractionCallbacks,
} from '$lib/game/systems/interaction_system.ts';
export type {
  CharacterCreationCallbacks,
  CharacterCreationControllerInterface,
} from '$lib/game/ui/character_creation_controller.ts';
export type { DialogueControllerInterface } from '$lib/game/ui/dialogue_controller.ts';
