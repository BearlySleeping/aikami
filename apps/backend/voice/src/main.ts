// apps/backend/voice/src/main.ts
// Voice microservice — Bun WebSocket server wrapping the TTS engine from @aikami/backend-audio.

import { createTtsWebSocketHandler, type TtsWebSocketOptions } from '@aikami/backend-audio';
import { EMULATOR_PORTS, PRODUCTION_PORTS, STAGING_PORTS } from '@aikami/constants';
import type { ServerWebSocket } from 'bun';
import { logger } from '$logger';

/**
 * Map of connection → handler for lifecycle management.
 */
const sessions = new Map<ServerWebSocket<unknown>, ReturnType<typeof createTtsWebSocketHandler>>();

/**
 * Resolve the voice port for the current mode.
 */
const resolvePort = (): number => {
  const mode = process.env.AIKAMI_MODE;
  switch (mode) {
    case 'staging':
      return STAGING_PORTS.voice;
    case 'production':
      return PRODUCTION_PORTS.voice;
    default:
      return EMULATOR_PORTS.voice;
  }
};

const PORT = resolvePort();
const WS_OPTIONS: TtsWebSocketOptions = {
  concurrency: 2,
};

const server = Bun.serve({
  port: PORT,
  fetch(request, serverInstance) {
    const upgraded = serverInstance.upgrade(request);
    if (upgraded) {
      return;
    }
    return new Response('Voice API Status: OK', { status: 200 });
  },
  websocket: {
    open(ws) {
      logger.debug('voice:open', { port: PORT });
      const handler = createTtsWebSocketHandler(ws, WS_OPTIONS);
      sessions.set(ws, handler);
    },
    message(ws, message) {
      const handler = sessions.get(ws);
      if (handler) {
        handler.onMessage(message);
      }
    },
    close(ws) {
      logger.debug('voice:close', { port: PORT });
      const handler = sessions.get(ws);
      if (handler) {
        handler.onClose();
        sessions.delete(ws);
      }
    },
  },
});

logger.info('Voice microservice started', {
  port: PORT,
  mode: process.env.AIKAMI_MODE ?? 'emulator',
});
logger.info(`Voice microservice running on ws://localhost:${PORT}`);
logger.info(`HTTP health: http://localhost:${PORT}/`);
logger.info(`Mode: ${process.env.AIKAMI_MODE ?? 'emulator'}`);

// Keep process alive
process.on('SIGINT', () => {
  logger.info('Voice microservice shutting down');
  server.stop();
  process.exit(0);
});
