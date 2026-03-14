import { onAuthCreate } from '@snorreks/firestack';
import type { UserRecord } from 'firebase-functions/v1/auth';
import logger from '$logger';

export default onAuthCreate(async (user: UserRecord, context) => {
  logger.log('User created', {
    uid: user.uid,
    email: user.email,
    createdAt: context.timestamp,
  });

  return {
    success: true,
    uid: user.uid,
  };
});
