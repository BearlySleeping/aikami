import type { UserData } from '@aikami/types';
import { onDeleted } from '@snorreks/firestack';
import logger from '$logger';

export default onDeleted<UserData>(({ data }) => {
  logger.log(`User ${data.email} deleted`);
});
