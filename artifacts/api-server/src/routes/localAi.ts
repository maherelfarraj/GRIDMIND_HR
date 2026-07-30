import { Router } from "express";
import { eq, desc, and, sql, like, or } from "drizzle-orm";
import {
  db,
  aiConfigTable,
  aiQueriesTable,
  aiPermissionsTable,
  auditLogsTable,
  enterpriseDocumentsTable,
  employeesTable,
} from "@workspace/db";

const router = Router();

// ─── helpers ─────────────────────────────────────────────────────────────────

async function getAiConfig() {
  const [cfg] = await db.select().from(aiConfigTable).where(eq(aiConfigTable.id, 1));
  return cfg ?? null;
}

async function logAiQuery(data: {
  featureType: string;
  queryText: string;
  responseText?: string | null;
  citationsJson?: string | null;
  modelUsed?: string | null;
  tokensUsed?: number | null;
  durationMs?: number | null;
  wasSimulated?: boolean;
  success?: boolean;
  errorMessage?: string | null;
  requestedByUserId?: number | null;
  entityType?: string | null;
  entityId?: number | null;
  ipAddress?: string | null;
}) {
  const [row] = await db.insert(aiQueriesTable).values({
    featureType: data.featureType,
    queryText: data.queryText,
    responseText: data.responseText ?? null,
    citationsJson: data.citationsJson ?? null,
    modelUsed: data.modelUsed ?? null,
    tokensUsed: data.tokensUsed ?? null,
    durationMs: data.durationMs ?? null,
    wasSimulated: data.wasSimulated ?? true,
    success: data.success ?? true,
    errorMessage: data.errorMessage ?? null,
    requestedByUserId: data.requestedByUserId ?? null,
    entityType: data.entityType ?? null,
    entityId: data.entityId ?? null,
    ipAddress: data.ipAddress ?? null,
  }).returning();
  return row;
}

// ─── GET /ai/config ───────────────────────────────────────────────────────────
router.get("/ai/config", async (req, res): Promise<void> => {
  try {
    const cfg = await getAiConfig();
    if (!cfg) { res.status(404).json({ error: "AI config not initialised" }); return; }
    res.json(cfg);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ─── PATCH /ai/config ─────────────────────────────────────────────────────────
router.patch("/ai/config", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const [row] = await db.update(aiConfigTable)
      .set({ ...req.body, updatedAt: new Date(), updatedByUserId: actorUserId })
      .where(eq(aiConfigTable.id, 1))
      .returning();
    if (!row) { res.status(404).json({ error: "AI config not found" }); return; }
    await db.insert(auditLogsTable).values({
      actorUserId,
      action: "update",
      entityType: "ai_config",
      entityId: 1,
      entityLabel: "AI Configuration",
      changesJson: JSON.stringify(req.body),
    });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ─── POST /ai/policy-search ───────────────────────────────────────────────────
router.post("/ai/policy-search", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const { query, limit: limitParam } = req.body as { query: string; limit?: number };
    const limit = limitParam ?? 5;
    const start = Date.now();
    const cfg = await getAiConfig();
    const ipAddress = (req as any).ip ?? null;

    // Always keyword search on enterpriseDocumentsTable
    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    let docs = await db.select({
      id: enterpriseDocumentsTable.id,
      titleEn: enterpriseDocumentsTable.titleEn,
      descriptionEn: enterpriseDocumentsTable.descriptionEn,
      documentNumber: enterpriseDocumentsTable.documentNumber,
      scope: enterpriseDocumentsTable.scope,
    }).from(enterpriseDocumentsTable).limit(200);

    // Score by term match count
    const scored = docs.map(doc => {
      const haystack = ((doc.titleEn ?? "") + " " + (doc.descriptionEn ?? "")).toLowerCase();
      const score = terms.filter(t => haystack.includes(t)).length;
      return { doc, score };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);

    const results = scored.map(({ doc, score }) => ({
      documentId: doc.id,
      title: doc.titleEn,
      excerpt: doc.descriptionEn ? doc.descriptionEn.slice(0, 200) : doc.titleEn,
      relevanceScore: score,
      documentNumber: doc.documentNumber,
    }));

    const citations = results.map(r => ({
      source: r.title,
      excerpt: r.excerpt,
      page: null,
    }));

    const durationMs = Date.now() - start;
    const modelUsed = cfg?.modelName ?? "llama3.2";
    const responseText = results.length > 0
      ? `Found ${results.length} document(s) matching "${query}".`
      : `No documents found matching "${query}".`;

    const auditRow = await logAiQuery({
      featureType: "policy_search",
      queryText: query,
      responseText,
      citationsJson: JSON.stringify(citations),
      modelUsed,
      tokensUsed: Math.floor(query.length / 4) + 50,
      durationMs,
      wasSimulated: true,
      success: true,
      requestedByUserId: actorUserId,
      ipAddress,
    });

    res.json({ results, model: modelUsed, simulated: true, auditId: auditRow.id });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ─── POST /ai/report-query ────────────────────────────────────────────────────
router.post("/ai/report-query", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const { query, context } = req.body as { query: string; context?: string };
    const start = Date.now();
    const cfg = await getAiConfig();
    const ipAddress = (req as any).ip ?? null;
    const q = query.toLowerCase();

    let interpretation = "";
    let suggestedReport = "";
    let previewRows: object[] = [];

    if (q.includes("headcount") || q.includes("employees") || q.includes("staff") || q.includes("department")) {
      interpretation = "Headcount by department";
      suggestedReport = "employees_by_department";
      const employees = await db.select({
        id: employeesTable.id,
        firstNameEn: employeesTable.firstNameEn,
        lastNameEn: employeesTable.lastNameEn,
        jobTitleEn: employeesTable.jobTitleEn,
        departmentId: employeesTable.departmentId,
        status: employeesTable.status,
      }).from(employeesTable).where(eq(employeesTable.status, "active")).limit(3);
      previewRows = employees;
    } else if (q.includes("leave") || q.includes("absence") || q.includes("vacation")) {
      interpretation = "Leave balances and requests";
      suggestedReport = "leave_balances_summary";
      previewRows = [
        { employeeId: 1, leaveType: "Annual Leave", balance: 14, used: 16, pending: 0 },
        { employeeId: 2, leaveType: "Annual Leave", balance: 22, used: 8, pending: 3 },
        { employeeId: 3, leaveType: "Sick Leave", balance: 10, used: 4, pending: 0 },
      ];
    } else if (q.includes("payroll") || q.includes("salary") || q.includes("pay")) {
      interpretation = "Payroll run summary";
      suggestedReport = "payroll_runs_summary";
      previewRows = [
        { runId: 1, period: "2024-12", totalGross: 158000, totalNet: 132000, employeeCount: 48, status: "finalized" },
        { runId: 2, period: "2024-11", totalGross: 154000, totalNet: 128000, employeeCount: 47, status: "finalized" },
        { runId: 3, period: "2024-10", totalGross: 151000, totalNet: 126000, employeeCount: 46, status: "finalized" },
      ];
    } else if (q.includes("contract") || q.includes("expir")) {
      interpretation = "Employees with expiring contracts";
      suggestedReport = "expiring_contracts";
      const employees = await db.select({
        id: employeesTable.id,
        firstNameEn: employeesTable.firstNameEn,
        lastNameEn: employeesTable.lastNameEn,
        contractEndDate: employeesTable.contractEndDate,
        jobTitleEn: employeesTable.jobTitleEn,
      }).from(employeesTable).limit(3);
      previewRows = employees;
    } else if (q.includes("overtime") || q.includes("hours")) {
      interpretation = "Overtime summary";
      suggestedReport = "overtime_summary";
      previewRows = [
        { employeeId: 5, name: "Hassan Al-Nouri", overtimeHours: 18, weeklyAvg: 4.5, period: "2024-12" },
        { employeeId: 12, name: "Fatima Al-Zahra", overtimeHours: 12, weeklyAvg: 3.0, period: "2024-12" },
        { employeeId: 8, name: "Omar Khalil", overtimeHours: 9, weeklyAvg: 2.25, period: "2024-12" },
      ];
    } else {
      interpretation = `General query: "${query}"`;
      suggestedReport = "general_hr_summary";
      previewRows = [
        { note: "No specific pattern matched. Try: headcount, leave, payroll, contracts, overtime." },
      ];
    }

    const durationMs = Date.now() - start;
    const modelUsed = cfg?.modelName ?? "llama3.2";

    const auditRow = await logAiQuery({
      featureType: "report_query",
      queryText: query,
      responseText: interpretation,
      modelUsed,
      tokensUsed: Math.floor(query.length / 4) + 80,
      durationMs,
      wasSimulated: true,
      success: true,
      requestedByUserId: actorUserId,
      ipAddress,
    });

    res.json({ interpretation, suggestedReport, previewRows, simulated: true, auditId: auditRow.id });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ─── POST /ai/classify-document ───────────────────────────────────────────────
router.post("/ai/classify-document", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const { documentId, title, content } = req.body as { documentId?: number; title: string; content?: string };
    const start = Date.now();
    const cfg = await getAiConfig();
    const ipAddress = (req as any).ip ?? null;

    const text = ((title ?? "") + " " + (content ?? "")).toLowerCase();

    type Category = "HR Policy" | "Employment Contract" | "Training Record" | "Medical" | "Financial" | "Legal" | "Correspondence" | "Other";

    const categoryRules: { keywords: string[]; category: Category; confidence: number }[] = [
      { keywords: ["contract", "employment", "appointment", "offer letter", "terms of employment"], category: "Employment Contract", confidence: 0.92 },
      { keywords: ["medical", "health", "sick", "physician", "certificate", "diagnosis", "treatment"], category: "Medical", confidence: 0.90 },
      { keywords: ["policy", "procedure", "hr policy", "regulation", "handbook", "guideline"], category: "HR Policy", confidence: 0.88 },
      { keywords: ["training", "course", "certificate", "workshop", "learning", "completion"], category: "Training Record", confidence: 0.87 },
      { keywords: ["financial", "finance", "invoice", "budget", "accounting", "payment", "salary", "payroll"], category: "Financial", confidence: 0.85 },
      { keywords: ["legal", "law", "court", "litigation", "compliance", "audit", "legal notice"], category: "Legal", confidence: 0.86 },
      { keywords: ["letter", "memo", "correspondence", "email", "notification", "circular"], category: "Correspondence", confidence: 0.80 },
    ];

    let suggestedCategory: Category = "Other";
    let confidence = 0.50;
    let reasoning = "No strong keyword match found; defaulting to 'Other'.";

    for (const rule of categoryRules) {
      const matchCount = rule.keywords.filter(k => text.includes(k)).length;
      if (matchCount > 0 && rule.confidence > confidence) {
        suggestedCategory = rule.category;
        confidence = rule.confidence - (matchCount === 1 ? 0.05 : 0);
        reasoning = `Matched keyword(s): ${rule.keywords.filter(k => text.includes(k)).join(", ")}.`;
      }
    }

    const durationMs = Date.now() - start;
    const modelUsed = cfg?.modelName ?? "llama3.2";

    const auditRow = await logAiQuery({
      featureType: "document_classify",
      queryText: title,
      responseText: `Category: ${suggestedCategory}`,
      modelUsed,
      tokensUsed: Math.floor((title.length + (content?.length ?? 0)) / 4) + 30,
      durationMs,
      wasSimulated: true,
      success: true,
      requestedByUserId: actorUserId,
      entityType: documentId != null ? "enterprise_document" : null,
      entityId: documentId ?? null,
      ipAddress,
    });

    res.json({ suggestedCategory, confidence, reasoning, simulated: true, auditId: auditRow.id });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ─── POST /ai/explain-anomaly ─────────────────────────────────────────────────
router.post("/ai/explain-anomaly", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const { anomalyType, entityId, metrics } = req.body as {
      anomalyType: "attendance_high" | "overtime_spike" | "payroll_variance" | "leave_exposure";
      entityId?: number;
      metrics: Record<string, unknown>;
    };
    const start = Date.now();
    const cfg = await getAiConfig();
    const ipAddress = (req as any).ip ?? null;

    let explanation = "";
    let riskLevel = "medium";
    let recommendations: string[] = [];

    switch (anomalyType) {
      case "attendance_high": {
        const absences = metrics.absences ?? "several";
        const threshold = metrics.threshold ?? 3;
        explanation = `Employee${entityId ? ` #${entityId}` : ""} has recorded ${absences} absences this period, which exceeds the ${threshold}-absence alert threshold. High absence rates can indicate personal health issues, disengagement, family pressures, or workplace dissatisfaction.`;
        riskLevel = Number(absences) >= 8 ? "high" : "medium";
        recommendations = [
          "Schedule a welfare check-in with the employee's line manager.",
          "Review attendance pattern over the last 3 months for recurring trends.",
          "Check if any FMLA or medical leave applications are pending.",
          "Consider an Employee Assistance Programme (EAP) referral if personal issues are indicated.",
        ];
        break;
      }
      case "overtime_spike": {
        const hours = metrics.overtimeHours ?? "significant";
        const avg = metrics.avgHours ?? "normal";
        explanation = `Employee${entityId ? ` #${entityId}` : ""} has accumulated ${hours} overtime hours this period, significantly above the ${avg}-hour baseline average. Sustained spikes can signal workload imbalance, understaffing, or scope creep in the role.`;
        riskLevel = Number(hours) >= 40 ? "high" : "medium";
        recommendations = [
          "Review whether the overtime was pre-approved and within policy limits.",
          "Assess departmental workload distribution for signs of staffing gaps.",
          "Monitor for burnout indicators over the next 4 weeks.",
          "Consider temporary resource augmentation if the spike persists.",
        ];
        break;
      }
      case "payroll_variance": {
        const variancePct = metrics.variancePct ?? "notable";
        const prev = metrics.previousRun ?? "prior period";
        const curr = metrics.currentRun ?? "current period";
        explanation = `A payroll variance of ${variancePct}% was detected between the previous run (${prev}) and the current run (${curr}). Significant variances require investigation to confirm legitimacy before finalisation.`;
        riskLevel = Number(variancePct) >= 10 ? "high" : "medium";
        recommendations = [
          "Compare employee headcount between both runs to identify joiners/leavers.",
          "Review salary adjustments and regrading actions processed this cycle.",
          "Check for overtime or bonus components added in this run.",
          "Obtain approval from Finance before processing if variance exceeds policy tolerance.",
        ];
        break;
      }
      case "leave_exposure": {
        const days = metrics.remainingDays ?? "high";
        explanation = `Employee${entityId ? ` #${entityId}` : ""} has ${days} outstanding leave days remaining in the current cycle. High leave balances create year-end financial liability and operational risk if leave is taken in bulk.`;
        riskLevel = Number(days) >= 20 ? "high" : "medium";
        recommendations = [
          "Notify the employee's manager to encourage phased leave planning.",
          "Issue a leave-balance reminder to the employee via the self-service portal.",
          "Assess if carry-forward limits apply and communicate the forfeiture date.",
          "Consider mandatory leave scheduling in low-demand periods.",
        ];
        break;
      }
      default: {
        explanation = `Anomaly of type '${anomalyType}' detected. Manual review recommended.`;
        riskLevel = "medium";
        recommendations = ["Review the flagged entity and consult HR Policy."];
      }
    }

    const durationMs = Date.now() - start;
    const modelUsed = cfg?.modelName ?? "llama3.2";

    const auditRow = await logAiQuery({
      featureType: "anomaly_explain",
      queryText: JSON.stringify({ anomalyType, entityId, metrics }),
      responseText: explanation,
      modelUsed,
      tokensUsed: Math.floor(explanation.length / 4) + 40,
      durationMs,
      wasSimulated: true,
      success: true,
      requestedByUserId: actorUserId,
      entityType: entityId != null ? "employee" : null,
      entityId: entityId ?? null,
      ipAddress,
    });

    res.json({ explanation, riskLevel, recommendations, simulated: true, auditId: auditRow.id });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ─── GET /ai/queries ──────────────────────────────────────────────────────────
router.get("/ai/queries", async (req, res): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;
    const { featureType, wasSimulated, success } = req.query as Record<string, string>;

    const conditions = [];
    if (featureType) conditions.push(eq(aiQueriesTable.featureType, featureType));
    if (wasSimulated !== undefined) conditions.push(eq(aiQueriesTable.wasSimulated, wasSimulated === "true"));
    if (success !== undefined) conditions.push(eq(aiQueriesTable.success, success === "true"));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [{ count }] = whereClause
      ? await db.select({ count: sql<number>`count(*)` }).from(aiQueriesTable).where(whereClause)
      : await db.select({ count: sql<number>`count(*)` }).from(aiQueriesTable);

    const rows = whereClause
      ? await db.select().from(aiQueriesTable).where(whereClause).orderBy(desc(aiQueriesTable.createdAt)).limit(limit).offset(offset)
      : await db.select().from(aiQueriesTable).orderBy(desc(aiQueriesTable.createdAt)).limit(limit).offset(offset);

    res.json({ data: rows, total: Number(count), page, limit });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ─── GET /ai/permissions ──────────────────────────────────────────────────────
router.get("/ai/permissions", async (req, res): Promise<void> => {
  try {
    const rows = await db.select().from(aiPermissionsTable).orderBy(aiPermissionsTable.id);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ─── PATCH /ai/permissions/:id ────────────────────────────────────────────────
router.patch("/ai/permissions/:id", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const id = parseInt(req.params.id);
    const [row] = await db.update(aiPermissionsTable)
      .set({ ...req.body, grantedByUserId: actorUserId, grantedAt: new Date() })
      .where(eq(aiPermissionsTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    await db.insert(auditLogsTable).values({
      actorUserId,
      action: "update",
      entityType: "ai_permission",
      entityId: id,
      entityLabel: `AI Permission #${id}`,
      changesJson: JSON.stringify(req.body),
    });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

export default router;
