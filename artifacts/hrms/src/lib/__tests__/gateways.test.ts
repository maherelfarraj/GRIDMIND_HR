/**
 * Guards the devices-page offline-gateway banner contract:
 *  - a 401 from the optional /api/gateway/registrations probe must NOT
 *    trigger the global session-expired redirect — the page stays put and
 *    the banner is simply hidden (fetch resolves to null);
 *  - an ACTIVE registration flagged `silent` by the server must surface in
 *    the offline selection that renders the banner.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchGatewayRegistrations, selectOfflineGateways, type GatewayRegistration } from '../gateways';

const fakeWindow = { location: { pathname: '/devices', href: '/devices' } };
const removeItem = vi.fn();

beforeEach(() => {
  fakeWindow.location.href = '/devices';
  removeItem.mockClear();
  vi.stubGlobal('window', fakeWindow);
  vi.stubGlobal('localStorage', { removeItem });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchGatewayRegistrations', () => {
  it('returns null on 401 without redirecting to login or clearing the session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Authentication required' }), { status: 401 })));
    const result = await fetchGatewayRegistrations();
    expect(result).toBeNull();
    expect(fakeWindow.location.href).toBe('/devices'); // no redirect — page stays in place
    expect(removeItem).not.toHaveBeenCalled(); // session untouched
  });

  it('returns the registration list on success', async () => {
    const rows = [{ id: 1, name: 'HQ Gateway', status: 'ACTIVE', silent: false, silenceThresholdMs: 600000 }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(rows), { status: 200 })));
    const result = await fetchGatewayRegistrations();
    expect(result).toEqual(rows);
  });

  it('returns null on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')));
    await expect(fetchGatewayRegistrations()).resolves.toBeNull();
  });

  it('returns null on non-array payloads', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'oops' }), { status: 200 })));
    await expect(fetchGatewayRegistrations()).resolves.toBeNull();
  });
});

describe('selectOfflineGateways (banner visibility)', () => {
  const gw = (over: Partial<GatewayRegistration>): GatewayRegistration => ({
    id: 1,
    name: 'GW',
    status: 'ACTIVE',
    silent: false,
    silenceThresholdMs: 600000,
    ...over,
  });

  it('shows an ACTIVE registration the server flagged silent', () => {
    const offline = selectOfflineGateways([gw({ id: 7, silent: true, lastHeartbeatAt: '2026-07-30T10:00:00Z' })]);
    expect(offline.map((g) => g.id)).toEqual([7]);
  });

  it('stays quiet when all active gateways are online', () => {
    expect(selectOfflineGateways([gw({}), gw({ id: 2 })])).toEqual([]);
  });

  it('ignores silent registrations that are not ACTIVE (e.g. revoked)', () => {
    expect(selectOfflineGateways([gw({ status: 'REVOKED', silent: true })])).toEqual([]);
  });

  it('stays quiet when the probe failed (null)', () => {
    expect(selectOfflineGateways(null)).toEqual([]);
  });
});
