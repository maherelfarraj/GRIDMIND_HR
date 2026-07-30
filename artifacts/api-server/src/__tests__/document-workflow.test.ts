/**
 * Integration tests — enterprise document lifecycle:
 * create → get → version → legal-hold → remove-hold → access-logs → acknowledge
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  enterpriseDocumentsTable,
  documentVersionsTable,
  documentAcknowledgementsTable,
  auditLogsTable,
} from "@workspace/db";
import app from "../app";

// Seeded category IDs — "PERSONAL" category is category ID 1 in demo data.
// We fetch it dynamically to be resilient to re-seeds.
import { documentCategoriesTable } from "@workspace/db";

const createdDocIds: number[] = [];

afterAll(async () => {
  if (createdDocIds.length) {
    // Remove acknowledgements, versions, audit rows, then documents.
    await db.delete(documentAcknowledgementsTable)
      .where(inArray(documentAcknowledgementsTable.documentId, createdDocIds));
    await db.delete(documentVersionsTable)
      .where(inArray(documentVersionsTable.documentId, createdDocIds));
    await db.delete(auditLogsTable)
      .where(inArray(auditLogsTable.entityId, createdDocIds));
    await db.delete(enterpriseDocumentsTable)
      .where(inArray(enterpriseDocumentsTable.id, createdDocIds));
  }
});

describe("enterprise document lifecycle", () => {
  let docId: number;
  let versionId: number;

  it("POST /api/enterprise-documents creates a document and returns 201 with documentNumber", async () => {
    // Get any seeded category to satisfy the NOT NULL FK.
    const [cat] = await db.select().from(documentCategoriesTable).limit(1);
    expect(cat).toBeDefined();

    const res = await request(app)
      .post("/api/enterprise-documents")
      .send({
        categoryId: cat.id,
        titleEn: "TEST Policy Document",
        titleAr: "وثيقة سياسة اختبار",
        scope: "org_policy",
        classificationLevel: "internal",
        status: "draft",
        employeeId: null,
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("id");
    expect(res.body).toHaveProperty("documentNumber");
    expect(res.body.documentNumber).toMatch(/^DOC-/);
    docId = res.body.id;
    createdDocIds.push(docId);
  });

  it("GET /api/enterprise-documents/:id returns 200 with document data", async () => {
    const res = await request(app).get(`/api/enterprise-documents/${docId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(docId);
    expect(res.body.titleEn).toBe("TEST Policy Document");
  });

  it("POST /api/enterprise-documents/:id/versions returns 201 with new version", async () => {
    const res = await request(app)
      .post(`/api/enterprise-documents/${docId}/versions`)
      .send({
        fileName: "policy_v1.1.pdf",
        storagePath: "/storage/test/policy_v1.1.pdf",
        mimeType: "application/pdf",
        fileSizeBytes: 12345,
        changeNotes: "Initial upload for test",
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("id");
    expect(res.body.documentId).toBe(docId);
    expect(res.body.isCurrentVersion).toBe(true);
    versionId = res.body.id;
  });

  it("GET /api/enterprise-documents/:id/versions returns list including the new version", async () => {
    const res = await request(app).get(`/api/enterprise-documents/${docId}/versions`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const ids = res.body.map((v: any) => v.id);
    expect(ids).toContain(versionId);
  });

  it("POST /api/enterprise-documents/:id/legal-hold returns 200 with isOnLegalHold:true", async () => {
    const res = await request(app)
      .post(`/api/enterprise-documents/${docId}/legal-hold`)
      .send({ reason: "test legal hold" });
    expect(res.status).toBe(200);
    expect(res.body.isOnLegalHold).toBe(true);
    expect(res.body.legalHoldReason).toBe("test legal hold");
  });

  it("POST /api/enterprise-documents/:id/remove-legal-hold returns 200 with isOnLegalHold:false", async () => {
    const res = await request(app)
      .post(`/api/enterprise-documents/${docId}/remove-legal-hold`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.isOnLegalHold).toBe(false);
  });

  it("GET /api/enterprise-documents/:id/access-logs returns a paginated list", async () => {
    const res = await request(app).get(`/api/enterprise-documents/${docId}/access-logs`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("data");
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body).toHaveProperty("total");
  });

  it("POST /api/enterprise-documents/:id/acknowledge returns 201", async () => {
    const res = await request(app)
      .post(`/api/enterprise-documents/${docId}/acknowledge`)
      .send({});
    // Route returns 201 (insert acknowledgement).
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("id");
    expect(res.body.documentId).toBe(docId);
    expect(res.body.status).toBe("acknowledged");
  });

  it("GET /api/enterprise-documents/:id returns 404 for a non-existent document", async () => {
    const res = await request(app).get("/api/enterprise-documents/999999");
    expect(res.status).toBe(404);
  });
});
