/**
 * Task #43 — Multi-org tenant isolation.
 *
 * Creates fixture rows in two organizations and asserts that, under each
 * X-Org-Id context, list endpoints only return that org's rows and :id
 * read/mutate endpoints 404 for the other org's rows (no cross-tenant IDOR).
 */
import { describe, it, beforeAll, afterAll, expect, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { invalidateOrgAccessCache } from "../lib/orgContext";
import { eq, inArray, and } from "drizzle-orm";
import {
  db,
  organizationsTable, employeesTable, payrollPeriodsTable, leaveTypesTable,
  leaveRequestsTable, leaveApprovalStepsTable, leaveBalancesTable,
  attendanceRecordsTable, publicHolidaysTable, approvalChainConfigsTable,
  policyLocalesTable, integrationConnectionProfilesTable, configPackagesTable, rolesTable, systemUsersTable, policyChangeRequestsTable } from "@workspace/db";
import app from "../app";

const SUFFIX = `TORG${Date.now() % 1000000}`;

let orgAId: number; // default-org-independent fixture orgs
let orgBId: number;
let empAId: number;
let empBId: number;
let periodAId: number;
let periodBId: number;
let leaveTypeId: number;
let reqAId: number;
let reqBId: number;
let balAId: number;
let balBId: number;
let attAId: number;
let attBId: number;
let holAId: number;
let holGlobalId: number;
let chainAId: number;
let chainBId: number;
let localeBId: number;
let profileBId: number;
let packageBId: number;

const hdr = (orgId: number) => ({ "X-Org-Id": String(orgId) });

beforeAll(async () => {
  const [orgA] = await db.insert(organizationsTable).values({
    orgType: "company", orgCode: `${SUFFIX}-A`, nameEn: "Test Org A", nameAr: "منظمة أ",
    status: "active", createdByUserId: 1,
  }).returning();
  const [orgB] = await db.insert(organizationsTable).values({
    orgType: "company", orgCode: `${SUFFIX}-B`, nameEn: "Test Org B", nameAr: "منظمة ب",
    status: "active", createdByUserId: 1,
  }).returning();
  orgAId = orgA.id;
  orgBId = orgB.id;

  const [seedEmp] = await db.select().from(employeesTable).limit(1);
  const mkEmp = (org: number, n: string) => ({
    employeeNumber: `${SUFFIX}-${n}`,
    firstNameEn: "Org", lastNameEn: `Iso${n}`,
    firstNameAr: "عزل", lastNameAr: n,
    nationalId: `${SUFFIX}${n}`,
    jobTitleEn: "Tester", jobTitleAr: "مختبر",
    departmentId: seedEmp.departmentId, roleId: seedEmp.roleId,
    status: "active", email: `${SUFFIX}-${n}@example.com`,
    hireDate: "2020-01-01", nationality: "SA", orgId: org,
  });
  const [ea] = await db.insert(employeesTable).values(mkEmp(orgAId, "A")).returning();
  const [eb] = await db.insert(employeesTable).values(mkEmp(orgBId, "B")).returning();
  empAId = ea.id;
  empBId = eb.id;

  const [pa] = await db.insert(payrollPeriodsTable).values({
    periodCode: `${SUFFIX}-PA`, nameEn: "Iso Period A", nameAr: "فترة أ",
    startDate: "2097-01-01", endDate: "2097-01-31", payDate: "2097-02-01",
    status: "draft", orgId: orgAId,
  }).returning();
  const [pb] = await db.insert(payrollPeriodsTable).values({
    periodCode: `${SUFFIX}-PB`, nameEn: "Iso Period B", nameAr: "فترة ب",
    startDate: "2097-01-01", endDate: "2097-01-31", payDate: "2097-02-01",
    status: "draft", orgId: orgBId,
  }).returning();
  periodAId = pa.id;
  periodBId = pb.id;

  const [lt] = await db.select().from(leaveTypesTable).limit(1);
  leaveTypeId = lt.id;
  const mkReq = (org: number, emp: number, n: string) => ({
    requestNumber: `${SUFFIX}${n}`, orgId: org, employeeId: emp, leaveTypeId,
    startDate: "2097-03-01", endDate: "2097-03-02", totalDays: "2", status: "draft" as const,
  });
  const [ra] = await db.insert(leaveRequestsTable).values(mkReq(orgAId, empAId, "RA")).returning();
  const [rb] = await db.insert(leaveRequestsTable).values(mkReq(orgBId, empBId, "RB")).returning();
  reqAId = ra.id;
  reqBId = rb.id;

  const mkBal = (org: number, emp: number) => ({
    employeeId: emp, orgId: org, leaveTypeId, year: 2097,
    openingBalance: "0", accrued: "20", used: "0", pending: "0", adjustment: "0", carriedOver: "0",
  });
  const [ba] = await db.insert(leaveBalancesTable).values(mkBal(orgAId, empAId)).returning();
  const [bb] = await db.insert(leaveBalancesTable).values(mkBal(orgBId, empBId)).returning();
  balAId = ba.id;
  balBId = bb.id;

  const mkAtt = (org: number, emp: number) => ({
    employeeId: emp, orgId: org, departmentId: seedEmp.departmentId,
    date: "2097-01-05", status: "present",
  });
  const [aa] = await db.insert(attendanceRecordsTable).values(mkAtt(orgAId, empAId)).returning();
  const [ab] = await db.insert(attendanceRecordsTable).values(mkAtt(orgBId, empBId)).returning();
  attAId = aa.id;
  attBId = ab.id;

  const [ha] = await db.insert(publicHolidaysTable).values({
    nameEn: `${SUFFIX} Org A Day`, nameAr: "يوم أ", date: "2097-05-05", year: 2097, orgId: orgAId,
  }).returning();
  const [hg] = await db.insert(publicHolidaysTable).values({
    nameEn: `${SUFFIX} Global Day`, nameAr: "يوم عام", date: "2097-06-06", year: 2097, orgId: null,
  }).returning();
  holAId = ha.id;
  holGlobalId = hg.id;

  const mkChain = (org: number, n: string) => ({
    orgId: org, name: `${SUFFIX} chain ${n}`, nameAr: `سلسلة ${n}`, chainType: "leave",
    stepsJson: "[]", createdByUserId: 1,
  });
  const [ca] = await db.insert(approvalChainConfigsTable).values(mkChain(orgAId, "A")).returning();
  const [cb] = await db.insert(approvalChainConfigsTable).values(mkChain(orgBId, "B")).returning();
  chainAId = ca.id;
  chainBId = cb.id;

  const [loc] = await db.insert(policyLocalesTable).values({
    orgId: orgBId, locale: "ar-SA", updatedByUserId: 1,
  } as any).returning();
  localeBId = loc.id;
  const [prof] = await db.insert(integrationConnectionProfilesTable).values({
    orgId: orgBId, profileName: `${SUFFIX} prof B`, profileNameAr: "ملف ب",
    integrationType: "smtp", configJson: "{}", createdByUserId: 1,
  } as any).returning();
  profileBId = prof.id;
  const [pkg] = await db.insert(configPackagesTable).values({
    orgId: orgBId, packageName: `${SUFFIX} pkg B`, packageType: "policy",
    version: "1.0.0", payloadJson: "{}", payloadChecksum: "x", createdByUserId: 1,
  } as any).returning();
  packageBId = pkg.id;
});

afterAll(async () => {
  await db.delete(configPackagesTable).where(eq(configPackagesTable.id, packageBId));
  await db.delete(integrationConnectionProfilesTable).where(eq(integrationConnectionProfilesTable.id, profileBId));
  await db.delete(policyLocalesTable).where(eq(policyLocalesTable.id, localeBId));
  await db.delete(approvalChainConfigsTable).where(inArray(approvalChainConfigsTable.id, [chainAId, chainBId]));
  await db.delete(publicHolidaysTable).where(inArray(publicHolidaysTable.id, [holAId, holGlobalId]));
  await db.delete(attendanceRecordsTable).where(inArray(attendanceRecordsTable.id, [attAId, attBId]));
  await db.delete(leaveBalancesTable).where(inArray(leaveBalancesTable.id, [balAId, balBId]));
  await db.delete(leaveApprovalStepsTable).where(inArray(leaveApprovalStepsTable.leaveRequestId, [reqAId, reqBId]));
  await db.delete(leaveRequestsTable).where(inArray(leaveRequestsTable.id, [reqAId, reqBId]));
  await db.delete(payrollPeriodsTable).where(inArray(payrollPeriodsTable.id, [periodAId, periodBId]));
  await db.delete(employeesTable).where(inArray(employeesTable.id, [empAId, empBId]));
  await db.delete(organizationsTable).where(inArray(organizationsTable.id, [orgAId, orgBId]));
});

describe("multi-org tenant isolation", () => {
  it("scopes the employees list to the active org", async () => {
    const resA = await request(app).get("/api/employees?limit=100").set(hdr(orgAId));
    expect(resA.status).toBe(200);
    const idsA = resA.body.data.map((e: { id: number }) => e.id);
    expect(idsA).toContain(empAId);
    expect(idsA).not.toContain(empBId);
    expect(resA.body.total).toBe(1);
  });

  it("404s employee detail, update and delete across orgs", async () => {
    expect((await request(app).get(`/api/employees/${empBId}`).set(hdr(orgAId))).status).toBe(404);
    expect((await request(app).patch(`/api/employees/${empBId}`).set(hdr(orgAId)).send({ phone: "x" })).status).toBe(404);
    expect((await request(app).delete(`/api/employees/${empBId}`).set(hdr(orgAId))).status).toBe(404);
    expect((await request(app).get(`/api/employees/${empBId}/documents`).set(hdr(orgAId))).status).toBe(404);
    expect((await request(app).get(`/api/employees/${empBId}/attendance`).set(hdr(orgAId))).status).toBe(404);
    // still reachable from its own org
    expect((await request(app).get(`/api/employees/${empBId}`).set(hdr(orgBId))).status).toBe(200);
  });

  it("scopes payroll periods and blocks cross-org period actions", async () => {
    const list = await request(app).get("/api/payroll-periods").set(hdr(orgAId));
    const ids = list.body.map((p: { id: number }) => p.id);
    expect(ids).toContain(periodAId);
    expect(ids).not.toContain(periodBId);

    expect((await request(app).get(`/api/payroll-periods/${periodBId}`).set(hdr(orgAId))).status).toBe(404);
    expect((await request(app).patch(`/api/payroll-periods/${periodBId}`).set(hdr(orgAId)).send({ notes: "x" })).status).toBe(404);
    expect((await request(app).post(`/api/payroll-periods/${periodBId}/calculate`).set(hdr(orgAId))).status).toBe(404);
    expect((await request(app).get(`/api/payroll-periods/${periodBId}/no-shows`).set(hdr(orgAId))).status).toBe(404);
    expect((await request(app).post(`/api/payroll-periods/${periodBId}/excused-absences`).set(hdr(orgAId))
      .send({ employeeId: empBId, date: "2097-01-05", reason: "x" })).status).toBe(404);
    expect((await request(app).get(`/api/payroll-periods/${periodBId}`).set(hdr(orgBId))).status).toBe(200);
  });

  it("scopes leave requests and blocks cross-org leave actions", async () => {
    const list = await request(app).get("/api/leave-requests").set(hdr(orgAId));
    const ids = list.body.map((r: { id: number }) => r.id);
    expect(ids).toContain(reqAId);
    expect(ids).not.toContain(reqBId);

    expect((await request(app).get(`/api/leave-requests/${reqBId}`).set(hdr(orgAId))).status).toBe(404);
    expect((await request(app).post(`/api/leave-requests/${reqBId}/submit`).set(hdr(orgAId))).status).toBe(404);
    expect((await request(app).post(`/api/leave-requests/${reqBId}/cancel`).set(hdr(orgAId))).status).toBe(404);
    expect((await request(app).post(`/api/leave-requests/${reqBId}/decide`).set(hdr(orgAId))
      .send({ decision: "approved" })).status).toBe(404);
    expect((await request(app).get(`/api/leave-requests/${reqBId}`).set(hdr(orgBId))).status).toBe(200);
  });

  it("scopes leave balances and blocks cross-org balance edits", async () => {
    const list = await request(app).get("/api/leave-balances").set(hdr(orgAId));
    const ids = list.body.map((b: { id: number }) => b.id);
    expect(ids).toContain(balAId);
    expect(ids).not.toContain(balBId);

    expect((await request(app).patch(`/api/leave-balances/${balBId}`).set(hdr(orgAId))
      .send({ adjustment: "5" })).status).toBe(404);
  });

  it("scopes attendance to the active org", async () => {
    const resA = await request(app).get("/api/attendance?from=2097-01-01&to=2097-01-31&limit=100").set(hdr(orgAId));
    const ids = resA.body.map((r: { id: number }) => r.id);
    expect(ids).toContain(attAId);
    expect(ids).not.toContain(attBId);
  });

  it("shows global holidays to every org but org holidays only to their own", async () => {
    const resA = await request(app).get("/api/public-holidays?year=2097").set(hdr(orgAId));
    const idsA = resA.body.map((h: { id: number }) => h.id);
    expect(idsA).toContain(holAId);
    expect(idsA).toContain(holGlobalId);

    const resB = await request(app).get("/api/public-holidays?year=2097").set(hdr(orgBId));
    const idsB = resB.body.map((h: { id: number }) => h.id);
    expect(idsB).not.toContain(holAId);
    expect(idsB).toContain(holGlobalId);

    // cross-org holiday mutation is blocked
    expect((await request(app).patch(`/api/public-holidays/${holAId}`).set(hdr(orgBId))
      .send({ notes: "x" })).status).toBe(404);
    expect((await request(app).delete(`/api/public-holidays/${holAId}`).set(hdr(orgBId))).status).toBe(404);
  });

  it("scopes approval chain configs and blocks cross-org chain access", async () => {
    const list = await request(app).get("/api/approval-chain-configs").set(hdr(orgAId));
    const ids = list.body.map((c: { id: number }) => c.id);
    expect(ids).toContain(chainAId);
    expect(ids).not.toContain(chainBId);

    expect((await request(app).get(`/api/approval-chain-configs/${chainBId}`).set(hdr(orgAId))).status).toBe(404);
    expect((await request(app).patch(`/api/approval-chain-configs/${chainBId}`).set(hdr(orgAId))
      .send({ name: "hijack" })).status).toBe(404);
    expect((await request(app).delete(`/api/approval-chain-configs/${chainBId}`).set(hdr(orgAId))).status).toBe(404);
  });

  it("scopes the leave calendar to the active org", async () => {
    // approve org B's request so it would appear on a calendar
    await db.update(leaveRequestsTable).set({ status: "approved" }).where(eq(leaveRequestsTable.id, reqBId));
    const res = await request(app)
      .get("/api/leave-calendar?startDate=2097-01-01&endDate=2097-12-31").set(hdr(orgAId));
    expect(res.status).toBe(200);
    const ids = res.body.map((r: { id: number }) => r.id);
    expect(ids).not.toContain(reqBId);
    const resB = await request(app)
      .get("/api/leave-calendar?startDate=2097-01-01&endDate=2097-12-31").set(hdr(orgBId));
    expect(resB.body.map((r: { id: number }) => r.id)).toContain(reqBId);
  });

  it("blocks cross-org access to phase-9 config rows (locales, profiles, packages)", async () => {
    expect((await request(app).get(`/api/policy-locales/${localeBId}`).set(hdr(orgAId))).status).toBe(404);
    expect((await request(app).patch(`/api/policy-locales/${localeBId}`).set(hdr(orgAId)).send({ locale: "en-US" })).status).toBe(404);
    expect((await request(app).get(`/api/policy-locales/${localeBId}`).set(hdr(orgBId))).status).toBe(200);

    expect((await request(app).get(`/api/integration-governance/connection-profiles/${profileBId}`).set(hdr(orgAId))).status).toBe(404);
    expect((await request(app).patch(`/api/integration-governance/connection-profiles/${profileBId}`).set(hdr(orgAId)).send({ profileName: "hijack" })).status).toBe(404);
    expect((await request(app).delete(`/api/integration-governance/connection-profiles/${profileBId}`).set(hdr(orgAId))).status).toBe(404);
    expect((await request(app).get(`/api/integration-governance/connection-profiles/${profileBId}`).set(hdr(orgBId))).status).toBe(200);

    expect((await request(app).get(`/api/config-packages/${packageBId}`).set(hdr(orgAId))).status).toBe(404);
    expect((await request(app).post(`/api/config-packages/${packageBId}/apply`).set(hdr(orgAId))).status).toBe(404);
    const listA = await request(app).get("/api/config-packages").set(hdr(orgAId));
    expect(listA.body.map((p: { id: number }) => p.id)).not.toContain(packageBId);
    expect((await request(app).get(`/api/config-packages/${packageBId}`).set(hdr(orgBId))).status).toBe(200);
  });

  it("ignores ?orgId overrides on tenant-scoped lists", async () => {
    const locales = await request(app).get(`/api/policy-locales?orgId=${orgBId}`).set(hdr(orgAId));
    expect(locales.status).toBe(200);
    expect(locales.body.map((r: { id: number }) => r.id)).not.toContain(localeBId);

    const profiles = await request(app)
      .get(`/api/integration-governance/connection-profiles?orgId=${orgBId}`).set(hdr(orgAId));
    expect(profiles.body.map((r: { id: number }) => r.id)).not.toContain(profileBId);

    const chains = await request(app).get(`/api/approval-chain-configs?orgId=${orgBId}`).set(hdr(orgAId));
    expect(chains.body.map((r: { id: number }) => r.id)).not.toContain(chainBId);
  });

  it("rejects creating records against another org's employee or period", async () => {
    // leave request for a foreign employee
    const lr = await request(app).post("/api/leave-requests").set(hdr(orgAId)).send({
      employeeId: empBId, leaveTypeId, startDate: "2097-04-01", endDate: "2097-04-02", totalDays: 2,
    });
    expect(lr.status).toBe(404);

    // leave balance for a foreign employee
    const lb = await request(app).post("/api/leave-balances").set(hdr(orgAId)).send({
      employeeId: empBId, leaveTypeId, year: 2098, accrued: "20",
    });
    expect(lb.status).toBe(404);

    // payroll runs listed via a foreign period id
    const runs = await request(app).get(`/api/payroll-runs?periodId=${periodBId}`).set(hdr(orgAId));
    expect(runs.status).toBe(404);
    expect((await request(app).get(`/api/payroll-runs?periodId=${periodBId}`).set(hdr(orgBId))).status).toBe(200);
  });

  it("stamps created rows with the active org even when the body claims another org", async () => {
    const res = await request(app).post("/api/approval-chain-configs").set(hdr(orgAId)).send({
      orgId: orgBId, name: `${SUFFIX} spoof`, nameAr: "انتحال", chainType: "leave", stepsJson: "[]",
    });
    expect(res.status).toBe(201);
    expect(res.body.orgId).toBe(orgAId);
    await db.delete(approvalChainConfigsTable).where(eq(approvalChainConfigsTable.id, res.body.id));
  });

  it("falls back to the default organization when no org header is sent", async () => {
    const res = await request(app).get("/api/employees?limit=100");
    expect(res.status).toBe(200);
    const ids = res.body.data.map((e: { id: number }) => e.id);
    expect(ids).not.toContain(empAId);
    expect(ids).not.toContain(empBId);
  });

  it("rejects an invalid or unknown X-Org-Id header instead of trusting it", async () => {
    // Malformed header → 400 before any route handler runs
    expect((await request(app).get("/api/employees").set("X-Org-Id", "abc")).status).toBe(400);
    expect((await request(app).get("/api/employees").set("X-Org-Id", "-5")).status).toBe(400);
    // Nonexistent organization → 400 (UNKNOWN_ORG)
    const res = await request(app).get("/api/employees").set("X-Org-Id", "99999999");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("UNKNOWN_ORG");
  });

  it("requires an authenticated session to select an org context when auth is enforced", async () => {
    vi.stubEnv("PILOT_AUTH", "true");
    try {
      const res = await request(app).get("/api/employees").set(hdr(orgAId));
      expect(res.status).toBe(401);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("blocks a non-admin org A user from forging X-Org-Id to org B, while a system-role admin may switch", async () => {
    vi.stubEnv("PILOT_AUTH", "true");
    const PW = `Str0ng!${SUFFIX}pass`;
    const hash = await bcrypt.hash(PW, 4);
    // Non-admin role (systemRole=false) + user whose employee lives in org A.
    const [role] = await db.insert(rolesTable).values({
      nameEn: `TEST OrgIso Role ${SUFFIX}`, nameAr: "دور اختبار", systemRole: false,
    }).returning();
    const [user] = await db.insert(systemUsersTable).values({
      username: `t-orgiso-${SUFFIX}`, email: `t-orgiso-${SUFFIX}@example.com`,
      fullNameEn: "Test OrgIso", fullNameAr: "اختبار عزل",
      roleId: role.id, employeeId: empAId, passwordHash: hash, isActive: true,
    }).returning();
    const [adminRole] = await db.insert(rolesTable).values({
      nameEn: `TEST OrgIso Admin ${SUFFIX}`, nameAr: "مشرف اختبار", systemRole: true,
    }).returning();
    const [adminUser] = await db.insert(systemUsersTable).values({
      username: `t-orgiso-adm-${SUFFIX}`, email: `t-orgiso-adm-${SUFFIX}@example.com`,
      fullNameEn: "Test OrgIso Admin", fullNameAr: "مشرف عزل",
      roleId: adminRole.id, employeeId: empAId, passwordHash: hash, isActive: true,
    }).returning();
    invalidateOrgAccessCache();
    try {
      const agent = request.agent(app);
      expect((await agent.post("/api/auth/login").send({ username: user.username, password: PW })).status).toBe(200);
      // Own org: allowed. Forged org B header: 403. No header: default org fallback works.
      expect((await agent.get("/api/employees").set(hdr(orgAId))).status).toBe(200);
      const forged = await agent.get("/api/employees").set(hdr(orgBId));
      expect(forged.status).toBe(403);
      expect(forged.body.code).toBe("ORG_ACCESS_DENIED");

      const adminAgent = request.agent(app);
      expect((await adminAgent.post("/api/auth/login").send({ username: adminUser.username, password: PW })).status).toBe(200);
      expect((await adminAgent.get("/api/employees").set(hdr(orgBId))).status).toBe(200);

      // No header: context is the user's HOME org, not the default tenant —
      // an org A user sees org A records and never default-org/org B ids.
      const noHdr = await agent.get("/api/employees?limit=100");
      expect(noHdr.status).toBe(200);
      const ids = noHdr.body.data.map((e: { id: number }) => e.id);
      expect(ids).toContain(empAId);
      expect(ids).not.toContain(empBId);

      // Bulk leave-balance ops: forging org B is denied; running without a
      // header stays scoped to the user's home org (creates no org B rows).
      expect((await agent.post("/api/leave-balances/provision-year").set(hdr(orgBId)).send({ year: 2031 })).status).toBe(403);
      expect((await agent.post("/api/leave-balances/annual-reset").set(hdr(orgBId)).send({ year: 2031 })).status).toBe(403);
      const prov = await agent.post("/api/leave-balances/provision-year").send({ year: 2031 });
      expect(prov.status).toBe(200);
      const orgBRows = await db.select().from(leaveBalancesTable).where(
        and(eq(leaveBalancesTable.year, 2031), eq(leaveBalancesTable.orgId, orgBId)));
      expect(orgBRows.length).toBe(0);
      await db.delete(leaveBalancesTable).where(eq(leaveBalancesTable.year, 2031));

      // Policy governance: an org B change request is invisible/immutable to a
      // non-admin org A user, and version creation cannot be forced into org B.
      const [crB] = await db.insert(policyChangeRequestsTable).values({
        orgId: orgBId, policyArea: "leave_policy", titleEn: `TEST CR B ${SUFFIX}`, titleAr: "طلب",
        changeAfterJson: "{}", makerUserId: user.id, status: "pending_review",
      }).returning();
      try {
        expect((await agent.get(`/api/policy-change-requests/${crB.id}`)).status).toBe(404);
        expect((await agent.patch(`/api/policy-change-requests/${crB.id}/approve`).send({})).status).toBe(404);
        const forgeVer = await agent.post("/api/policy-versions").send({
          orgId: orgBId, policyArea: "leave_policy", version: 999, snapshotJson: "{}",
        });
        expect(forgeVer.status).toBeGreaterThanOrEqual(400);
        // Admins retain cross-org governance access.
        expect((await adminAgent.get(`/api/policy-change-requests/${crB.id}`)).status).toBe(200);
      } finally {
        await db.delete(policyChangeRequestsTable).where(eq(policyChangeRequestsTable.id, crB.id));
      }
    } finally {
      vi.unstubAllEnvs();
      await db.delete(systemUsersTable).where(inArray(systemUsersTable.id, [user.id, adminUser.id]));
      await db.delete(rolesTable).where(inArray(rolesTable.id, [role.id, adminRole.id]));
      invalidateOrgAccessCache();
    }
  });
});
