// packages/frontend/configs/src/lib/analytics.ts
import { type Analytics, getAnalytics } from 'firebase/analytics';
import app from './app.ts';

export {
  logEvent,
  setUserId,
  setUserProperties,
} from 'firebase/analytics';

const initializeAnalyticsInstance = (): Analytics => {
  return getAnalytics(app);
};

export const analytics = initializeAnalyticsInstance();
