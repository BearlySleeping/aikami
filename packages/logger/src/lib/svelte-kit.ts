import { type BaseLoggerInterface, isValidLogLevel, type LogEntry } from './base.ts';
// @ts-expect-error - SvelteKit/Vite specific import syntax
import loggerClient from './logger-browser.ts?client';
// @ts-expect-error - SvelteKit/Vite specific import syntax
import loggerServer from './logger-svelte-kit-ssr.ts?server';

export { isValidLogLevel, type LogEntry };

// Export the server logger if we're on the server, otherwise export the client logger
export default (import.meta.env.SSR ? loggerServer : loggerClient) as BaseLoggerInterface;
