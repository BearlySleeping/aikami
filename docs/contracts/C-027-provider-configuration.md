// docs/contracts/C-027-provider-configuration.md
# Contract: C-027 Provider Configuration & Secrets Engine

## Design References
- ST/RisuAI API connections and Instruct formatting.
- Aikami AI Core: `packages/frontend/api-core/src/ai/`
- Aikami PWA Settings: `apps/frontend/pwa/src/lib/views/settings/`
- Svelte 5 runes for deep reactivity.

## Detailed Changes
1. **State Management**: Create `apps/frontend/pwa/src/lib/client/services/settings/ai_settings.svelte.ts`. This singleton must manage `$state` for:
   - Active providers (Text, Image, TTS).
   - Generation parameters (Temperature, Top P, Repetition Penalty, Max Tokens, Context Size).
   - Advanced overrides (e.g., `thinking_level` for DeepSeek/Claude).
   - Instruct template selection (ChatML, Alpaca, Vicuna, etc.).
2. **Secrets Vault**: Create `apps/frontend/pwa/src/lib/client/utils/crypto_vault.ts`. Implement an AES-GCM encryption wrapper using the Web Crypto API. API keys must be encrypted at rest in `localStorage` or `IndexedDB`. If the user is authenticated via Firebase, sync the encrypted vault to a secure `user_secrets` subcollection in Firestore.
3. **Instruct Formatters**: Create `packages/shared/parser/src/lib/instruct.ts`. Implement pure functions that take the standard Aikami `Message[]` array and output formatted strings strictly adhering to selected templates (e.g., injecting `<|im_start|>` and `<|im_end|>` for ChatML).
4. **UI Integration**: 
   - Build `apps/frontend/pwa/src/lib/views/settings/tabs/ai_providers_tab.svelte`.
   - Build `apps/frontend/pwa/src/lib/views/settings/tabs/instruct_templates_tab.svelte`.
   - Wire these components into the existing `settings_view.svelte`.

## Acceptance Criteria
- **Given** the user navigates to the AI Providers settings tab.
- **When** the user inputs an OpenRouter API key and selects "DeepSeek V3".
- **Then** the `crypto_vault` encrypts the key before saving it locally (and remotely if logged in).
- **When** the user sends a chat message.
- **Then** the `api-core` dynamically decrypts the key in memory and injects it into the outbound HTTP headers.
- **Given** the user selects the "ChatML" instruct template.
- **When** the prompt is compiled for the LLM.
- **Then** `packages/shared/parser/src/lib/instruct.ts` correctly wraps system, user, and assistant messages in ChatML syntax before dispatching to the API.

## Watch Points
- **Security**: NEVER log API keys to the console or Sentry. Mask them in the UI inputs (`type="password"`).
- **Firestore Rules**: Ensure `firestore.rules` strictly limits reads/writes on the `user_secrets` collection to `request.auth.uid == resource.id`.
- **Reactivity**: Ensure the `ai_settings` parameters bind correctly to the UI sliders using Svelte 5 two-way bindings (`bind:value`).
