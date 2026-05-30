import type { UserData } from '@aikami/types';
import { onCreated } from '@snorreks/firestack';
import { logger } from '$logger';

export default onCreated<UserData>(({ data }) => {
  logger.log(`User ${data.email} created`);
});
