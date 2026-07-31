import { apiFetch } from '@/lib/api';

/** Row shape returned by GET /api/gateway/registrations (admin endpoint). */
export interface GatewayRegistration {
  id: number;
  name: string;
  nameAr?: string | null;
  status: string;
  /** Server-computed: ACTIVE registration with no heartbeat within the threshold. */
  silent: boolean;
  silenceThresholdMs: number;
  lastHeartbeatAt?: string | null;
  lastSeenAt?: string | null;
  adapterType?: string | null;
}

/**
 * Fetch gateway registrations as an OPTIONAL probe. The endpoint requires an
 * authenticated session even in demo mode, so a 401 (or any failure) resolves
 * to null — callers hide the section instead of redirecting to login.
 */
export async function fetchGatewayRegistrations(): Promise<GatewayRegistration[] | null> {
  try {
    const res = await apiFetch('/api/gateway/registrations', { credentials: 'include' }, { optionalAuth: true });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? data : null;
  } catch {
    return null; // network error — stay quiet
  }
}

/** Currently offline gateways: ACTIVE registrations the server flagged silent. */
export function selectOfflineGateways(gateways: GatewayRegistration[] | null): GatewayRegistration[] {
  return (gateways ?? []).filter((g) => g.status === 'ACTIVE' && g.silent);
}
