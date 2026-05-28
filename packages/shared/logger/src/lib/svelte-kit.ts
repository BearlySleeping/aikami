import { type BaseLoggerInterface, isValidLogLevel, type LogEntry } from './base.ts';
// @ts-expect-error - SvelteKit/Vite specific import syntax
import {logger as loggerClient} from './logger-browser.ts?client';
// @ts-expect-error - SvelteKit/Vite specific import syntax
import {logger as loggerServer} from './logger-svelte-kit-ssr.ts?server';

export { isValidLogLevel, type LogEntry };

// Export the server logger if we're on the server, otherwise export the client logger
export const logger = (import.meta.env.SSR ? loggerServer : loggerClient) as BaseLoggerInterface;
