// apps/frontend/site/src/lib/data/site_content.ts
// Aikami site-wide branding content.

export const site = {
  name: 'Aikami',
  shortName: 'Aikami',
  url: 'https://bearlysleeping.com',
  description:
    'Your next adventure is yours to shape. Aikami is an open-source AI-powered 2D RPG in early development. Download for Windows, macOS, or Linux, or play in your browser.',
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
    { label: 'The game', href: '/#campaign' },
    { label: 'Current build', href: '/#current-build' },
    { label: 'Download', href: '/#download' },
    { label: 'What’s next', href: '/#roadmap' },
    { label: 'FAQ', href: '/faq' },
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
