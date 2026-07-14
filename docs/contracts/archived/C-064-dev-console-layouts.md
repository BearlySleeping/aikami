<!-- completed: 2026-06-29 -->
# Contract: C-064 — Dev Console & View-Model Layout Integration

| Field | Value |
| ----- | ----- |
| Source | Architect |
| Target | Pi |
| Priority | High |
| Dependencies | C-063 |
| Status | completed |
| Version | 1.0 |

## Overview
As our core systems (Text, Voice, Image, AI) mature, we need dedicated developer playgrounds to test them in isolation. This contract establishes a centralized Dev Console with a navigation drawer for routing to specific feature tests. Concurrently, we will standardize our SvelteKit layouts to strictly adhere to our MVVM pattern, wrapping layouts in their respective Views and passing down the ViewModels.

## Design Reference
- Review existing MVVM component structures (e.g., passing `viewModel` as a prop to a `*View.svelte` component).
- Review the current `(dev)` routing group for where the new endpoints should live.

## Architecture Directives
- **Root Layout Standardization**: The absolute root layout should be stripped of UI logic and strictly render children.
- **Authenticated Layout Refactor**: The authenticated layout must instantiate the core App View Model and pass it to a core App View component that wraps the children.
- **Dev Console Layout**: A new layout specific to the `(dev)` group that implements a sidebar/navigation drawer to easily switch between test endpoints.
- **Test Endpoints**: Discrete routes for testing Image Generation, Voice Generation, Text Generation, and Character Creation.
- **Legacy Cleanup**: Complete removal of the outdated `lpc/component`, `lpc/component-lite`, and `lpc/demo` routes.

## State & Data Models
The Dev Console will require a simple ViewModel to manage the drawer state and active route. Conceptually:

    {
        isDrawerOpen: boolean;
        activeRoute: string;
        toggleDrawer(): void;
    }

## Acceptance Criteria

- **AC1: Root & Authenticated Layout MVVM Integration**
  - Given the SvelteKit routing tree
  - When a user hits an authenticated route
  - Then the root layout blindly renders children, and the authenticated layout instantiates the App View Model and wraps its slot in an App View component.
  - Test Hook: Inspect the DOM on an authenticated route to verify the App View wrapper is present.

- **AC2: Dev Console Navigation**
  - Given the developer environment
  - When a user navigates to a `/dev/*` route
  - Then a persistent navigation drawer is visible, allowing routing between different testing modules.
  - Test Hook: Verify clicking a drawer link updates the URL and renders the corresponding test view.

- **AC3: Test Endpoints Scaffolded**
  - Given the Dev Console
  - When viewing the navigation drawer
  - Then there are distinct, functional routes for `/dev/text`, `/dev/voice`, `/dev/image`, and `/dev/character`.
  - Test Hook: Assert a 200 OK status and successful render for each new dev route.

- **AC4: Legacy Cleanup**
  - Given the project directory
  - When searching for `lpc` testing routes
  - Then `lpc/component`, `lpc/component-lite`, and `lpc/demo` no longer exist in the codebase.
  - Test Hook: Assert the specific file paths for the legacy routes throw a 404/Not Found.

## Implementation Notes
1. Update `routes/+layout.svelte` to just render `{@render children()}`.
2. Update `routes/(authenticated)/+layout.svelte` to initialize `getAppViewModel` and wrap the children in `<AppView {viewModel}>`.
3. Build the `DevViewModel` and `DevView` components to handle the drawer UI.
4. Scaffold the new `/dev/*` sub-routes and hook them into the drawer navigation.
5. Delete the old `lpc` directories.

## Edge Cases & Gotchas
- **State Leakage**: Ensure the `AppViewModel` is initialized correctly using Svelte 5's `$props()` and Context API so state doesn't leak between server requests during SSR.
- **Tailwind Safelisting**: If the navigation drawer uses dynamic classes for its open/closed state, ensure they aren't purged by Tailwind.
