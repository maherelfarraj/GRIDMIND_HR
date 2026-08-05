/**
 * API-level tests for POST /employment-type-configs.
 *
 * Guards the create contract for employment type configurations: a valid
 * body (orgId + employmentType + labelEn + labelAr, plus eligibleBenefits)
 * succeeds, and a body missing a required NOT NULL column is rejected with
 * 400 instead of reaching drizzle and blowing up with a DB error.
 *
 * Self-cleaning: creates a dedicated organization fixture and removes it (and
 * any created config rows) afterwards; runs against the live seeded DB.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { inArray, eq } from "drizzle-orm";
import {
  db,
  organizationsTable,
  organizationBrandingTable,
  employmentTypeConfigsTable,
} from "@workspace/db";
import app from "../app";
import request from "supertest";

let orgId: number;
const createdConfigIds: number[] = [];

beforeAll(async () => {
  const res = await request(app)
    .post("/api/organizations")
    .send({
      nameEn: "Test Corp EmpType",
      nameAr: "شركة اختبار نوع التوظيف",
      orgCode: `TST-ETC-${Date.now()}`,
      orgType: "company",
    });
  expect(res.status).toBe(201);
  orgId = res.body.id;
});

afterAll(async () => {
  if (createdConfigIds.length) {
    await db.delete(employmentTypeConfigsTable)
      .where(inArray(employmentTypeConfigsTable.id, createdConfigIds));
  }
  if (orgId) {
    await db.delete(organizationBrandingTable).where(eq(organizationBrandingTable.orgId, orgId));
    await db.delete(organizationsTable).where(eq(organizationsTable.id, orgId));
  }
});

describe("POST /employment-type-configs", () => {
  it("creates a config from a valid body and persists eligibleBenefits", async () => {
    const res = await request(app)
      .post("/api/employment-type-configs")
      .send({
        orgId,
        employmentType: "full_time",
        labelEn: "Full Time",
        labelAr: "دوام كامل",
        probationDays: 90,
        defaultContractMonths: 12,
        eligibleLeave: true,
        eligiblePayroll: true,
        eligibleBenefits: true,
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    createdConfigIds.push(res.body.id);
    expect(res.body.orgId).toBe(orgId);
    expect(res.body.employmentType).toBe("full_time");
    expect(res.body.labelEn).toBe("Full Time");
    expect(res.body.labelAr).toBe("دوام كامل");
    expect(res.body.eligibleBenefits).toBe(true);

    // Verify the row really landed in the table.
    const [row] = await db.select().from(employmentTypeConfigsTable)
      .where(eq(employmentTypeConfigsTable.id, res.body.id));
    expect(row).toBeDefined();
    expect(row.eligibleBenefits).toBe(true);
  });

  it("rejects a body missing required fields (labelAr) with 400", async () => {
    const res = await request(app)
      .post("/api/employment-type-configs")
      .send({
        orgId,
        employmentType: "part_time",
        labelEn: "Part Time",
        // labelAr omitted — NOT NULL column
      });
    expect(res.status).toBe(400);
    if (res.body?.id) createdConfigIds.push(res.body.id);
  });

  it("rejects a body missing orgId with 400", async () => {
    const res = await request(app)
      .post("/api/employment-type-configs")
      .send({
        employmentType: "contract",
        labelEn: "Contract",
        labelAr: "عقد",
      });
    expect(res.status).toBe(400);
    if (res.body?.id) createdConfigIds.push(res.body.id);
  });
});
