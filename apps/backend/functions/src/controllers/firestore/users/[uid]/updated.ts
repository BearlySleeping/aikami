import type { UserData } from '@aikami/types';
import { onUpdated } from '@snorreks/firestack';
import { logger } from '$logger';

export default onUpdated<UserData>(({ data }) => {
  const beforeUser = data.before;
  const afterUser = data.after;
  logger.log(`User ${beforeUser.email} updated to ${afterUser.email}`);
});
