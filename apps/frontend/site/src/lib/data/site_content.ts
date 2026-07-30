// apps/frontend/site/src/lib/data/site_content.ts
// Aikami site-wide branding content.

export const site = {
  name: 'Aikami',
  shortName: 'Aikami',
  url: 'https://aikami.dev',
  description:
    'Aikami is a free, open-source, self-hosted AI-native 2D RPG engine. Every NPC thinks, remembers, and adapts — driven by local AI models you control. BYOK, run offline, or deploy anywhere.',
  author: 'Aikami Team',
  email: 'hello@aikami.dev',
  telephone: '',
  address: {
    street: '',
    locality: '',
    country: '',
  },
  social: {
    twitter: 'https://twitter.com/aikami',
    github: 'https://github.com/BearlySleeping/aikami',
  },
  themeColor: '#6d28d9',
  keywords: [
    'Aikami',
    'AI RPG',
    'open-source RPG engine',
    'self-hosted AI game',
    'AI-driven NPCs',
    'local AI RPG',
    'BYOK game engine',
    '2D RPG',
    'dynamic storytelling',
    'Ollama RPG',
  ],
};

export const siteContent = {
  site,
  nav: [
    { label: 'NPC Engine', href: '/#npc-generator' },
    { label: 'RPG Mechanics', href: '/#rpg-mechanics' },
    { label: 'Features', href: '/#cognition' },
    { label: 'Self-Host', href: '/#your-realm' },
    { label: 'Guild', href: '/#adventurers-guild' },
  ],
  footer: {
    copyright: `© ${new Date().getFullYear()} Aikami — AI-powered 2D RPG.`,
    trustLinks: [
      { label: 'GitHub', href: 'https://github.com/BearlySleeping/aikami' },
      { label: 'Issues', href: 'https://github.com/BearlySleeping/aikami/issues' },
    ],
  },
};
