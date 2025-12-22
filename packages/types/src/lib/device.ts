export type DeviceType =
  | 'desktop'
  | 'smartphone'
  | 'tablet'
  | 'television'
  | 'smart display'
  | 'camera'
  | 'car'
  | 'console'
  | 'portable media player'
  | 'phablet'
  | 'wearable'
  | 'smart speaker'
  | 'feature phone'
  | 'peripheral'

export type OperatingSystemName =
  | 'windows'
  | 'macos'
  | 'linux'
  | 'android'
  | string

export type OperatingSystemData = {
  name: OperatingSystemName
  version: string
  platform?: 'ARM' | 'x64' | 'x86' | 'MIPS' | 'SuperH'
}
export type BrowserData = {
  type: string
  name: string
  version: string
}

export type DeviceData = {
  type?: DeviceType
  os?: OperatingSystemData
  browser?: BrowserData
  isBot?: boolean
}
