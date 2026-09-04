// apps/frontend/client/src/lib/views/start/credits_data.ts
//
// Static credit data for the Start menu credits modal. Moved out of the
// ViewModel so the data can be rendered by a dedicated CreditsModal component.

export type CreditItem = {
  readonly name: string;
  readonly url: string;
  readonly description: string;
};

export type CreditGroup = {
  readonly heading: string;
  readonly items: readonly CreditItem[];
};

export const CREDIT_GROUPS: readonly CreditGroup[] = [
  {
    heading: 'Game Engine & ECS',
    items: [
      {
        name: 'PixiJS',
        url: 'https://pixijs.com/',
        description: '2D WebGL rendering engine powering the game world and visual effects.',
      },
      {
        name: 'bitECS',
        url: 'https://bitecs.dev/',
        description:
          'Entity-Component-System architecture driving all game logic and entity management.',
      },
    ],
  },
  {
    heading: 'Frontend Framework',
    items: [
      {
        name: 'Svelte',
        url: 'https://svelte.dev/',
        description:
          'UI framework for the menu system, HUD overlays, and reactive state management.',
      },
      {
        name: 'Tailwind CSS',
        url: 'https://tailwindcss.com/',
        description: 'Utility-first CSS framework for responsive styling across the entire app.',
      },
      {
        name: 'daisyUI',
        url: 'https://daisyui.com/',
        description: 'UI component library built on Tailwind CSS providing themed components.',
      },
    ],
  },
  {
    heading: 'Desktop Application',
    items: [
      {
        name: 'Tauri',
        url: 'https://v2.tauri.app/',
        description:
          'Desktop application framework wrapping the web frontend in a native Rust shell.',
      },
    ],
  },
  {
    heading: 'Assets',
    items: [
      {
        name: 'Universal LPC Spritesheet Character Generator',
        url: 'https://github.com/liberatedpixelcup/Universal-LPC-Spritesheet-Character-Generator',
        description:
          'Liberated Pixel Cup character sprites and asset generation for in-game characters.',
      },
    ],
  },
  {
    heading: 'Inspirations',
    items: [
      {
        name: 'Marinara Engine',
        url: 'https://github.com/Pasta-Devs/Marinara-Engine',
        description: 'HTML5 visual novel and RPG engine.',
      },
      {
        name: 'RisuAI',
        url: 'https://github.com/kwaroran/Risuai',
        description: 'AI roleplay and character chat frontend.',
      },
      {
        name: 'SillyTavern',
        url: 'https://github.com/sillytavern/SillyTavern',
        description: 'AI chat and roleplay platform.',
      },
    ],
  },
] as const;
