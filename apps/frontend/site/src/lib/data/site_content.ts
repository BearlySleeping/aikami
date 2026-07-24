// apps/frontend/site/src/lib/data/site_content.ts
// Aikami site-wide branding content.

export const site = {
  name: 'Aikami',
  shortName: 'Aikami',
  url: 'https://aikami.dev',
  description:
    'Aikami is an AI-powered 2D top-down RPG where every NPC is driven by generative AI — dynamic quests, evolving relationships, and an infinite living world.',
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
    'generative AI game',
    'AI-driven NPCs',
    'top-down RPG',
    '2D RPG',
    'dynamic storytelling',
  ],
};

export const siteContent = {
  site,
  nav: [
    { label: 'Features', href: '/#features' },
    { label: 'Demo', href: '/#demo' },
    { label: 'Roadmap', href: '/#roadmap' },
  ],
  footer: {
    copyright: `© ${new Date().getFullYear()} Aikami — AI-powered 2D RPG.`,
    trustLinks: [
      { label: 'GitHub', href: 'https://github.com/BearlySleeping/aikami' },
      { label: 'Issues', href: 'https://github.com/BearlySleeping/aikami/issues' },
    ],
  },
};
