# Contract C-105: Chat System MVVM & Dev Sandbox

## Context
We are applying our proven Svelte 5 MVVM and Sandbox architecture to the most complex UI in the game: the NPC Chat System. We need to isolate the chat UI from the heavy AI microservices so we can rapidly develop features like typing indicators, scrolling, and error states using simulated data.

## Scope
- `apps/frontend/pwa/src/lib/views/chat/chat_view_model.svelte.ts` (Ensure it is a class)
- `apps/frontend/pwa/src/lib/views/chat/chat_view.svelte` (Ensure it is dumb/prop-driven)
- `apps/frontend/pwa/src/routes/(dev)/dev/chat/+page.svelte` (New sandbox route)

## Acceptance Criteria
- [ ] **ViewModel Refactor:** Ensure `chat_view_model.svelte.ts` exports a standard class (`ChatViewModel`) using Svelte 5 `$state` runes. All UI logic (sending messages, tracking typing state) must live here.
- [ ] **Dev Override:** Create `chat_dev_view_model.svelte.ts`. This class MUST `extend ChatViewModel`.
- [ ] **Sandbox Route:** Create the `(dev)/dev/chat/+page.svelte` route. It must instantiate `ChatDevViewModel`, pass it to `<ChatView />`, and mount the `<DevToolsPanel />`.
- [ ] **Dev Tools Wiring:** Implement at least 3 dev methods in `ChatDevViewModel` and wire them to the DevToolsPanel:
  - Action: `simulateBotReply()` (Injects a mock response with a fake delay).
  - Action: `triggerNetworkError()` (Forces an error state in the chat).
  - Toggle: `simulateLatency` (If true, adds artificial delay to sending messages).

## Implementation Notes
1. Review the existing `chat_view_model.svelte.ts`. If it is already a class, great. If not, wrap the existing logic into a class.
2. The `simulateBotReply()` method should ideally mock the streaming effect if you have a typing indicator or chunked text feature. 
3. Ensure the `<DevToolsPanel>` is positioned so it doesn't block the chat input box.

## Edge Cases
- Do not let `ChatDevViewModel` leak into production `(authenticated)/chat` routes.
- Ensure the auto-scrolling logic (which usually relies on DOM refs in the View) still works when the DevViewModel injects messages.
