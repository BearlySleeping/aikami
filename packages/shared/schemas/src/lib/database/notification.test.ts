import { describe, expect, test } from 'bun:test';
import { Value } from 'typebox/value';
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
    const result = Value.Parse(NotificationGenericSchema, validData);
    expect(result.title).toBe('Test Title');
    expect(result.description).toBe(123);
  });

  test('should reject missing title', () => {
    const invalidData = { description: 123 };
    expect(() => Value.Parse(NotificationGenericSchema, invalidData)).toThrow();
  });
});

describe('NotificationTextSchema', () => {
  test('should parse valid notification text data', () => {
    const validData = {
      title: 'Test Title',
      subtitle: 'Test Subtitle',
    };
    const result = Value.Parse(NotificationTextSchema, validData);
    expect(result.title).toBe('Test Title');
    expect(result.subtitle).toBe('Test Subtitle');
  });

  test('should parse with optional subtitle undefined', () => {
    const validData = { title: 'Test Title' };
    const result = Value.Parse(NotificationTextSchema, validData);
    expect(result.title).toBe('Test Title');
    expect(result.subtitle).toBeUndefined();
  });
});

describe('NotificationTypeSchema', () => {
  test('should parse ctaClicked type', () => {
    expect(Value.Parse(NotificationTypeSchema, 'ctaClicked')).toBe('ctaClicked');
  });

  test('should parse videoViewed type', () => {
    expect(Value.Parse(NotificationTypeSchema, 'videoViewed')).toBe('videoViewed');
  });

  test('should reject invalid type', () => {
    expect(() => Value.Parse(NotificationTypeSchema, 'clicked')).toThrow();
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
    const result = Value.Parse(NotificationSchema, validNotificationData);
    expect(result.id).toBe('notif-123');
    expect(result.notificationType).toBe('ctaClicked');
    expect(result.uid).toBe('user-123');
  });

  test('should reject missing required fields', () => {
    const invalidData = {
      id: 'notif-123',
      notificationType: 'ctaClicked' as const,
    };
    expect(() => Value.Parse(NotificationSchema, invalidData)).toThrow();
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
    const result = Value.Parse(NotificationCreateSchema, validData);
    expect(result.notificationPayload.title).toBe('New Notification');
    expect(result.uid).toBe('user-123');
  });
});
