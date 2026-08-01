/**
 * POST /documents attribution tests.
 *
 * Verifies that a created document is credited to the authenticated session
 * user (via bearer session transport), and that a client-supplied
 * uploadedByUserId in the request body is never trusted.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { eq, inArray } from "drizzle-orm";
import { db, documentsTable, employeesTable, systemUsersTable } from "@workspace/db";
import app from "../app";

const USERNAME = "doc-attrib-tester";
const PASSWORD = "AttribTest#2026!";

let uploaderId: number;
let employeeId: number;
const createdDocIds: number[] = [];

beforeAll(async () => {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const [user] = await db.insert(systemUsersTable).values({
    username: USERNAME,
    email: `${USERNAME}@test.example`,
    fullNameEn: "Doc Attribution Tester",
    fullNameAr: "اختبار",
    roleId: 1,
    isActive: true,
    passwordHash,
    mustChangePassword: false,
  }).returning();
  uploaderId = user.id;

  const [emp] = await db.select().from(employeesTable).limit(1);
  expect(emp).toBeDefined();
  employeeId = emp.id;
});

afterAll(async () => {
  if (createdDocIds.length) {
    await db.delete(documentsTable).where(inArray(documentsTable.id, createdDocIds));
  }
  await db.delete(systemUsersTable).where(eq(systemUsersTable.username, USERNAME));
});

async function loginToken(): Promise<string> {
  const login = await request(app)
    .post("/api/auth/login")
    .set("x-session-transport", "bearer")
    .send({ username: USERNAME, password: PASSWORD });
  expect(login.status).toBe(200);
  return login.body.sessionToken as string;
}

describe("POST /documents uploader attribution", () => {
  it("credits the document to the authenticated session user", async () => {
    const token = await loginToken();
    const res = await request(app)
      .post("/api/documents")
      .set("Authorization", `Bearer ${token}`)
      .send({
        employeeId,
        category: "contract",
        titleEn: "TEST Attribution Doc",
        titleAr: "وثيقة اختبار",
        status: "active",
      });
    expect(res.status).toBe(201);
    createdDocIds.push(res.body.id);
    expect(res.body.uploadedByUserId).toBe(uploaderId);
    expect(res.body.uploadedByUserName).toBe("Doc Attribution Tester");
  });

  it("ignores a client-supplied uploadedByUserId", async () => {
    const token = await loginToken();
    const res = await request(app)
      .post("/api/documents")
      .set("Authorization", `Bearer ${token}`)
      .send({
        employeeId,
        category: "contract",
        titleEn: "TEST Attribution Spoof Doc",
        titleAr: "وثيقة اختبار",
        status: "active",
        uploadedByUserId: 999999,
      });
    expect(res.status).toBe(201);
    createdDocIds.push(res.body.id);
    expect(res.body.uploadedByUserId).toBe(uploaderId);
  });
});
