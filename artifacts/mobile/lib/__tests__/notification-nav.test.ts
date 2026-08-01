import { describe, expect, it } from 'vitest';
import {
  mobileRouteForNotification,
  severityColor,
  severityIcon,
} from '../notification-nav';

const palette = {
  success: '#22C55E',
  warning: '#F59E0B',
  destructive: '#EF4444',
  primary: '#F59E0B',
  mutedForeground: '#8CA0B8',
};

describe('mobileRouteForNotification', () => {
  it('maps the device_command_outcome web actionUrl to the mobile devices screen', () => {
    expect(
      mobileRouteForNotification({ actionUrl: '/attendance-devices' }),
    ).toBe('/devices');
  });

  it('maps deep device links and query strings too', () => {
    expect(
      mobileRouteForNotification({ actionUrl: '/attendance-devices/12' }),
    ).toBe('/devices');
    expect(
      mobileRouteForNotification({ actionUrl: '/attendance-devices?tab=commands' }),
    ).toBe('/devices');
  });

  it('maps lockout security alerts to the mobile users screen, keeping the highlight param', () => {
    expect(
      mobileRouteForNotification({ actionUrl: '/users?highlight=jdoe' }),
    ).toBe('/admin-users?highlight=jdoe');
    expect(
      mobileRouteForNotification({ actionUrl: '/users?highlight=j%40doe' }),
    ).toBe('/admin-users?highlight=j%40doe');
    expect(mobileRouteForNotification({ actionUrl: '/users' })).toBe('/admin-users');
  });

  it('does not treat similarly-prefixed paths as the users screen', () => {
    expect(mobileRouteForNotification({ actionUrl: '/users-archive' })).toBeNull();
  });

  it('returns null for unmapped, external or missing URLs', () => {
    expect(mobileRouteForNotification({ actionUrl: '/payroll' })).toBeNull();
    expect(
      mobileRouteForNotification({ actionUrl: 'https://example.com/x' }),
    ).toBeNull();
    expect(mobileRouteForNotification({ actionUrl: null })).toBeNull();
    expect(mobileRouteForNotification({})).toBeNull();
    // Prefix must match a full path segment.
    expect(
      mobileRouteForNotification({ actionUrl: '/attendance-devices-archive' }),
    ).toBeNull();
  });
});

describe('severityColor', () => {
  it('matches the outcome severities emitted by device command notifications', () => {
    // ACKNOWLEDGED → success, FAILED → error, EXPIRED → warning
    expect(severityColor('success', palette)).toBe(palette.success);
    expect(severityColor('error', palette)).toBe(palette.destructive);
    expect(severityColor('warning', palette)).toBe(palette.warning);
  });

  it('handles other severities and unknowns', () => {
    expect(severityColor('urgent', palette)).toBe(palette.destructive);
    expect(severityColor('info', palette)).toBe(palette.primary);
    expect(severityColor(undefined, palette)).toBe(palette.mutedForeground);
    expect(severityColor('nonsense', palette)).toBe(palette.mutedForeground);
  });
});

describe('severityIcon', () => {
  it('returns a distinct icon per outcome severity', () => {
    expect(severityIcon('success')).toBe('check-circle');
    expect(severityIcon('error')).toBe('alert-octagon');
    expect(severityIcon('warning')).toBe('alert-triangle');
    expect(severityIcon(null)).toBe('info');
  });
});
