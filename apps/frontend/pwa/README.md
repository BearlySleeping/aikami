# SvelteKit PWA

This is a SvelteKit Progressive Web App (PWA) that serves as the front-end for the AI RPG. The PWA is used to role-play with AI characters, and it is synced with your Firebase account so that when you play on Godot, it should work together.

## Internationalization (i18n)

This project uses Paraglide for internationalization. All user-facing text must be internationalized.

### Adding New Translations

1. Add translation keys to the message files in `messages/`:
   - `messages/en.json` - English translations
   - Add other language files as needed

2. Import and use in components:

   ```typescript
   import t from "$i18n";

   // In Svelte components
   <h1>{t.page_title()}</h1>
   <p>{t.greeting({ name: userName })}</p>
   ```

3. **NEVER** hardcode user-facing strings directly in components:
   - ❌ `<h1>My Page Title</h1>`
   - ✅ `<h1>{t.page_title()}</h1>`

4. **NEVER** use fallbacks for translations. All text must be defined in the message files.
   - ❌ `<h1>{t.page_title?.() || 'My Page Title'}</h1>`
   - ✅ `<h1>{t.page_title()}</h1>`

### Message File Format

```json
{
  "$schema": "https://inlang.com/schema/inlang-message-format",
  "key_name": "Translation text",
  "key_with_params": "Hello, {name}!"
}
```

## Roadmap

- **Character Selection:** Users will be able to select a character to chat with.
- **Chat History:** The chat history will be saved to Firestore and will be synced between the PWA and the Godot game.
- **Image Generation:** Users will be able to generate images of the AI characters.
- **User Profiles:** Users will have profiles where they can see their chat history and generated images.

## Project Structure

- **`src/`**: This directory contains the source code for the PWA.
  - **`app.d.ts`**: This file contains the type definitions for the `App` namespace.
  - **`lib/`**: This directory contains the core application logic, components, and utilities.
    - **`client/`**: This directory contains client-side services and repositories.
    - **`components/`**: This directory contains reusable Svelte components.
    - **`constants/`**: This directory contains application-wide constants.
    - **`paraglide/`**: This directory contains the internationalization configuration and generated files.
    - **`server/`**: This directory contains server-side utilities.
    - **`types/`**: This directory contains application-wide types.
    - **`views/`**: This directory contains the application's views and corresponding view models.
  - **`routes/`**: This directory contains the routes for the PWA.
  - **`static/`**: This directory contains static assets that are served by the PWA.
- **`static/`**: This directory contains static assets that are served by the PWA.
- **`tsconfig.json`**: This file contains the TypeScript configuration for the PWA.
- **`vite.config.ts`**: This file contains the Vite configuration for the PWA.

## Commands

To run the commands, `cd` into the `apps/frontend/pwa` directory and then run the command with `deno task <command>`.

- **`dev`**: Starts the development server.
- **`build`**: Builds the PWA for production.
- **`preview`**: Previews the production build of the PWA.
- **`prepare`**: Synchronizes the SvelteKit project.
- **`check:svelte`**: Type-checks the Svelte components.
- **`check:watch`**: Type-checks the Svelte components in watch mode.
- **`check:deno`**: Type-checks the Deno code.
- **`lint`**: Lints the Deno code.
- **`format`**: Formats the Deno code.
- **`check`**: Runs both `check:svelte` and `check:deno`.
