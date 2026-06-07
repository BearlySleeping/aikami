// apps/frontend/pwa/src/lib/client/game/types/index.ts

export type { InteractableData } from '$lib/client/game/components/interactable.ts';
export type { NPCDataPayload } from '$lib/client/game/components/npc_data.ts';
export type { AuthPixiSceneInterface } from '$lib/client/game/menu/auth_pixi_scene.ts';
export type { MenuControllerInterface } from '$lib/client/game/menu/menu_controller.ts';
export type {
  AuthControllerInterface,
  AuthHandoffState,
} from '$lib/client/game/services/auth_controller.ts';
export type {
  FirebaseAuthInterface,
  FirebaseUser,
} from '$lib/client/game/services/firebase/auth.ts';
export type { FirebaseConfig } from '$lib/client/game/services/firebase/config.ts';
export type {
  FirebaseHttpClientInterface,
  HttpResult,
} from '$lib/client/game/services/firebase/http_client.ts';
export type {
  InteractableNpcEntry,
  InteractionCallbacks,
} from '$lib/client/game/systems/interaction_system.ts';
export type {
  CharacterCreationCallbacks,
  CharacterCreationControllerInterface,
} from '$lib/client/game/ui/character_creation_controller.ts';
export type { DialogueControllerInterface } from '$lib/client/game/ui/dialogue_controller.ts';
