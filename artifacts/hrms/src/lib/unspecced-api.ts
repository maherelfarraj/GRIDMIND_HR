/**
 * Raw fetch helpers for endpoints that are NOT described in the OpenAPI spec
 * and therefore have no generated hook in @workspace/api-client-react.
 *
 * Each helper documents:
 *  - which endpoint it calls
 *  - why the generated client cannot cover it
 *  - a TODO pointing to future spec addition
 *
 * IMPORTANT: Do NOT import apiFetch anywhere else in the codebase.
 * Pages/components must use @workspace/api-client-react hooks instead.
 * This file is the sole legitimate consumer of apiFetch for unspecced paths.
 */
import { apiFetch } from '@/lib/api';

// ─── Gateway registration helpers ────────────────────────────────────────────

/** Row shape returned by GET /api/gateway/registrations. */
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
 * Fetch gateway registrations as an OPTIONAL probe.
 *
 * Endpoint: GET /api/gateway/registrations
 * Why unspecced: the endpoint is in the spec, but the generated client's
 * customFetch always fires the global 401 → session-expired handler.
 * In the gateway sidebar widget a 401 means "hide the widget", not "log out".
 * The generated client has no per-call opt-out for that behaviour.
 *
 * TODO: add an `optionalAuth` request option to customFetch so this can move
 * to the generated useListGatewayRegistrations hook.
 */
export async function fetchGatewayRegistrations(): Promise<GatewayRegistration[] | null> {
  try {
    const res = await apiFetch(
      '/api/gateway/registrations',
      { credentials: 'include' },
      { optionalAuth: true },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? data : null;
  } catch {
    return null; // network error — stay quiet
  }
}

/** Currently offline gateways: ACTIVE registrations the server flagged silent. */
export function selectOfflineGateways(
  gateways: GatewayRegistration[] | null,
): GatewayRegistration[] {
  return (gateways ?? []).filter((g) => g.status === 'ACTIVE' && g.silent);
}

/**
 * Queue an immediate reconcile command for a gateway registration.
 *
 * Endpoint: POST /api/gateway/registrations/{id}/reconcile
 * Why unspecced: endpoint absent from the OpenAPI spec; no generated hook exists.
 *
 * TODO: add to the OpenAPI spec so a generated hook can replace this.
 */
export async function reconcileGatewayRegistration(id: number): Promise<unknown> {
  const res = await apiFetch(`/api/gateway/registrations/${id}/reconcile`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || 'Failed to queue reconcile');
  }
  return res.json();
}

/**
 * Update the per-registration silence alarm threshold.
 *
 * Endpoint: PATCH /api/gateway/registrations/{id}  (silenceThresholdMinutes)
 * Why unspecced: endpoint absent from the OpenAPI spec; no generated hook exists.
 *
 * TODO: add to the OpenAPI spec so a generated hook can replace this.
 */
export async function patchGatewayRegistrationThreshold(
  id: number,
  minutes: number | null,
): Promise<unknown> {
  const res = await apiFetch(`/api/gateway/registrations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ silenceThresholdMinutes: minutes }),
    credentials: 'include',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || 'Failed to update threshold');
  }
  return res.json();
}

// ─── Integration governance status helpers ────────────────────────────────────

/**
 * Fetch the security alert email delivery status.
 *
 * Endpoint: GET /api/integration-governance/security-email-status
 * Why unspecced: endpoint absent from the OpenAPI spec; no generated hook exists.
 *
 * TODO: add to the OpenAPI spec so a generated hook can replace this.
 */
export async function fetchSecurityEmailStatus(): Promise<unknown> {
  const res = await apiFetch('/api/integration-governance/security-email-status');
  return res.json();
}

/**
 * Fetch the gateway key pepper rotation status.
 *
 * Endpoint: GET /api/integration-governance/pepper-rotation-status
 * Why unspecced: endpoint absent from the OpenAPI spec; no generated hook exists.
 *
 * TODO: add to the OpenAPI spec so a generated hook can replace this.
 */
export async function fetchPepperRotationStatus(): Promise<unknown> {
  const res = await apiFetch('/api/integration-governance/pepper-rotation-status');
  return res.json();
}

// ─── Credential vault ref CRUD ────────────────────────────────────────────────
// These three endpoints are absent from the OpenAPI spec. The generated client
// only exposes listCredentialVaultRefs (GET). The write operations (POST/PATCH/
// DELETE) have no generated hook.
//
// TODO: add create/update/delete to the OpenAPI spec so generated hooks can
// replace these helpers.

/**
 * Create a new credential vault ref.
 *
 * Endpoint: POST /api/integration-governance/credential-vault-refs
 * Why unspecced: write path absent from the OpenAPI spec.
 */
export async function createCredentialVaultRef(payload: {
  labelEn: string;
  labelAr: string;
  credentialType: string;
  vaultKeyRef: string;
}): Promise<unknown> {
  const res = await apiFetch('/api/integration-governance/credential-vault-refs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to create vault ref');
  return res.json().catch(() => null);
}

/**
 * Update an existing credential vault ref.
 *
 * Endpoint: PATCH /api/integration-governance/credential-vault-refs/{id}
 * Why unspecced: write path absent from the OpenAPI spec.
 */
export async function updateCredentialVaultRef(
  id: number,
  payload: {
    labelEn: string;
    labelAr: string;
    credentialType: string;
    vaultKeyRef: string;
  },
): Promise<unknown> {
  const res = await apiFetch(`/api/integration-governance/credential-vault-refs/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to update vault ref');
  return res.json().catch(() => null);
}

/**
 * Delete a credential vault ref.
 *
 * Endpoint: DELETE /api/integration-governance/credential-vault-refs/{id}
 * Why unspecced: write path absent from the OpenAPI spec.
 */
export async function deleteCredentialVaultRef(id: number): Promise<void> {
  const res = await apiFetch(
    `/api/integration-governance/credential-vault-refs/${id}`,
    { method: 'DELETE' },
  );
  if (!res.ok) throw new Error('Failed to delete vault ref');
}

// ─── Go-live gate helpers ─────────────────────────────────────────────────────

/**
 * Evaluate a single go-live gate by its numeric DB id.
 *
 * Endpoint: POST /api/go-live-gates/{gateId}/evaluate
 * Why unspecced: the generated client only has the bulk /evaluate endpoint.
 * The per-gate evaluate (by numeric id, not gateKey) is absent from the spec.
 *
 * The server has no per-gate evaluate route; calling the bulk endpoint has the
 * same observable effect (it re-evaluates and persists results for all gates,
 * then the caller refreshes the full list).
 * TODO: add a per-gate evaluate route to the spec and generate a hook.
 */
export async function evaluateGoLiveGateSingle(_gateId: number): Promise<void> {
  // POST /go-live-gates/evaluate is the only evaluate route; it covers all gates.
  await apiFetch('/api/go-live-gates/evaluate', { method: 'POST' });
}
