import type { DeviceData } from '@aikami/types';
import type { DeviceDetectorResult } from 'device-detector-js';
import { logger } from '$logger';

export const toDeviceData = (result: DeviceDetectorResult): DeviceData => {
  logger.debug('toDeviceData', result);
  const device: DeviceData = {};
  if (result.device?.type) {
    device.type = result.device.type;
  }
  if (result.os) {
    device.os = {
      name: result.os.name,
      version: result.os.version,
    };
    if (result.os.platform) {
      device.os.platform = result.os.platform;
    }
  }
  if (result.client) {
    device.browser = {
      name: result.client.name,
      type: result.client.type,
      version: result.client.version,
    };
  }
  if (result.bot) {
    device.isBot = true;
  }

  return device;
};
