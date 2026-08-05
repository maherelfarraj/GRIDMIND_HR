/**
 * Verifies Arabic label editing for vault refs and connection profiles.
 * Self-cleaning: all DB rows created here are deleted in afterAll.
 */
import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { db, integrationCredentialVaultRefsTable, integrationConnectionProfilesTable } from '@workspace/db';
import { eq, inArray } from 'drizzle-orm';
import app from '../app';

const createdVaultRefIds: number[] = [];
const createdProfileIds: number[] = [];

afterAll(async () => {
  if (createdProfileIds.length) {
    await db.delete(integrationConnectionProfilesTable).where(inArray(integrationConnectionProfilesTable.id, createdProfileIds));
  }
  if (createdVaultRefIds.length) {
    await db.delete(integrationCredentialVaultRefsTable).where(inArray(integrationCredentialVaultRefsTable.id, createdVaultRefIds));
  }
});

describe('Arabic label edit — vault ref and profile', () => {
  it('PATCH credential-vault-refs/:id updates only labelAr and persists', async () => {
    const create = await request(app)
      .post('/api/integration-governance/credential-vault-refs')
      .send({ labelEn: 'LDAP Bind Credentials', labelAr: 'LDAP Bind Credentials', credentialType: 'ldap', vaultKeyRef: 'AR_LABEL_TEST_KEY' });
    expect(create.status).toBe(201);
    const id = create.body.id;
    createdVaultRefIds.push(id);

    const patch = await request(app)
      .patch(`/api/integration-governance/credential-vault-refs/${id}`)
      .send({ labelAr: 'بيانات اعتماد ربط LDAP' });
    expect(patch.status).toBe(200);
    expect(patch.body.labelAr).toBe('بيانات اعتماد ربط LDAP');
    expect(patch.body.labelEn).toBe('LDAP Bind Credentials'); // untouched

    const [row] = await db.select().from(integrationCredentialVaultRefsTable).where(eq(integrationCredentialVaultRefsTable.id, id));
    expect(row.labelAr).toBe('بيانات اعتماد ربط LDAP');
    expect(row.labelEn).toBe('LDAP Bind Credentials');
  });

  it('PATCH connection-profiles/:id updates only profileNameAr and leaves governanceStatus untouched', async () => {
    const create = await request(app)
      .post('/api/integration-governance/connection-profiles')
      .send({ profileName: 'Main LDAP Server', profileNameAr: 'Main LDAP Server', integrationType: 'ldap', environment: 'development', connectionParamsJson: '{}' });
    expect(create.status).toBe(201);
    const id = create.body.id;
    createdProfileIds.push(id);
    const originalGovernanceStatus = create.body.governanceStatus;

    const patch = await request(app)
      .patch(`/api/integration-governance/connection-profiles/${id}`)
      .send({ profileNameAr: 'خادم LDAP الرئيسي' });
    expect(patch.status).toBe(200);
    expect(patch.body.profileNameAr).toBe('خادم LDAP الرئيسي');
    expect(patch.body.profileName).toBe('Main LDAP Server'); // untouched
    expect(patch.body.governanceStatus).toBe(originalGovernanceStatus); // untouched

    const [row] = await db.select().from(integrationConnectionProfilesTable).where(eq(integrationConnectionProfilesTable.id, id));
    expect(row.profileNameAr).toBe('خادم LDAP الرئيسي');
    expect(row.profileName).toBe('Main LDAP Server');
    expect(row.governanceStatus).toBe(originalGovernanceStatus);
  });
});
