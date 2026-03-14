import { onSchedule } from '@snorreks/firestack';
import logger from '$logger';

export default onSchedule(
  async (context) => {
    logger.log('Starting daily cleanup task', { timestamp: context.timestamp });

    const summary = {
      completedAt: new Date().toISOString(),
      tasks: ['notifications', 'sessions', 'messages'],
      status: 'completed',
    };

    logger.log('Daily cleanup completed', summary);

    return summary;
  },
  {
    schedule: 'every day 00:00',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 540,
  },
);
