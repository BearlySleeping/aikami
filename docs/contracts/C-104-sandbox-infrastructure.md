# Contract C-104: Dev Sandbox Infrastructure & Tools Panel

## Context
Now that our `(dev)` routes use the Svelte 5 MVVM Override pattern (`FeatureDevViewModel extends FeatureViewModel`), we need a universal way to interact with these dev-only methods in the UI. We will create a floating "Dev Tools" panel that strictly lives in development. This panel will accept arbitrary actions and toggles from the active Sandbox, allowing us to force edge cases (errors, latency, mock injections) without modifying the production View components.

## Scope
- `apps/frontend/pwa/src/lib/components/dev/dev_tools_panel.svelte` (New)
- `apps/frontend/pwa/src/routes/(dev)/dev/character/+page.svelte` (Update)

## Acceptance Criteria
- [ ] **Create DevToolsPanel:** Create a `dev_tools_panel.svelte` component. It should be a fixed, floating overlay (e.g., bottom-right or top-right of the screen) with a distinct visual style (e.g., a "🛠️ DEV TOOLS" header) so it is never confused with game UI.
- [ ] **Define Props/State:** The panel should accept a configuration object (or use snippets/props) for `actions` (buttons) and `toggles` (checkboxes/switches). Example interface: `{ label: string, onClick: () => void }`.
- [ ] **Integrate with Character Sandbox:** In `routes/(dev)/dev/character/+page.svelte`, import and render `<DevToolsPanel />`.
- [ ] **Wire Methods:** Pass the `CharacterDevViewModel` dev methods (like `forceErrorState()` and `injectJunkData()`) into the `DevToolsPanel` as actions so they can be clicked from the overlay.
- [ ] **Collapsible (Bonus):** Make the panel collapsible so it doesn't block the UI when testing.

## Implementation Notes
1. Create a simple types file or define the interface in the component for the DevTools configuration.
2. The panel should be completely independent of the business logic. It just takes an array of `{ name, callback }` and renders buttons.
3. Only use this component inside `(dev)` routes.

## Edge Cases
- Ensure the z-index of the Dev Tools panel is high enough (`z-50` or similar in Tailwind) so it sits above all standard JRPG interfaces, modals, and dialogues.
