import { Router } from "express";
import { getActorUserId } from "../middleware/requireAuth.js";
import { db, attendanceCorrectionsTable, attendanceRecordsTable, employeesTable, systemUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

async function enrichCorrection(c: typeof attendanceCorrectionsTable.$inferSelect) {
  const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, c.employeeId));
  const [rec] = await db.select().from(attendanceRecordsTable).where(eq(attendanceRecordsTable.id, c.attendanceRecordId));
  const [requester] = await db.select().from(systemUsersTable).where(eq(systemUsersTable.id, c.requestedByUserId));
  let reviewer = null;
  if (c.reviewedByUserId) {
    const [r] = await db.select().from(systemUsersTable).where(eq(systemUsersTable.id, c.reviewedByUserId));
    reviewer = r;
  }
  return {
    ...c,
    employeeNameEn: emp ? `${emp.firstNameEn} ${emp.lastNameEn}` : "Unknown",
    employeeNameAr: emp ? `${emp.firstNameAr} ${emp.lastNameAr}` : "Unknown",
    employeeNumber: emp?.employeeNumber ?? "",
    recordDate: rec?.date ?? "",
    requestedByName: requester?.fullNameEn ?? "System",
    reviewedByName: reviewer?.fullNameEn ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    reviewedAt: c.reviewedAt?.toISOString() ?? null,
  };
}

// GET all corrections
router.get("/attendance/corrections", async (req, res): Promise<void> => {
  const status = req.query.status as string | undefined;
  let corrections = await db.select().from(attendanceCorrectionsTable).orderBy(attendanceCorrectionsTable.createdAt);
  if (status) corrections = corrections.filter((c) => c.status === status);
  const enriched = await Promise.all(corrections.map(enrichCorrection));
  res.json(enriched);
});

// POST request a correction
router.post("/attendance/:id/correction", async (req, res): Promise<void> => {
  // Demo mode: default to admin (userId=1) when no session is present.
  // In production, enforce real session middleware before this guard.
  const recordId = parseInt(req.params.id);
  const { employeeId, correctionType, originalValue, requestedValue, reason, requestedByUserId } = req.body;
  if (!correctionType || !requestedValue || !reason) {
    res.status(400).json({ error: "correctionType, requestedValue, reason required" });
    return;
  }
  const [correction] = await db.insert(attendanceCorrectionsTable).values({
    attendanceRecordId: recordId,
    employeeId: employeeId ?? 1,
    requestedByUserId: getActorUserId(req),
    correctionType,
    originalValue: originalValue ?? null,
    requestedValue,
    reason,
    status: "pending",
  }).returning();
  res.status(201).json(await enrichCorrection(correction));
});

// PATCH decide on a correction
router.patch("/attendance/corrections/:id/decision", async (req, res): Promise<void> => {
  // Demo mode: default to admin (userId=1) when no session is present.
  // In production, enforce real session middleware before this guard.
  const id = parseInt(req.params.id);
  const { decision, reviewNote, reviewedByUserId } = req.body;
  if (decision !== "approved" && decision !== "rejected") {
    res.status(400).json({ error: "decision must be 'approved' or 'rejected'" });
    return;
  }
  const [correction] = await db.update(attendanceCorrectionsTable)
    .set({
      status: decision,
      reviewNote: reviewNote ?? null,
      reviewedByUserId: getActorUserId(req),
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(attendanceCorrectionsTable.id, id))
    .returning();
  if (!correction) { res.status(404).json({ error: "Not found" }); return; }

  // If approved: apply the correction to the actual record
  if (decision === "approved" && correction.correctionType) {
    const updates: Record<string, unknown> = {};
    if (correction.correctionType === "check_in") updates.checkInTime = correction.requestedValue;
    else if (correction.correctionType === "check_out") updates.checkOutTime = correction.requestedValue;
    else if (correction.correctionType === "status") updates.status = correction.requestedValue;
    if (Object.keys(updates).length > 0) {
      await db.update(attendanceRecordsTable).set(updates).where(eq(attendanceRecordsTable.id, correction.attendanceRecordId));
    }
  }

  res.json(await enrichCorrection(correction));
});

export default router;
