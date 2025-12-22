import logger from '$logger'

/**
 * Checks if the browser/device supports Progressive Web Apps (PWA).
 *
 * @returns true if PWA is supported, otherwise false.
 */
export const isPWASupported = (): boolean => {
  // Check if service workers are supported
  if ('serviceWorker' in navigator) {
    // Check if manifest is supported
    if ('Manifest' in globalThis) {
      return true
    }
  }
  return false
}

/**
 * Checks if the PWA is already installed on the user's device.
 *
 * @returns true if PWA is installed, otherwise false.
 */
export const isPWAInstalled = (): boolean => {
  // Check if beforeinstallprompt event is supported
  if ('BeforeInstallPromptEvent' in globalThis) {
    // Check if the PWA is installed
    return globalThis.matchMedia('(display-mode: standalone)').matches
  }
  return false
}

type BeforeInstallPromptEvent = {
  readonly platforms: string[]
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed'
    platform: string
  }>
  prompt(): Promise<void>
} & Event

/**
 * Installs the PWA on the user's device.
 *
 * @returns {Promise<boolean>} A promise that resolves to true if the
 *   installation is successful, otherwise false.
 */
export const installPWA = (): Promise<boolean> => {
  return new Promise<boolean>((resolve) => {
    // Check if beforeinstallprompt event is supported
    if ('BeforeInstallPromptEvent' in globalThis) {
      globalThis.addEventListener('beforeinstallprompt', async (e) => {
        const event = e as BeforeInstallPromptEvent
        // Prevent the default behavior, so the browser doesn't automatically prompt the user
        event.preventDefault()

        // Store the event for later use
        const deferredPrompt = event

        // You can show your custom install prompt here if you want
        // For example, display a button on the page and handle the click event
        // When the user clicks the button, call deferredPrompt.prompt()

        // Example: Show a button with id="installBtn" to prompt the user for installation

        await deferredPrompt.prompt()
        const choiceResult = await deferredPrompt.userChoice
        // ChoiceResult.outcome will be either 'accepted' or 'dismissed'
        if (choiceResult.outcome === 'accepted') {
          logger.log('PWA installation accepted by the user.')
          resolve(true)
        } else {
          logger.log('PWA installation dismissed by the user.')
          resolve(false)
        }
        // Cleanup the event listener
        globalThis.removeEventListener('beforeinstallprompt', () => {
          // noop
        })
      })
    } else {
      // If the beforeinstallprompt event is not supported, PWA installation is not possible
      resolve(false)
    }
  })
}
