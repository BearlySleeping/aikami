export type AllAnalyticsEvents = {
  // Auth
  sign_up: { method: string };
  login: { method: string };
  logout: undefined;
  pwa_action: { action: string };
};

export type AnalyticsEventName = keyof AllAnalyticsEvents;

export type AnalyticsEventParameters<T extends AnalyticsEventName = AnalyticsEventName> =
  AllAnalyticsEvents[T];

export type AnalyticsEvent<T extends AnalyticsEventName = AnalyticsEventName> = {
  name: T;
  parameters: AnalyticsEventParameters<T>;
};

export type LogAction = string;
