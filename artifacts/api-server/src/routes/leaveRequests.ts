import { Router } from "express";
import {
  db, leaveRequestsTable, leaveTypesTable, leaveBalancesTable,
  leaveApprovalStepsTable, leaveAttachmentsTable, employeesTable, rostersTable, auditLogsTable,
} from "@workspace/db";
import { eq, and, gte, lte, or, between } from "drizzle-orm";

const router = Router();

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

  const conditions = [];
  if (employeeId) conditions.push(eq(leaveRequestsTable.employeeId, parseInt(employeeId, 10)));
  if (status) conditions.push(eq(leaveRequestsTable.status, status));
  if (leaveTypeId) conditions.push(eq(leaveRequestsTable.leaveTypeId, parseInt(leaveTypeId, 10)));
  if (startDate) conditions.push(gte(leaveRequestsTable.startDate, startDate));
  if (endDate) conditions.push(lte(leaveRequestsTable.endDate, endDate));

  const requests = conditions.length > 0
    ? await db.select().from(leaveRequestsTable).where(and(...conditions)).orderBy(leaveRequestsTable.createdAt)
    : await db.select().from(leaveRequestsTable).orderBy(leaveRequestsTable.createdAt);

  const emps = await db.select().from(employeesTable);
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
      submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    };
  });

  res.json(enriched);
});

// POST /leave-requests — create a new request (draft)
router.post("/leave-requests", async (req, res): Promise<void> => {
  const {
    employeeId, leaveTypeId, startDate, endDate, totalDays,
    halfDay, halfDayPeriod, reasonEn, reasonAr, coveringEmployeeId,
  } = req.body;

  if (!employeeId || !leaveTypeId || !startDate || !endDate || !totalDays) {
    res.status(400).json({ error: "employeeId, leaveTypeId, startDate, endDate, totalDays required" });
    return;
  }

  const requestNumber = genRequestNumber();
  const [request] = await db.insert(leaveRequestsTable).values({
    requestNumber,
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

// POST /leave-requests/:id/submit — move draft → submitted
router.post("/leave-requests/:id/submit", async (req, res): Promise<void> => {
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

  // Check balance availability
  const year = new Date(r.startDate).getFullYear();
  const [balance] = await db.select().from(leaveBalancesTable).where(
    and(
      eq(leaveBalancesTable.employeeId, r.employeeId),
      eq(leaveBalancesTable.leaveTypeId, r.leaveTypeId),
      eq(leaveBalancesTable.year, year),
    )
  );
  if (balance) {
    const available = parseFloat(balance.openingBalance) + parseFloat(balance.accrued) +
      parseFloat(balance.carriedOver) + parseFloat(balance.adjustment) -
      parseFloat(balance.used) - parseFloat(balance.pending);
    if (available < parseFloat(r.totalDays)) {
      res.status(422).json({
        error: "Insufficient leave balance",
        available: available.toFixed(1),
        requested: r.totalDays,
      });
      return;
    }
    // Reserve as pending
    await db.update(leaveBalancesTable)
      .set({ pending: String(parseFloat(balance.pending) + parseFloat(r.totalDays)) })
      .where(eq(leaveBalancesTable.id, balance.id));
  }

  const [updated] = await db.update(leaveRequestsTable)
    .set({ status: "submitted", submittedAt: new Date(), updatedAt: new Date() })
    .where(eq(leaveRequestsTable.id, id))
    .returning();

  await db.insert(auditLogsTable).values({
    action: "leave.submitted",
    entityType: "leave_request",
    entityId: id,
    entityLabel: r.requestNumber,
    changesJson: JSON.stringify({ status: "submitted" }),
  });

  res.json(await enrichRequest(updated));
});

// POST /leave-requests/:id/decide — approve or reject a step
router.post("/leave-requests/:id/decide", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { stepId, stepNumber, decision, notes, decidedByEmployeeId } = req.body;

  const [r] = await db.select().from(leaveRequestsTable).where(eq(leaveRequestsTable.id, id));
  if (!r) { res.status(404).json({ error: "Not found" }); return; }
  if (!["submitted", "under_review"].includes(r.status)) {
    res.status(400).json({ error: "Request is not pending a decision" });
    return;
  }

  // Accept stepId (preferred) or stepNumber (legacy)
  let step: typeof leaveApprovalStepsTable.$inferSelect | undefined;
  if (stepId) {
    const rows = await db.select().from(leaveApprovalStepsTable).where(
      and(
        eq(leaveApprovalStepsTable.id, stepId),
        eq(leaveApprovalStepsTable.leaveRequestId, id),
      )
    );
    step = rows[0];
  } else if (stepNumber !== undefined) {
    const rows = await db.select().from(leaveApprovalStepsTable).where(
      and(
        eq(leaveApprovalStepsTable.leaveRequestId, id),
        eq(leaveApprovalStepsTable.stepNumber, stepNumber),
      )
    );
    step = rows[0];
  }
  if (!step) { res.status(404).json({ error: "Approval step not found" }); return; }

  // Normalize decision: accept "approved"/"approve" and "rejected"/"reject"
  const isApprove = decision === "approved" || decision === "approve";
  const isReject = decision === "rejected" || decision === "reject";
  const normalizedDecision = isApprove ? "approved" : "rejected";

  await db.update(leaveApprovalStepsTable)
    .set({ status: normalizedDecision, decision: normalizedDecision, notes: notes ?? null, decidedAt: new Date() })
    .where(eq(leaveApprovalStepsTable.id, step.id));

  let newStatus = r.status;
  let newStep = r.currentStepNumber;

  if (isReject) {
    newStatus = "rejected";
    // Release pending balance
    const year = new Date(r.startDate).getFullYear();
    const [balance] = await db.select().from(leaveBalancesTable).where(
      and(
        eq(leaveBalancesTable.employeeId, r.employeeId),
        eq(leaveBalancesTable.leaveTypeId, r.leaveTypeId),
        eq(leaveBalancesTable.year, year),
      )
    );
    if (balance) {
      const newPending = Math.max(0, parseFloat(balance.pending) - parseFloat(r.totalDays));
      await db.update(leaveBalancesTable).set({ pending: String(newPending) }).where(eq(leaveBalancesTable.id, balance.id));
    }
  } else if (isApprove) {
    if (step.stepNumber >= r.totalApprovalSteps) {
      // Final approval
      newStatus = "approved";
      newStep = step.stepNumber;
      // Move pending → used
      const year = new Date(r.startDate).getFullYear();
      const [balance] = await db.select().from(leaveBalancesTable).where(
        and(
          eq(leaveBalancesTable.employeeId, r.employeeId),
          eq(leaveBalancesTable.leaveTypeId, r.leaveTypeId),
          eq(leaveBalancesTable.year, year),
        )
      );
      if (balance) {
        const days = parseFloat(r.totalDays);
        const newPending = Math.max(0, parseFloat(balance.pending) - days);
        const newUsed = parseFloat(balance.used) + days;
        await db.update(leaveBalancesTable)
          .set({ pending: String(newPending), used: String(newUsed) })
          .where(eq(leaveBalancesTable.id, balance.id));
      }
    } else {
      newStatus = "under_review";
      newStep = step.stepNumber + 1;
    }
  }

  const [updated] = await db.update(leaveRequestsTable)
    .set({ status: newStatus, currentStepNumber: newStep, decidedAt: newStatus === "approved" || newStatus === "rejected" ? new Date() : null, updatedAt: new Date() })
    .where(eq(leaveRequestsTable.id, id))
    .returning();

  await db.insert(auditLogsTable).values({
    action: `leave.${decision}d`,
    entityType: "leave_request",
    entityId: id,
    entityLabel: r.requestNumber,
    changesJson: JSON.stringify({ stepId: step.id, stepNumber: step.stepNumber, decision: normalizedDecision, notes }),
  });

  res.json(await enrichRequest(updated));
});

// POST /leave-requests/:id/cancel
router.post("/leave-requests/:id/cancel", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [r] = await db.select().from(leaveRequestsTable).where(eq(leaveRequestsTable.id, id));
  if (!r) { res.status(404).json({ error: "Not found" }); return; }
  if (["approved", "rejected", "cancelled"].includes(r.status)) {
    res.status(400).json({ error: `Cannot cancel a request in status: ${r.status}` });
    return;
  }

  // Release pending balance
  if (["submitted", "under_review"].includes(r.status)) {
    const year = new Date(r.startDate).getFullYear();
    const [balance] = await db.select().from(leaveBalancesTable).where(
      and(
        eq(leaveBalancesTable.employeeId, r.employeeId),
        eq(leaveBalancesTable.leaveTypeId, r.leaveTypeId),
        eq(leaveBalancesTable.year, year),
      )
    );
    if (balance) {
      const newPending = Math.max(0, parseFloat(balance.pending) - parseFloat(r.totalDays));
      await db.update(leaveBalancesTable).set({ pending: String(newPending) }).where(eq(leaveBalancesTable.id, balance.id));
    }
  }

  const [updated] = await db.update(leaveRequestsTable)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(leaveRequestsTable.id, id))
    .returning();

  res.json(await enrichRequest(updated));
});

// POST /leave-requests/:id/revoke — Task #9: revoke approved leave, restore balance + roster
router.post("/leave-requests/:id/revoke", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { reason } = req.body;
  const [r] = await db.select().from(leaveRequestsTable).where(eq(leaveRequestsTable.id, id));
  if (!r) { res.status(404).json({ error: "Not found" }); return; }
  if (r.status !== "approved") {
    res.status(400).json({ error: "Only approved leave requests can be revoked" });
    return;
  }

  // Restore used balance → deduct from used, release pending (there shouldn't be any, but guard)
  const year = new Date(r.startDate).getFullYear();
  const [balance] = await db.select().from(leaveBalancesTable).where(
    and(
      eq(leaveBalancesTable.employeeId, r.employeeId),
      eq(leaveBalancesTable.leaveTypeId, r.leaveTypeId),
      eq(leaveBalancesTable.year, year),
    )
  );
  if (balance) {
    const days = parseFloat(r.totalDays);
    const newUsed = Math.max(0, parseFloat(balance.used) - days);
    await db.update(leaveBalancesTable)
      .set({ used: String(newUsed), updatedAt: new Date() })
      .where(eq(leaveBalancesTable.id, balance.id));
  }

  // Restore roster entries: any roster row for this employee in [startDate, endDate]
  // with status="leave" → back to "scheduled"
  const rosterRows = await db.select().from(rostersTable).where(
    and(
      eq(rostersTable.employeeId, r.employeeId),
      eq(rostersTable.status, "leave"),
      between(rostersTable.date, r.startDate, r.endDate),
    )
  );
  for (const row of rosterRows) {
    await db.update(rostersTable)
      .set({ status: "scheduled", notes: `Reverted — leave revoked (${r.requestNumber})`, updatedAt: new Date() })
      .where(eq(rostersTable.id, row.id));
  }

  const [updated] = await db.update(leaveRequestsTable)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(leaveRequestsTable.id, id))
    .returning();

  await db.insert(auditLogsTable).values({
    action: "leave.revoked",
    entityType: "leave_request",
    entityId: id,
    entityLabel: r.requestNumber,
    changesJson: JSON.stringify({ reason: reason ?? null, rosterRowsRestored: rosterRows.length }),
  });

  res.json(await enrichRequest(updated));
});

// POST /leave-requests/:id/return-to-duty
router.post("/leave-requests/:id/return-to-duty", async (req, res): Promise<void> => {
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
    changesJson: JSON.stringify({ returnDate }),
  });

  res.json(await enrichRequest(updated));
});

// POST /leave-requests/:id/attachments
router.post("/leave-requests/:id/attachments", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { fileName, fileType, fileSize, fileUrl } = req.body;
  if (!fileName) { res.status(400).json({ error: "fileName required" }); return; }
  const [att] = await db.insert(leaveAttachmentsTable).values({
    leaveRequestId: id, fileName, fileType: fileType ?? null,
    fileSize: fileSize ?? null, fileUrl: fileUrl ?? null,
  }).returning();
  res.status(201).json(att);
});

// GET /leave-requests/calendar?startDate=&endDate=&departmentId= — calendar overlay data
router.get("/leave-calendar", async (req, res): Promise<void> => {
  const { startDate, endDate, departmentId } = req.query as Record<string, string>;

  const conditions = [
    or(eq(leaveRequestsTable.status, "approved"), eq(leaveRequestsTable.status, "under_review")),
  ];
  if (startDate) conditions.push(gte(leaveRequestsTable.startDate, startDate));
  if (endDate) conditions.push(lte(leaveRequestsTable.endDate, endDate));

  const requests = await db.select().from(leaveRequestsTable).where(and(...conditions));

  const emps = await db.select().from(employeesTable);
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
