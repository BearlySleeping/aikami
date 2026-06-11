export type AllAnalyticsEvents = {
  // Auth
  signUp: { method: string };
  login: { method: string };
  logout: undefined;
  clientAction: { action: string };

  invalidUrl: {
    url: string;
  };
  unknownError: {
    code: number;
    message?: string;
  };
};

export type AnalyticsEventName = keyof AllAnalyticsEvents;

export type AnalyticsEventParameters<T extends AnalyticsEventName = AnalyticsEventName> =
  AllAnalyticsEvents[T];

export type AnalyticsEvent<T extends AnalyticsEventName = AnalyticsEventName> = {
  name: T;
  parameters: AnalyticsEventParameters<T>;
};

export type LogAction = string;
