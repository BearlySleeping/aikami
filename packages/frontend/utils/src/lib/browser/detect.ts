// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck: Legacy browser detection logic with various global checks.
import { type Browser as DetectBrowser, detect, type OperatingSystem } from 'detect-browser'
import { isbot } from 'isbot'

export type Browser = DetectBrowser | 'bot' | 'react-native' | 'node' | 'brave'

/**
 * Detect if a user agent is a bot, crawler or spider
 *
 * @param userAgent A user agent string. Non strings will be cast to string
 *   before the check
 * @returns true if the user agent is a bot, crawler or spider
 */
export const isBot = (userAgent: string): boolean => {
  return isbot(userAgent)
}

/**
 * Browsers that can install the extension.
 *
 * Note that browsers like brave and other chromium browsers that can use chrome
 * store will return chrome.
 */
type ExtensionStore = 'chrome-web-store' | 'edge-add-ons' | 'firefox-add-ons'

export const getBrowser = (): Browser | undefined => {
  if (isBrave()) {
    return 'brave'
  }
  const browser = detect()
  return browser?.name
}
/**
 * Gets the extension store, returns undefined if the browser does not have a
 * supported extension support.
 *
 * @param browser The current browser, will be [getBrowser()] if undefined.
 * @returns The browser's extension store to install the extension or undefined.
 */
export const getExtensionStore = (
  browser = getBrowser(),
): ExtensionStore | undefined => {
  switch (browser) {
    case 'chrome':
    case 'brave':
      return 'chrome-web-store'
    case 'firefox':
      return 'firefox-add-ons'
    case 'edge':
      return 'edge-add-ons'
    default:
      return undefined
  }
}

const isBrave = (): boolean => {
  if (typeof window === 'undefined') {
    return false
  }

  return !!(navigator as Navigator & { brave: unknown }).brave
}

export const getOS = (): OperatingSystem | NodeJS.Platform | undefined => {
  const browser = detect()
  return browser?.os ?? undefined
}

export const isIOS = (): boolean => {
  return getOS() === 'iOS'
}

export const isMobileDevice = (): boolean => {
  if (typeof window === 'undefined') {
    return false
  }

  return /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(
    navigator.userAgent,
  )
}

export const isTabletDevice = (): boolean => {
  if (typeof window === 'undefined') {
    return false
  }

  const ua = navigator.userAgent.toLowerCase()
  return (
    isIPad() ||
    /(ipad|tablet|(android(?!.*mobile))|(windows(?!.*phone)(.*touch))|kindle|playbook|silk|(puffin(?!.*(IP|AP|WP))))/
      .test(
        ua,
      )
  )
}

export const isMobileOrTablet = (): boolean => {
  return isMobileDevice() || isTabletDevice()
}

export const isIPad = (): boolean => {
  if (typeof window === 'undefined') {
    return false
  }
  const ua = navigator.userAgent.toLowerCase()
  return (
    ua.includes('ipad') ||
    (ua.includes('macintosh') && 'ontouchend' in document)
  )
}

/*
 * Gets browser information based on native javascript built in functionality
 * https://medium.com/creative-technology-concepts-code/detect-device-browser-and-version-using-javascript-8b511906745
 * Usage: const bd = browserDetector(navigator, window).init();
 * bd.os.{name|version}, bd.browser.{name|version}
 */
export function browserDetector(
  navigator: Navigator,
  window: Window & { opera?: unknown },
): {
  dataBrowser: {
    name: string
    value: string
    version: string
  }[]
  dataOS: {
    name: string
    value: string
    version: string
  }[]
  header: unknown[]
  init: () => {
    browser: {
      name: string
      version: number
    }
    os: {
      name: string
      version: number
    }
  }
  matchItem: (
    string: string,
    data: {
      name: string
      value: string
      version: string
    }[],
  ) => {
    name: string
    version: number
  }
  options: never[]
} {
  const module = {
    dataBrowser: [
      { name: 'Chrome', value: 'Chrome', version: 'Chrome' },
      { name: 'Firefox', value: 'Firefox', version: 'Firefox' },
      { name: 'Safari', value: 'Safari', version: 'Version' },
      { name: 'Internet Explorer', value: 'MSIE', version: 'MSIE' },
      { name: 'Opera', value: 'Opera', version: 'Opera' },
      { name: 'BlackBerry', value: 'CLDC', version: 'CLDC' },
      { name: 'Mozilla', value: 'Mozilla', version: 'Mozilla' },
    ],
    dataOS: [
      { name: 'Windows Phone', value: 'Windows Phone', version: 'OS' },
      { name: 'Windows', value: 'Win', version: 'NT' },
      { name: 'iPhone', value: 'iPhone', version: 'OS' },
      { name: 'iPad', value: 'iPad', version: 'OS' },
      { name: 'Kindle', value: 'Silk', version: 'Silk' },
      { name: 'Android', value: 'Android', version: 'Android' },
      { name: 'PlayBook', value: 'PlayBook', version: 'OS' },
      { name: 'BlackBerry', value: 'BlackBerry', version: '/' },
      { name: 'Macintosh', value: 'Mac', version: 'OS X' },
      { name: 'Linux', value: 'Linux', version: 'rv' },
      { name: 'Palm', value: 'Palm', version: 'PalmOS' },
    ],
    header: [
      navigator.platform,
      navigator.userAgent,
      navigator.appVersion,
      navigator.vendor,
      window.opera,
    ],
    init() {
      const agent = this.header.join(' ')
      const os = this.matchItem(agent, this.dataOS)
      const browser = this.matchItem(agent, this.dataBrowser)
      return { browser, os }
    },
    matchItem(
      string: string,
      data: { name: string; value: string; version: string }[],
    ) {
      let index = 0
      let index_ = 0
      let regex
      let regexV
      let match
      let matches
      let version

      for (index = 0; index < data.length; index += 1) {
        regex = new RegExp(data[index].value, 'i')
        match = regex.test(string)
        if (match) {
          regexV = new RegExp(
            data[index].version + '[- /:;]([\\d._]+)',
            'i',
          )
          matches = string.match(regexV)
          version = ''
          if (matches?.[1]) {
            matches = matches[1]
          }
          if (typeof matches === 'string') {
            matches = matches.split(/[._]+/)
            for (index_ = 0; index_ < matches.length; index_ += 1) {
              version += index_ === 0
                // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
                ? matches[index_] + '.'
                : matches[index_]
            }
          } else {
            version = '0'
          }
          return {
            name: data[index].name,
            version: Number.parseFloat(version),
          }
        }
      }
      return { name: 'unknown', version: 0 }
    },
    options: [],
  }
  return module
}
