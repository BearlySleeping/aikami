import type { DeviceData, DeviceType } from '@aikami/types';

export const isMobileDevice = (device?: DeviceData): boolean => {
  const desktopTypes: DeviceData['type'][] = ['desktop', 'tablet'];
  return !desktopTypes.includes(device?.type ?? 'desktop');
};

export const getDeviceType = (device?: DeviceData): DeviceType => {
  return device?.type ?? 'desktop';
};
