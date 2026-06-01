// Define ParseLevel directly to avoid import issues in type declaration context
type ParseLevel = 'off' | 'safe' | 'on';

export {}; // Ensures this is treated as a module

declare global {
  interface ImportMetaEnv {
    readonly PUBLIC_FLAVOR?: string;
    readonly STORYBOOK?: boolean;
    readonly PUBLIC_PARSE_LEVEL?: ParseLevel;
    readonly PUBLIC_VAPID_KEY?: string;
    // biome-ignore lint/style/useNamingConvention: SvelteKit env var name
    SSR: boolean;
    // Add other environment variables used by your application
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
    // Deno's built-in libs should provide other import.meta properties like 'url' and 'main'.
    // If they are not picked up, you might need to add them here or adjust tsconfig/deno.json's lib settings.
  }
}
