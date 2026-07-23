export {};

declare global {
  interface ImportMetaEnv {
    readonly PUBLIC_APP_ID?: string;
    readonly PUBLIC_MODE?: string;
    readonly PUBLIC_LOG_LEVEL?: string;
    readonly PUBLIC_FIREBASE_API_KEY?: string;
    readonly PUBLIC_FIREBASE_AUTH_DOMAIN?: string;
    readonly PUBLIC_FIREBASE_STORAGE_BUCKET?: string;
    readonly PUBLIC_FIREBASE_MESSAGING_SENDER_ID?: string;
    readonly PUBLIC_FIREBASE_APP_ID?: string;
    readonly PUBLIC_FIREBASE_MEASUREMENT_ID?: string;
    readonly PUBLIC_DISABLE_APP_CHECK?: string;
    readonly PUBLIC_RECAPTCHA_SITE_KEY?: string;
    readonly PUBLIC_ENABLE_FIRESTORE_OFFLINE_PERSISTENCE?: string;
    readonly PUBLIC_GMAIL_CLIENT_ID?: string;
    readonly PUBLIC_VAPID_KEY?: string;
    readonly PUBLIC_PARSE_LEVEL?: string;
    readonly PUBLIC_SITE_URL?: string;
    readonly PUBLIC_APP_CHECK_DEBUG_TOKEN?: string;
    readonly PUBLIC_LOG_PERSIST_LEVEL?: string;
    readonly DEV?: boolean;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}
