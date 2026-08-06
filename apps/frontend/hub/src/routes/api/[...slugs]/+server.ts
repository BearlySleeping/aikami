// src/routes/api/[...slugs]/+server.ts
//
// Mounts the Elysia internal API service. Every /api/* request that does
// not match a dedicated SvelteKit route is handled by the Elysia app
// (see src/lib/server/api/index.ts).
import { app } from '$lib/server/api';

type RequestHandler = (v: { request: Request }) => Response | Promise<Response>;

export const fallback: RequestHandler = ({ request }) => app.handle(request);
