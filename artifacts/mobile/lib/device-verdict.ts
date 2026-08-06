/**
 * Pure verdict computation for an attendance device.
 *
 * Mirrors the same precedence rule used by the web devices page:
 *   Online (real contact) > Stale (contact but too old) > No contact.
 *
 * Extracted so that the logic can be unit-tested without rendering
 * any React Native components.
 */

export type DeviceVerdictColors = {
  success: string;
  destructive: string;
  mutedForeground: string;
};

/** Minimal slice of AttendanceDevice that the verdict needs. */
export type DeviceVerdictInput = {
  isOnline?: boolean;
  isStale?: boolean;
  /** The stored "status" column — may lag behind real connectivity. */
  status?: string;
};

export type DeviceVerdict = {
  /** True when the device has had real contact within the online window. */
  online: boolean;
  /** True when contact exists but is older than the online window. */
  stale: boolean;
  /**
   * i18n key for the primary status badge.
   * One of: 'deviceOnline' | 'deviceStale' | 'deviceNoContact'
   */
  statusKey: 'deviceOnline' | 'deviceStale' | 'deviceNoContact';
  /** Colour for the primary status badge. */
  statusColor: string;
  /**
   * True when the stored status column says "online" but reality disagrees.
   * Drives the "marked online" secondary badge.
   */
  storedDisagrees: boolean;
  /** Colour for the last-contact timestamp text. */
  lastContactColor: string;
};

export function computeDeviceVerdict(
  item: DeviceVerdictInput,
  colors: DeviceVerdictColors,
): DeviceVerdict {
  const online = item.isOnline === true;
  const stale = item.isStale === true;

  const statusKey: DeviceVerdict['statusKey'] = online
    ? 'deviceOnline'
    : stale
      ? 'deviceStale'
      : 'deviceNoContact';

  const statusColor = online
    ? colors.success
    : stale
      ? colors.destructive
      : colors.mutedForeground;

  const storedDisagrees = item.status === 'online' && !online;

  const lastContactColor = stale ? colors.destructive : colors.mutedForeground;

  return { online, stale, statusKey, statusColor, storedDisagrees, lastContactColor };
}
