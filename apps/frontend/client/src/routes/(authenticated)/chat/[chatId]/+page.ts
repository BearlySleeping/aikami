// apps/frontend/client/src/routes/(authenticated)/chat/[chatId]/+page.ts

/**
 * Prevent prerender crawling for dynamic route param [chatId].
 *
 * The static adapter cannot enumerate chat IDs at build time, so we
 * explicitly return an empty entries list to disable prerendering for
 * this route. The page is rendered client-side only.
 */
export const entries = () => [];
