import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  NotificationCreateSchema,
  NotificationGenericSchema,
  NotificationSchema,
  NotificationTextSchema,
  NotificationTypeSchema,
} from './notification.ts';

describe('NotificationGenericSchema', () => {
  test('should parse valid notification generic data', () => {
    const validData = {
      title: 'Test Title',
      description: 123,
    };
    const result = NotificationGenericSchema.parse(validData);
    expect(result.title).toBe('Test Title');
    expect(result.description).toBe(123);
  });

  test('should reject missing title', () => {
    const invalidData = { description: 123 };
    expect(() => NotificationGenericSchema.parse(invalidData)).toThrow(z.ZodError);
  });
});

describe('NotificationTextSchema', () => {
  test('should parse valid notification text data', () => {
    const validData = {
      title: 'Test Title',
      subtitle: 'Test Subtitle',
    };
    const result = NotificationTextSchema.parse(validData);
    expect(result.title).toBe('Test Title');
    expect(result.subtitle).toBe('Test Subtitle');
  });

  test('should parse with optional subtitle undefined', () => {
    const validData = { title: 'Test Title' };
    const result = NotificationTextSchema.parse(validData);
    expect(result.title).toBe('Test Title');
    expect(result.subtitle).toBeUndefined();
  });
});

describe('NotificationTypeSchema', () => {
  test('should parse ctaClicked type', () => {
    expect(NotificationTypeSchema.parse('ctaClicked')).toBe('ctaClicked');
  });

  test('should parse videoViewed type', () => {
    expect(NotificationTypeSchema.parse('videoViewed')).toBe('videoViewed');
  });

  test('should reject invalid type', () => {
    expect(() => NotificationTypeSchema.parse('clicked')).toThrow(z.ZodError);
  });
});

describe('NotificationSchema', () => {
  const validNotificationData = {
    id: 'notif-123',
    notificationPayload: {
      title: 'New Message',
      description: 1,
    },
    notificationType: 'ctaClicked' as const,
    uid: 'user-123',
  };

  test('should parse valid notification data', () => {
    const result = NotificationSchema.parse(validNotificationData);
    expect(result.id).toBe('notif-123');
    expect(result.notificationType).toBe('ctaClicked');
    expect(result.uid).toBe('user-123');
  });

  test('should reject missing required fields', () => {
    const invalidData = {
      id: 'notif-123',
      notificationType: 'ctaClicked' as const,
    };
    expect(() => NotificationSchema.parse(invalidData)).toThrow(z.ZodError);
  });
});

describe('NotificationCreateSchema', () => {
  test('should parse valid notification create data', () => {
    const validData = {
      notificationPayload: {
        title: 'New Notification',
        description: 1,
      },
      notificationType: 'videoViewed' as const,
      uid: 'user-123',
    };
    const result = NotificationCreateSchema.parse(validData);
    expect(result.notificationPayload.title).toBe('New Notification');
    expect(result.uid).toBe('user-123');
  });
});
