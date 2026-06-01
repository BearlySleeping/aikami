import { onAuthCreate } from '@snorreks/firestack';
import { logger } from '$logger';

export default onAuthCreate(async (user, context) => {
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
