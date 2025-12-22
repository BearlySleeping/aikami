import type { SupportedLocale } from '@aikami/types'
import {
  type BaseFrontendClassOptions,
  type CorePreferenceProviderInterface,
  CorePreferenceProviderService,
} from '@aikami/frontend/services'

export type FCMCachedData = {
  disabled?: boolean
  locale?: SupportedLocale
  uid?: string
}

type PreferenceData = {
  fcm: FCMCachedData
}

export type PreferenceServiceOptions = BaseFrontendClassOptions

export type PreferenceServiceInterface = CorePreferenceProviderInterface<PreferenceData> & {
  /**
   * The cached FCM data.
   */
  readonly fcmCachedData: FCMCachedData | undefined

  /**
   * Whether the service has been initialized.
   */
  readonly initialized: boolean

  /**
   * Clears all preferences.
   */
  clear(): Promise<void>

  /**
   * Ensures that the service has been initialized.
   */
  ensureInitialized(): Promise<void>

  /**
   * Initializes the service.
   */
  initialize(): Promise<void>

  /**
   * Sets the FCM data.
   * @param options The FCM data to set.
   */
  setFCMData(options?: FCMCachedData): Promise<void>
}

export class PreferenceService extends CorePreferenceProviderService<PreferenceData>
  implements PreferenceServiceInterface {
  fcmCachedData = $state<FCMCachedData | undefined>()
  initialized = $state(false)

  constructor(options: PreferenceServiceOptions) {
    super(options)
  }

  override async clear(): Promise<void> {
    try {
      await super.clear()
    } catch (error) {
      this.error('clear', error)
    }
  }

  async ensureInitialized(): Promise<void> {
    while (!this.initialized) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
  async initialize(): Promise<void> {
    try {
      this.log('initialize', {
        initialized: this.initialized,
      })

      if (this.initialized) {
        return
      }

      this._handleEntries(await this.entries())
    } catch (error) {
      this.error('initialize', error)
    }
    this.initialized = true
  }
  async setFCMData(options?: FCMCachedData): Promise<void> {
    this.log('setFCMData', options)

    this.fcmCachedData = options
    await (options ? this.set('fcm', options) : this.delete('fcm'))
  }
  /**
   * Handles the entries from the preference store.
   * @param entries The entries to handle.
   */
  protected _handleEntries(entries: ['fcm', FCMCachedData][]): void {
    for (const [key, value] of entries) {
      switch (key) {
        case 'fcm':
          this.fcmCachedData = value as FCMCachedData
          break
      }
    }
    this.initialized = true
  }
}

export const preferenceService: PreferenceServiceInterface = new PreferenceService({
  className: 'PreferenceService',
})
