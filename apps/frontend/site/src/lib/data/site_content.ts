// apps/frontend/site/src/lib/data/site_content.ts
// Aikami site-wide branding content.

export const site = {
  name: 'Aikami',
  shortName: 'Aikami',
  url: 'https://bearlysleeping.com',
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
    github: 'https://github.com/BearlySleeping/aikami',
  },
  themeColor: '#6d28d9',
};

export const discordInviteLink = 'https://discord.gg/XuuhWvSxHH';

/** Web client (SvelteKit + PixiJS) — the primary "play now" destination. */
export const webClientUrl = 'https://aikami.bearlysleeping.com';

/**
 * Content Pack Hub — where creators browse, upload, remix, and publish
 * content packs. Not yet live; hub.bearlysleeping.com is the intended
 * production domain.
 */
export const hubUrl = 'https://hub.bearlysleeping.com';

export const siteContent = {
  site,
  nav: [
    { label: 'Play', href: webClientUrl },
    { label: 'Content Packs', href: '/#content-packs' },
    { label: 'Tech', href: '/tech' },
    { label: 'Blog', href: '/blog' },
    { label: 'FAQ', href: '/faq' },
    { label: 'Community', href: '/#adventurers-guild' },
  ],
  footer: {
    copyright: `© ${new Date().getFullYear()} Aikami — AI-powered 2D RPG.`,
    trustLinks: [
      { label: 'GitHub', href: 'https://github.com/BearlySleeping/aikami' },
      { label: 'Issues', href: 'https://github.com/BearlySleeping/aikami/issues' },
      { label: 'Content Packs', href: hubUrl },
    ],
  },
};
