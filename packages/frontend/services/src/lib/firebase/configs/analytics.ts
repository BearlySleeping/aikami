import { getAnalytics } from 'firebase/analytics';
import app from './app.ts';

export {
  getAnalytics,
  logEvent,
  setUserId,
  setUserProperties,
} from 'firebase/analytics';

export const analytics = getAnalytics(app);
