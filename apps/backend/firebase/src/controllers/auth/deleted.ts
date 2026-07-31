import { onAuthDelete } from '@snorreks/firestack';
import { logger } from '$logger';

export default onAuthDelete(
  async (user, context) => {
    logger.log('User deleted', {
      uid: user.uid,
      email: user.email,
      deletedAt: context.timestamp,
    });

    return {
      success: true,
      uid: user.uid,
    };
  },
  {
    // v1 functions is not supported in europe-west4
    region: 'europe-west1',
  },
);
