/**
 * Notification → mobile navigation mapping.
 *
 * In-app notifications carry a web `actionUrl` (e.g. "/attendance-devices"
 * on device_command_outcome rows). The mobile app has its own routes, so
 * web URLs are translated here; anything without a known mobile equivalent
 * returns null and the tap simply marks the notification read.
 */

export interface NotificationLike {
  actionUrl?: string | null;
}

/** Web actionUrl path → mobile expo-router route. */
const WEB_TO_MOBILE_ROUTES: Array<{
  webPath: string;
  mobileRoute: string;
  /** Carry the web URL's query string over to the mobile route (e.g. the
   * `highlight` param on security-lockout alerts). */
  preserveQuery?: boolean;
}> = [
  // device_command_outcome (restart acknowledged/failed/expired)
  { webPath: '/attendance-devices', mobileRoute: '/devices' },
  // security_alert lockouts deep-link to /users?highlight=<username>; the
  // mobile users screen honors the same highlight param.
  { webPath: '/users', mobileRoute: '/admin-users', preserveQuery: true },
];

/**
 * Returns the mobile route for a notification's actionUrl, or null when the
 * URL has no mobile equivalent (external links and unmapped web pages).
 */
export function mobileRouteForNotification(
  n: NotificationLike,
): string | null {
  const url = n.actionUrl;
  if (!url || !url.startsWith('/')) return null;
  const path = url.split(/[?#]/)[0];
  for (const { webPath, mobileRoute, preserveQuery } of WEB_TO_MOBILE_ROUTES) {
    if (path === webPath || path.startsWith(`${webPath}/`)) {
      if (preserveQuery) {
        const queryMatch = url.match(/\?[^#]*/);
        return queryMatch ? `${mobileRoute}${queryMatch[0]}` : mobileRoute;
      }
      return mobileRoute;
    }
  }
  return null;
}

export interface SeverityPalette {
  success: string;
  warning: string;
  destructive: string;
  primary: string;
  mutedForeground: string;
}

/**
 * Color for a notification severity. device_command_outcome uses
 * success (acknowledged), error (failed) and warning (expired).
 */
export function severityColor(
  severity: string | null | undefined,
  colors: SeverityPalette,
): string {
  switch (severity) {
    case 'success':
      return colors.success;
    case 'warning':
      return colors.warning;
    case 'error':
    case 'urgent':
      return colors.destructive;
    case 'info':
      return colors.primary;
    default:
      return colors.mutedForeground;
  }
}

/** Feather icon name for a notification severity. */
export function severityIcon(severity: string | null | undefined): string {
  switch (severity) {
    case 'success':
      return 'check-circle';
    case 'warning':
      return 'alert-triangle';
    case 'error':
    case 'urgent':
      return 'alert-octagon';
    default:
      return 'info';
  }
}
