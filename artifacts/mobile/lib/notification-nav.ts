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

type SimpleRouteEntry = {
  webPath: string;
  mobileRoute: string;
  /** Carry the web URL's query string over to the mobile route (e.g. the
   * `highlight` param on security-lockout alerts). */
  preserveQuery?: boolean;
  transform?: never;
};

type TransformRouteEntry = {
  webPath: string;
  mobileRoute?: never;
  preserveQuery?: never;
  /** Called with the full actionUrl when the path matches; returns the mobile route. */
  transform: (url: string) => string;
};

type RouteEntry = SimpleRouteEntry | TransformRouteEntry;

/** Web actionUrl path → mobile expo-router route. */
const WEB_TO_MOBILE_ROUTES: RouteEntry[] = [
  // device_command_outcome (restart acknowledged/failed/expired)
  { webPath: '/attendance-devices', mobileRoute: '/devices' },
  // attendance-gateway credential / silence alerts
  { webPath: '/attendance-gateway', mobileRoute: '/devices' },
  // security_alert lockouts deep-link to /users?highlight=<username>; the
  // mobile users screen honors the same highlight param.
  { webPath: '/users', mobileRoute: '/admin-users', preserveQuery: true },
  // leave / approval notifications (web: /approvals, mobile: approvals tab)
  { webPath: '/approvals', mobileRoute: '/approvals' },
  // payroll notifications:
  //   /payroll?period=<id>  → /payroll-period-ot/<id>  (no-show / OT alerts)
  //   /payroll              → /approvals               (generic payroll events)
  {
    webPath: '/payroll',
    transform: (url: string) => {
      const qs = url.split('?')[1] ?? '';
      const periodId = new URLSearchParams(qs).get('period');
      return periodId ? `/payroll-period-ot/${periodId}` : '/approvals';
    },
  },
  // privileged-session sweep alerts
  { webPath: '/privileged-sessions', mobileRoute: '/privileged-sessions' },
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
  for (const entry of WEB_TO_MOBILE_ROUTES) {
    if (path === entry.webPath || path.startsWith(`${entry.webPath}/`)) {
      if (entry.transform) {
        return entry.transform(url);
      }
      if (entry.preserveQuery) {
        const queryMatch = url.match(/\?[^#]*/);
        return queryMatch ? `${entry.mobileRoute}${queryMatch[0]}` : entry.mobileRoute;
      }
      return entry.mobileRoute;
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
