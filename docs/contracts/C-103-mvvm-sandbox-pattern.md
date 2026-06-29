<!-- completed: 2026-06-29 -->
# Contract C-103: MVVM Dev Sandbox Pattern (Character)

## Context

We are establishing a strict Svelte 5 MVVM (Model-View-ViewModel) architecture. UI components (`View.svelte`) must be completely "dumb" and accept a reactive `ViewModel` class instance. For development and isolated testing, we create a `DevViewModel` that extends the production `ViewModel`, overriding data-fetching methods to inject mock data without hitting the backend.

## Scope

- The Character Profile/Card feature.
- **Source:** `apps/frontend/client/src/lib/views/dev/character/`
- **Destination:** `apps/frontend/client/src/lib/views/character/` (Production) and `apps/frontend/client/src/routes/(dev)/dev/character/` (Sandbox integration).

## Acceptance Criteria

- [ ] Move the `character` view folder out of `lib/views/dev/` and into `lib/views/character/` to reflect that the base view and view-model are production assets.
- [ ] Ensure `character_view_model.svelte.ts` exports a standard class (e.g., `CharacterViewModel`) using Svelte 5 `$state` runes for reactive properties. It should have a standard data-loading method (even if it's currently a stub).
- [ ] Create `character_dev_view_model.svelte.ts` (can live alongside it or in the dev route). This class MUST `extend CharacterViewModel`.
- [ ] In `CharacterDevViewModel`, override the data-loading method to inject mock data compliant with `@aikami/shared-types`. Add at least one dev-only method (e.g., `forceErrorState()` or `injectJunkData()`).
- [ ] Update `apps/frontend/client/src/routes/(dev)/dev/character/+page.svelte` to instantiate `CharacterDevViewModel` and pass it into the standard `<CharacterView />` component.

## Implementation Notes

1. **Move Files:** Move `apps/frontend/client/src/lib/views/dev/character` -> `apps/frontend/client/src/lib/views/character`.
2. **Fix Imports:** Do a workspace search to fix any imports pointing to the old `views/dev/character` path.
3. **The Svelte 5 Pattern:** ```typescript
   // Production
   export class CharacterViewModel {
   character = $state<Character | null>(null);
   isLoading = $state(false);
   async load(id: string) { /_ production fetch _/ }
   }

    // Dev Override
    export class CharacterDevViewModel extends CharacterViewModel {
    override async load(id: string) {
    this.isLoading = true;
    // Inject mock without hitting API
    this.character = { id: "mock", name: "Test NPC", ... };
    this.isLoading = false;
    }
    forceError() { this.character = null; }
    }

4. View Binding: Ensure CharacterView.svelte accepts the VM via props: let { vm }: { vm: CharacterViewModel } = $props();

## Edge Cases

    Do not let CharacterDevViewModel leak into any files outside of the (dev) routes or tests. Production code must never import dev mocks.
