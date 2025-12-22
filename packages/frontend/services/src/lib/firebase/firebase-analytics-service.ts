import { BaseClass, type BaseClassInterface } from '@aikami/utils'

type Analytics = typeof import('./configs/analytics.ts')

export type FirebaseAnalyticServiceInterface = {
  setUserId(uid: string): Promise<void>
  setUserProperties(userProperties: Record<string, unknown>): Promise<void>
  logEvent(
    eventName: string,
    eventParameters?: Record<string, unknown>,
  ): Promise<void>
} & BaseClassInterface

class FirebaseAnalyticService extends BaseClass implements FirebaseAnalyticServiceInterface {
  private static _analytic?: Analytics

  constructor() {
    super({
      className: 'AnalyticService',
    })
  }

  async setUserId(uid: string): Promise<void> {
    const response = await this._getAnalytics()
    if (!response) {
      return
    }
    const { analytics, setUserId } = response
    setUserId(analytics, uid)
  }

  async setUserProperties(
    userProperties: Record<string, unknown>,
  ): Promise<void> {
    const response = await this._getAnalytics()
    if (!response) {
      return
    }
    const { analytics, setUserProperties } = response

    setUserProperties(analytics, userProperties)
  }
  async logEvent(
    eventName: string,
    eventParameters?: Record<string, unknown>,
  ): Promise<void> {
    const response = await this._getAnalytics()
    if (!response) {
      return
    }
    const { analytics, logEvent } = response

    logEvent(analytics, eventName, eventParameters)
  }

  private async _getAnalytics(): Promise<Analytics | undefined> {
    if (FirebaseAnalyticService._analytic) {
      return FirebaseAnalyticService._analytic
    }

    if (
      import.meta.env.SSR ||
      typeof window === 'undefined' ||
      import.meta.env['STORYBOOK']
    ) {
      throw new Error(`${this._className} is not available on SSR`)
    }
    try {
      FirebaseAnalyticService._analytic = await import('./configs/analytics.ts')
      return FirebaseAnalyticService._analytic
    } catch (error) {
      this.error('_analytics', error)
      return
    }
  }
}

export const firebaseAnalyticService = new FirebaseAnalyticService()
