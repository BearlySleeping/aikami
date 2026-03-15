import { onAuthDelete } from '@snorreks/firestack';
import type { UserRecord } from 'firebase-functions/v1/auth';
import { logger } from '$logger';

export default onAuthDelete(async (user: UserRecord, context) => {
  logger.log('User deleted', {
    uid: user.uid,
    email: user.email,
    deletedAt: context.timestamp,
  });

  return {
    success: true,
    uid: user.uid,
  };
});
