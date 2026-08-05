import { Router } from "express";
import {
  db, leaveRequestsTable, leaveTypesTable, leaveBalancesTable,
  leaveApprovalStepsTable, leaveAttachmentsTable, employeesTable, rostersTable, auditLogsTable,
  approvalsTable,
} from "@workspace/db";
import { eq, and, gte, lte, or, sql, inArray } from "drizzle-orm";
import { ensureLeaveBalance } from "../lib/leaveBalance.js";
import { decideLeaveStep, syncLinkedApprovalStatus } from "../lib/leaveDecision.js";
import { getActorUserId } from "../middleware/requireAuth.js";

import { resolveOrgId } from "../lib/orgContext";

const router = Router();

// Org-ownership guard: every /leave-requests/:id route 404s when the request
// belongs to a different organization than the active org context.
router.param("id", async (req, res, next, rawId) => {
  try {
    const id = parseInt(rawId, 10);
    if (!Number.isInteger(id)) { res.status(404).json({ error: "Not found" }); return; }
    const [row] = await db.select({ orgId: leaveRequestsTable.orgId })
      .from(leaveRequestsTable).where(eq(leaveRequestsTable.id, id));
    if (!row || row.orgId !== (await resolveOrgId(req))) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    next();
  } catch (err) { next(err); }
});

function datesInRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const cur = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

function rosterMarker(requestNumber: string): string {
  return `leave:${requestNumber}`;
}


function genRequestNumber(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const rand = String(Math.floor(Math.random() * 9000) + 1000);
  return `LV-${y}${m}-${rand}`;
}

async function enrichRequest(r: typeof leaveRequestsTable.$inferSelect) {
  const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, r.employeeId));
  const [lt] = await db.select().from(leaveTypesTable).where(eq(leaveTypesTable.id, r.leaveTypeId));
  let coveringName: string | null = null;
  if (r.coveringEmployeeId) {
    const [c] = await db.select().from(employeesTable).where(eq(employeesTable.id, r.coveringEmployeeId));
    if (c) coveringName = `${c.firstNameEn} ${c.lastNameEn}`;
  }
  const steps = await db.select().from(leaveApprovalStepsTable)
    .where(eq(leaveApprovalStepsTable.leaveRequestId, r.id))
    .orderBy(leaveApprovalStepsTable.stepNumber);
  const attachments = await db.select().from(leaveAttachmentsTable)
    .where(eq(leaveAttachmentsTable.leaveRequestId, r.id));
  return {
    ...r,
    employeeNameEn: emp ? `${emp.firstNameEn} ${emp.lastNameEn}` : "Unknown",
    employeeNameAr: emp ? `${emp.firstNameAr} ${emp.lastNameAr}` : "Unknown",
    departmentId: emp?.departmentId ?? null,
    leaveTypeNameEn: lt?.nameEn ?? "Unknown",
    leaveTypeNameAr: lt?.nameAr ?? "Unknown",
    leaveTypeColor: lt?.color ?? "#6366F1",
    leaveTypeCategory: lt?.category ?? "general",
    requiresAttachment: lt?.requiresAttachment ?? false,
    coveringEmployeeNameEn: coveringName,
    submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    steps: steps.map(s => ({
      ...s,
      decidedAt: s.decidedAt ? s.decidedAt.toISOString() : null,
    })),
    attachments,
  };
}

// GET /leave-requests?employeeId=&status=&leaveTypeId=&startDate=&endDate=&departmentId=
router.get("/leave-requests", async (req, res): Promise<void> => {
  const { employeeId, status, leaveTypeId, startDate, endDate } = req.query as Record<string, string>;

  const orgId = await resolveOrgId(req);

  const conditions: any[] = [eq(leaveRequestsTable.orgId, orgId)];
  if (employeeId) conditions.push(eq(leaveRequestsTable.employeeId, parseInt(employeeId, 10)));
  if (status) {
    // Support comma-separated status list
    const statuses = status.split(",").map(s => s.trim());
    if (statuses.length === 1) {
      conditions.push(eq(leaveRequestsTable.status, statuses[0]));
    } else {
      conditions.push(or(...statuses.map(s => eq(leaveRequestsTable.status, s))) as any);
    }
  }
  if (leaveTypeId) conditions.push(eq(leaveRequestsTable.leaveTypeId, parseInt(leaveTypeId, 10)));
  if (startDate) conditions.push(gte(leaveRequestsTable.startDate, startDate));
  if (endDate) conditions.push(lte(leaveRequestsTable.endDate, endDate));

  const requests = await db.select().from(leaveRequestsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(leaveRequestsTable.createdAt);

  const emps = await db.select().from(employeesTable).where(eq(employeesTable.orgId, orgId));
  const types = await db.select().from(leaveTypesTable);
  const empMap = Object.fromEntries(emps.map(e => [e.id, e]));
  const typeMap = Object.fromEntries(types.map(t => [t.id, t]));

  const enriched = requests.map(r => {
    const emp = empMap[r.employeeId];
    const lt = typeMap[r.leaveTypeId];
    return {
      ...r,
      employeeNameEn: emp ? `${emp.firstNameEn} ${emp.lastNameEn}` : "Unknown",
      employeeNameAr: emp ? `${emp.firstNameAr} ${emp.lastNameAr}` : "Unknown",
      departmentId: emp?.departmentId ?? null,
      leaveTypeNameEn: lt?.nameEn ?? "Unknown",
      leaveTypeNameAr: lt?.nameAr ?? "Unknown",
      leaveTypeColor: lt?.color ?? "#6366F1",
      leaveTypeCategory: lt?.category ?? "general",
      requiresAttachment: lt?.requiresAttachment ?? false,
      submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    };
  });

  res.json(enriched);
});

// POST /leave-requests — create a new request (draft)
router.post("/leave-requests", async (req, res): Promise<void> => {
  const actorUserId: number = getActorUserId(req);

  const {
    employeeId, leaveTypeId, startDate, endDate, totalDays,
    halfDay, halfDayPeriod, reasonEn, reasonAr, coveringEmployeeId,
  } = req.body;

  if (!employeeId || !leaveTypeId || !startDate || !endDate || !totalDays) {
    res.status(400).json({ error: "employeeId, leaveTypeId, startDate, endDate, totalDays required" });
    return;
  }

  const requestNumber = genRequestNumber();
  // Requests inherit the employee's org; the employee must belong to the
  // active org context (no cross-org creation by supplying a foreign id).
  const ctxOrgId = await resolveOrgId(req);
  const [reqEmp] = await db.select().from(employeesTable).where(eq(employeesTable.id, employeeId));
  if (!reqEmp || reqEmp.orgId !== ctxOrgId) {
    res.status(404).json({ error: "Employee not found" });
    return;
  }
  const [request] = await db.insert(leaveRequestsTable).values({
    requestNumber,
    orgId: reqEmp.orgId,
    employeeId, leaveTypeId, startDate, endDate,
    totalDays: String(totalDays),
    halfDay: halfDay ?? false,
    halfDayPeriod: halfDayPeriod ?? null,
    reasonEn: reasonEn ?? null,
    reasonAr: reasonAr ?? null,
    status: "draft",
    coveringEmployeeId: coveringEmployeeId ?? null,
    currentStepNumber: 1,
    totalApprovalSteps: 2,
  }).returning();

  // Auto-create approval steps
  await db.insert(leaveApprovalStepsTable).values([
    { leaveRequestId: request.id, stepNumber: 1, roleRequired: "department_manager", status: "pending" },
    { leaveRequestId: request.id, stepNumber: 2, roleRequired: "hr_director", status: "pending" },
  ]);

  await db.insert(auditLogsTable).values({
    action: "leave.created",
    entityType: "leave_request",
    entityId: request.id,
    entityLabel: requestNumber,
    actorUserId,
    changesJson: JSON.stringify({ employeeId, leaveTypeId, startDate, endDate, totalDays }),
  });

  res.status(201).json(await enrichRequest(request));
});

// GET /leave-requests/:id
router.get("/leave-requests/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [r] = await db.select().from(leaveRequestsTable).where(eq(leaveRequestsTable.id, id));
  if (!r) { res.status(404).json({ error: "Not found" }); return; }
  res.json(await enrichRequest(r));
});

// POST /leave-requests/:id/submit — move draft → submitted, check cert + reserve balance
router.post("/leave-requests/:id/submit", async (req, res): Promise<void> => {
  const actorUserId: number = getActorUserId(req);
  const id = parseInt(req.params.id, 10);
  const [r] = await db.select().from(leaveRequestsTable).where(eq(leaveRequestsTable.id, id));
  if (!r) { res.status(404).json({ error: "Not found" }); return; }
  if (r.status !== "draft") { res.status(400).json({ error: "Only draft requests can be submitted" }); return; }

  // Task #8: enforce medical certificate for leave types that require attachments
  const [lt] = await db.select().from(leaveTypesTable).where(eq(leaveTypesTable.id, r.leaveTypeId));
  if (lt?.requiresAttachment) {
    const attachments = await db.select().from(leaveAttachmentsTable)
      .where(eq(leaveAttachmentsTable.leaveRequestId, id));
    if (attachments.length === 0) {
      res.status(422).json({
        error: "A medical certificate or supporting document is required for this leave type",
        code: "ATTACHMENT_REQUIRED",
      });
      return;
    }
  }

  // Task #19: check balance availability + reserve pending atomically with a
  // SELECT ... FOR UPDATE row lock (same pattern as the decide route), so two
  // simultaneous submissions cannot both pass the availability check.
  // ensureLeaveBalance is race-safe (unique constraint + insert-on-conflict),
  // so exactly one row exists before we lock it.
  const year = new Date(r.startDate).getFullYear();
  await ensureLeaveBalance(r.employeeId, r.leaveTypeId, year);
  let updated: typeof leaveRequestsTable.$inferSelect;
  try {
    updated = await db.transaction(async (tx) => {
      const [lockedReq] = await tx.select().from(leaveRequestsTable)
        .where(eq(leaveRequestsTable.id, id))
        .for("update");
      if (!lockedReq || lockedReq.status !== "draft") {
        throw Object.assign(new Error("Only draft requests can be submitted"), { httpStatus: 400 });
      }

      const [balance] = await tx.select().from(leaveBalancesTable).where(
        and(
          eq(leaveBalancesTable.employeeId, r.employeeId),
          eq(leaveBalancesTable.leaveTypeId, r.leaveTypeId),
          eq(leaveBalancesTable.year, year),
        )
      ).for("update");
      if (balance) {
        const available = parseFloat(balance.openingBalance) + parseFloat(balance.accrued) +
          parseFloat(balance.carriedOver) + parseFloat(balance.adjustment) -
          parseFloat(balance.used) - parseFloat(balance.pending);
        if (available < parseFloat(r.totalDays)) {
          throw Object.assign(new Error("Insufficient leave balance"), {
            httpStatus: 422,
            payload: { available: available.toFixed(1), requested: r.totalDays },
          });
        }
        await tx.update(leaveBalancesTable)
          .set({ pending: String(parseFloat(balance.pending) + parseFloat(r.totalDays)), updatedAt: new Date() })
          .where(eq(leaveBalancesTable.id, balance.id));
      }

      const [row] = await tx.update(leaveRequestsTable)
        .set({ status: "submitted", submittedAt: new Date(), updatedAt: new Date() })
        .where(eq(leaveRequestsTable.id, id))
        .returning();
      return row;
    });
  } catch (err: any) {
    if (err?.httpStatus) {
      res.status(err.httpStatus).json({ error: err.message, ...(err.payload ?? {}) });
      return;
    }
    throw err;
  }

  // Surface in the supervisor approvals queue (/approvals)
  const [empRow] = await db.select().from(employeesTable).where(eq(employeesTable.id, r.employeeId));
  const attachmentRows = await db.select().from(leaveAttachmentsTable)
    .where(eq(leaveAttachmentsTable.leaveRequestId, r.id));
  await db.insert(approvalsTable).values({
    type: "leave",
    titleEn: `Leave Request ${r.requestNumber} — ${lt?.nameEn ?? "Leave"}`,
    titleAr: `طلب إجازة ${r.requestNumber} — ${lt?.nameAr ?? "إجازة"}`,
    status: "pending",
    priority: "normal",
    requestedByEmployeeId: r.employeeId,
    dueDate: r.startDate,
    metadata: JSON.stringify({
      leave_request_id: r.id,
      request_number: r.requestNumber,
      leave_type: lt?.nameEn ?? "Unknown",
      employee: empRow ? `${empRow.firstNameEn} ${empRow.lastNameEn}` : "Unknown",
      dates: `${r.startDate} → ${r.endDate}`,
      total_days: r.totalDays,
      attachments: attachmentRows.length,
    }),
  });

  await db.insert(auditLogsTable).values({
    action: "leave.submitted",
    entityType: "leave_request",
    entityId: id,
    entityLabel: r.requestNumber,
    actorUserId,
    changesJson: JSON.stringify({ status: "submitted" }),
  });

  res.json(await enrichRequest(updated));
});

// POST /leave-requests/:id/decide — approve or reject an approval step (Task #18: row-locked)
// Core logic lives in lib/leaveDecision.ts so the /approvals route can share it (Task #13).
router.post("/leave-requests/:id/decide", async (req, res): Promise<void> => {
  const actorUserId: number = getActorUserId(req);
  const id = parseInt(req.params.id, 10);
  const { stepId, stepNumber, decision, notes } = req.body;

  try {
    const { request } = await decideLeaveStep({
      leaveRequestId: id, stepId, stepNumber, decision, notes, actorUserId,
    });
    res.json(await enrichRequest(request));
  } catch (err: any) {
    if (err?.httpStatus) {
      res.status(err.httpStatus).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
      return;
    }
    throw err;
  }
});

// POST /leave-requests/:id/cancel — cancel a draft or pending request, release pending balance
router.post("/leave-requests/:id/cancel", async (req, res): Promise<void> => {
  const actorUserId: number = getActorUserId(req);
  const id = parseInt(req.params.id, 10);
  const [r] = await db.select().from(leaveRequestsTable).where(eq(leaveRequestsTable.id, id));
  if (!r) { res.status(404).json({ error: "Not found" }); return; }
  if (!["draft", "submitted", "under_review"].includes(r.status)) {
    res.status(400).json({ error: "Only draft or pending requests can be cancelled. Use /revoke for approved leaves." });
    return;
  }

  // Task #179: run the cancel atomically. The status change is a conditional
  // claim (WHERE status still cancellable) so two concurrent cancels — or a
  // cancel racing a decide — can't both win and release the pending
  // reservation twice.
  let updated: typeof leaveRequestsTable.$inferSelect;
  try {
    updated = await db.transaction(async (tx) => {
      const [claimed] = await tx.update(leaveRequestsTable)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(and(
          eq(leaveRequestsTable.id, id),
          inArray(leaveRequestsTable.status, ["draft", "submitted", "under_review"]),
        ))
        .returning();
      if (!claimed) {
        throw Object.assign(
          new Error("Request was already decided or cancelled"),
          { httpStatus: 409 },
        );
      }

      // Release the pending reservation in a single atomic conditional update;
      // GREATEST keeps pending from going negative.
      if (parseFloat(r.totalDays) > 0) {
        const year = new Date(r.startDate).getFullYear();
        await tx.update(leaveBalancesTable)
          .set({
            pending: sql`GREATEST(${leaveBalancesTable.pending} - ${r.totalDays}::numeric, 0)`,
            updatedAt: new Date(),
          })
          .where(and(
            eq(leaveBalancesTable.employeeId, r.employeeId),
            eq(leaveBalancesTable.leaveTypeId, r.leaveTypeId),
            eq(leaveBalancesTable.year, year),
          ));
      }

      return claimed;
    });
  } catch (err: any) {
    if (err?.httpStatus) {
      res.status(err.httpStatus).json({ error: err.message });
      return;
    }
    throw err;
  }

  // Task #13: keep the /approvals queue entry in sync
  await syncLinkedApprovalStatus(id, "cancelled");

  await db.insert(auditLogsTable).values({
    action: "leave.cancelled",
    entityType: "leave_request",
    entityId: id,
    entityLabel: r.requestNumber,
    actorUserId,
    changesJson: JSON.stringify({ previousStatus: r.status }),
  });

  res.json(await enrichRequest(updated));
});

// POST /leave-requests/:id/revoke — undo an approved leave (fully or shorten the range)
router.post("/leave-requests/:id/revoke", async (req, res): Promise<void> => {
  const actorUserId: number = getActorUserId(req);
  const id = parseInt(req.params.id, 10);
  const { reason, newEndDate, revokedByEmployeeId } = req.body;

  if (!reason || typeof reason !== "string" || !reason.trim()) {
    res.status(400).json({ error: "reason is required" });
    return;
  }

  const [r] = await db.select().from(leaveRequestsTable).where(eq(leaveRequestsTable.id, id));
  if (!r) { res.status(404).json({ error: "Not found" }); return; }
  if (r.status !== "approved") {
    res.status(400).json({ error: "Only approved leaves can be revoked" });
    return;
  }

  // Partial revoke: shorten the range to end at newEndDate (must be within the original range)
  const isPartial = newEndDate != null && newEndDate !== "";
  if (isPartial) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newEndDate)) {
      res.status(400).json({ error: "newEndDate must be YYYY-MM-DD" });
      return;
    }
    if (newEndDate < r.startDate || newEndDate >= r.endDate) {
      res.status(400).json({ error: "newEndDate must be within the leave range and before the current end date" });
      return;
    }
  }

  const totalDays = parseFloat(r.totalDays);
  const allDates = datesInRange(r.startDate, r.endDate);
  const revokedDates = isPartial
    ? allDates.filter(d => d > newEndDate)
    : allDates;
  // Credit back days proportionally to the calendar days being revoked
  const creditedDays = isPartial
    ? Math.round((totalDays * revokedDates.length / allDates.length) * 10) / 10
    : totalDays;
  const remainingDays = Math.max(0, Math.round((totalDays - creditedDays) * 10) / 10);

  const marker = rosterMarker(r.requestNumber);
  const revokedStart = revokedDates[0];
  const revokedEnd = revokedDates[revokedDates.length - 1];

  const updated = await db.transaction(async (tx) => {
    // 1. Credit balance back
    const year = new Date(r.startDate).getFullYear();
    const [balance] = await tx.select().from(leaveBalancesTable).where(
      and(
        eq(leaveBalancesTable.employeeId, r.employeeId),
        eq(leaveBalancesTable.leaveTypeId, r.leaveTypeId),
        eq(leaveBalancesTable.year, year),
      )
    ).for("update");
    if (balance) {
      const newUsed = Math.max(0, parseFloat(balance.used) - creditedDays);
      await tx.update(leaveBalancesTable)
        .set({ used: String(newUsed), updatedAt: new Date() })
        .where(eq(leaveBalancesTable.id, balance.id));
    }

    // 2. Restore roster for revoked dates: delete rows created by the approval,
    //    revert others marked "leave" back to "scheduled"
    const rosterRows = await tx.select().from(rostersTable).where(
      and(
        eq(rostersTable.employeeId, r.employeeId),
        gte(rostersTable.date, revokedStart),
        lte(rostersTable.date, revokedEnd),
      )
    );
    for (const row of rosterRows) {
      if (row.notes === marker) {
        await tx.delete(rostersTable).where(eq(rostersTable.id, row.id));
      } else if (row.status === "leave") {
        await tx.update(rostersTable)
          .set({ status: "scheduled", notes: `Reverted — leave revoked (${r.requestNumber})`, updatedAt: new Date() })
          .where(eq(rostersTable.id, row.id));
      }
    }

    // 3. Update the request itself
    const [u] = await tx.update(leaveRequestsTable)
      .set(isPartial
        ? { endDate: newEndDate, totalDays: String(remainingDays), updatedAt: new Date() }
        : { status: "revoked", updatedAt: new Date() })
      .where(eq(leaveRequestsTable.id, id))
      .returning();

    // 4. Audit trail
    await tx.insert(auditLogsTable).values({
      action: isPartial ? "leave.revoked_partial" : "leave.revoked",
      entityType: "leave_request",
      entityId: id,
      entityLabel: r.requestNumber,
      actorUserId,
      changesJson: JSON.stringify({
        reason,
        revokedByEmployeeId: revokedByEmployeeId ?? null,
        revokedFrom: revokedStart,
        revokedTo: revokedEnd,
        creditedDays,
        ...(isPartial ? { newEndDate, remainingDays } : {}),
      }),
    });

    return u;
  });

  res.json(await enrichRequest(updated));
});

// POST /leave-requests/:id/return — record employee's return to work after approved leave
router.post("/leave-requests/:id/return", async (req, res): Promise<void> => {
  const actorUserId: number = getActorUserId(req);
  const id = parseInt(req.params.id, 10);
  const { returnDate, returnNotes } = req.body;
  const [r] = await db.select().from(leaveRequestsTable).where(eq(leaveRequestsTable.id, id));
  if (!r) { res.status(404).json({ error: "Not found" }); return; }
  if (r.status !== "approved") { res.status(400).json({ error: "Only approved leaves can record return-to-duty" }); return; }

  const [updated] = await db.update(leaveRequestsTable)
    .set({ returnedToWork: true, returnDate: returnDate ?? null, returnNotes: returnNotes ?? null, updatedAt: new Date() })
    .where(eq(leaveRequestsTable.id, id))
    .returning();

  await db.insert(auditLogsTable).values({
    action: "leave.returned",
    entityType: "leave_request",
    entityId: id,
    entityLabel: r.requestNumber,
    actorUserId,
    changesJson: JSON.stringify({ returnDate }),
  });

  res.json(await enrichRequest(updated));
});

// POST /leave-requests/:id/attachments — upload a supporting document (medical cert etc.)
router.post("/leave-requests/:id/attachments", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { fileName, fileType, fileSize, fileUrl } = req.body;
  if (!fileName) { res.status(400).json({ error: "fileName required" }); return; }
  // Only allow safe URL schemes: https, or data: URLs with whitelisted document/image MIME types.
  if (fileUrl != null) {
    const safeDataUrl = /^data:(application\/pdf|image\/(png|jpe?g|webp|gif));base64,[A-Za-z0-9+/=]+$/i;
    const isHttps = /^https:\/\//i.test(fileUrl);
    if (typeof fileUrl !== "string" || (!isHttps && !safeDataUrl.test(fileUrl))) {
      res.status(400).json({ error: "fileUrl must be an https URL or a base64 data URL of type pdf/png/jpeg/webp/gif" });
      return;
    }
  }
  const [att] = await db.insert(leaveAttachmentsTable).values({
    leaveRequestId: id, fileName, fileType: fileType ?? null,
    fileSize: fileSize ?? null, fileUrl: fileUrl ?? null,
  }).returning();
  res.status(201).json(att);
});

// GET /leave-calendar?startDate=&endDate=&departmentId= — calendar overlay data
router.get("/leave-calendar", async (req, res): Promise<void> => {
  const orgId = await resolveOrgId(req);
  const { startDate, endDate, departmentId } = req.query as Record<string, string>;

  const conditions: any[] = [
    eq(leaveRequestsTable.orgId, orgId),
    or(eq(leaveRequestsTable.status, "approved"), eq(leaveRequestsTable.status, "under_review")) as any,
  ];
  if (startDate) conditions.push(gte(leaveRequestsTable.startDate, startDate));
  if (endDate) conditions.push(lte(leaveRequestsTable.endDate, endDate));

  const requests = await db.select().from(leaveRequestsTable).where(and(...conditions));

  const emps = await db.select().from(employeesTable).where(eq(employeesTable.orgId, orgId));
  const types = await db.select().from(leaveTypesTable);
  const empMap = Object.fromEntries(emps.map(e => [e.id, e]));
  const typeMap = Object.fromEntries(types.map(t => [t.id, t]));

  let result = requests.map(r => {
    const emp = empMap[r.employeeId];
    const lt = typeMap[r.leaveTypeId];
    return {
      id: r.id,
      requestNumber: r.requestNumber,
      employeeId: r.employeeId,
      employeeNameEn: emp ? `${emp.firstNameEn} ${emp.lastNameEn}` : "Unknown",
      departmentId: emp?.departmentId ?? null,
      startDate: r.startDate,
      endDate: r.endDate,
      totalDays: r.totalDays,
      status: r.status,
      leaveTypeNameEn: lt?.nameEn ?? "Unknown",
      leaveTypeColor: lt?.color ?? "#6366F1",
    };
  });

  if (departmentId) {
    result = result.filter(r => r.departmentId === parseInt(departmentId, 10));
  }

  res.json(result);
});

export default router;
