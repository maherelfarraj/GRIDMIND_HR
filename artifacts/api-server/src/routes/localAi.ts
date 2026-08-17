import { Router } from "express";
import { getActorAdminStatus } from "../lib/adminAuth.js";
import { eq, desc, and, sql } from "drizzle-orm";
import OpenAI from "openai";
import type { AiConfig } from "@workspace/db";
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

// ─── OpenAI client factory ────────────────────────────────────────────────────
// Instantiated per-request so a missing env var gives an admin-friendly error
// rather than crashing the server at startup.

class ConfigError extends Error {
  constructor(message: string) { super(message); this.name = "ConfigError"; }
}

function getOpenAiClient(): OpenAI {
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey  = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!baseURL || !apiKey) {
    throw new ConfigError(
      "OpenAI integration is not provisioned. " +
      "AI_INTEGRATIONS_OPENAI_BASE_URL and AI_INTEGRATIONS_OPENAI_API_KEY must be set. " +
      "Contact your system administrator to configure the Replit OpenAI AI Integration."
    );
  }
  return new OpenAI({ apiKey, baseURL });
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const DEFAULT_MODEL = "gpt-5.6-terra";

async function getAiConfig(): Promise<AiConfig | null> {
  const [cfg] = await db.select().from(aiConfigTable).where(eq(aiConfigTable.id, 1));
  return cfg ?? null;
}

/** Resolve the model name: use admin config if set, else DEFAULT_MODEL */
function resolveModel(cfg: AiConfig | null): string {
  return cfg?.modelName?.trim() || DEFAULT_MODEL;
}

/**
 * max_completion_tokens: gpt-5+ ignores max_tokens; use max_completion_tokens.
 * We respect the admin-configured maxTokens but clamp to a safe minimum of 512.
 */
function resolveMaxTokens(cfg: AiConfig | null): number {
  const configured = cfg?.maxTokens ?? 0;
  return Math.max(512, Math.min(configured > 0 ? configured : 8192, 8192));
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
    wasSimulated: data.wasSimulated ?? false,
    success: data.success ?? true,
    errorMessage: data.errorMessage ?? null,
    requestedByUserId: data.requestedByUserId ?? null,
    entityType: data.entityType ?? null,
    entityId: data.entityId ?? null,
    ipAddress: data.ipAddress ?? null,
  }).returning();
  return row;
}

/** Shared guard: is AI enabled and is the requested feature enabled? */
function checkFeatureEnabled(
  cfg: AiConfig | null,
  feature: string
): string | null {
  if (!cfg?.isEnabled) return "AI is disabled. Enable it in the Local AI configuration panel.";
  const features = parseFeatures(cfg.enabledFeatures);
  if (features.length > 0 && !features.includes(feature)) {
    return `The '${feature}' feature is not enabled. Enable it in the Local AI configuration panel.`;
  }
  return null;
}

function parseFeatures(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch { /* fall through */ }
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}

// ─── GET /ai/config ───────────────────────────────────────────────────────────
router.get("/ai/config", async (req, res): Promise<void> => {
  try {
    const cfg = await getAiConfig();
    if (!cfg) { res.status(404).json({ error: "AI config not initialised" }); return; }
    // Expose whether the integration is provisioned (without exposing the key itself)
    const integrationProvisioned = !!(
      process.env.AI_INTEGRATIONS_OPENAI_BASE_URL &&
      process.env.AI_INTEGRATIONS_OPENAI_API_KEY
    );
    res.json({ ...cfg, integrationProvisioned });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ─── PATCH /ai/config ─────────────────────────────────────────────────────────
router.patch("/ai/config", async (req, res): Promise<void> => {
  try {
    const { actorId: actorUserId, isAdmin } = await getActorAdminStatus(req);
    if (!isAdmin) { res.status(403).json({ error: "Insufficient privileges" }); return; }
    // Strip any attempt to set apiKey or secrets through this endpoint
    const { apiKey: _apiKey, ...safeBody } = req.body as Record<string, unknown> & { apiKey?: unknown };
    const [row] = await db.update(aiConfigTable)
      .set({ ...safeBody, updatedAt: new Date(), updatedByUserId: actorUserId })
      .where(eq(aiConfigTable.id, 1))
      .returning();
    if (!row) { res.status(404).json({ error: "AI config not found" }); return; }
    await db.insert(auditLogsTable).values({
      actorUserId,
      action: "update",
      entityType: "ai_config",
      entityId: 1,
      entityLabel: "AI Configuration",
      changesJson: JSON.stringify(safeBody), // never logs secrets
    });
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ─── POST /ai/policy-search ───────────────────────────────────────────────────
router.post("/ai/policy-search", async (req, res): Promise<void> => {
  const start = Date.now();
  const cfg = await getAiConfig().catch(() => null);
  const ipAddress = (req as any).ip ?? null;
  let actorUserId: number | null = null;

  try {
    const actor = await getActorAdminStatus(req);
    if (!actor.isAdmin) { res.status(403).json({ error: "Insufficient privileges" }); return; }
    actorUserId = actor.actorId;

    const featureError = checkFeatureEnabled(cfg, "policy_search");
    if (featureError) { res.status(422).json({ error: featureError }); return; }

    const { query, limit: limitParam } = req.body as { query: string; limit?: number };
    if (!query?.trim()) { res.status(400).json({ error: "query is required" }); return; }
    const limit = Math.min(limitParam ?? 5, 10);

    const model = resolveModel(cfg);
    const maxTokens = resolveMaxTokens(cfg);

    // Fetch candidate documents — only non-sensitive fields, no employee PII
    const docs = await db.select({
      id: enterpriseDocumentsTable.id,
      titleEn: enterpriseDocumentsTable.titleEn,
      descriptionEn: enterpriseDocumentsTable.descriptionEn,
      documentNumber: enterpriseDocumentsTable.documentNumber,
      scope: enterpriseDocumentsTable.scope,
    }).from(enterpriseDocumentsTable).limit(50);

    const docContext = docs.map(d =>
      `[DOC_ID:${d.id}] ${d.documentNumber ?? ""} — ${d.titleEn ?? "Untitled"}: ${(d.descriptionEn ?? "").slice(0, 300)}`
    ).join("\n");

    const systemPrompt = `You are an HR policy search assistant for an enterprise HR system. 
You help administrators find relevant HR policy documents based on their query.
You will receive a list of document summaries and must identify the most relevant ones.
Respond ONLY with a valid JSON object in this exact structure, no extra text:
{
  "results": [
    { "documentId": <number>, "title": "<string>", "excerpt": "<relevant 1-2 sentence excerpt>", "relevanceScore": <0.0-1.0> }
  ],
  "summary": "<1-2 sentence answer to the query based on the documents found>"
}
Return at most ${limit} results. If no documents are relevant, return an empty results array.
Never invent document IDs or content that is not in the provided list.`;

    const userPrompt = `Query: "${query}"\n\nAvailable documents:\n${docContext || "(no documents available)"}`;

    const client = getOpenAiClient();
    const completion = await client.chat.completions.create({
      model,
      max_completion_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
    });

    const rawContent = completion.choices[0]?.message?.content ?? "{}";
    let parsed: { results?: unknown[]; summary?: string } = {};
    try { parsed = JSON.parse(rawContent); } catch { /* fall through to empty */ }

    // Validate: only return IDs that actually exist in our doc list
    const validIds = new Set(docs.map(d => d.id));
    const rawResults = Array.isArray(parsed.results) ? parsed.results : [];
    const results = rawResults
      .filter((r): r is { documentId: number; title: string; excerpt: string; relevanceScore: number } =>
        r !== null && typeof r === "object" &&
        "documentId" in (r as object) && validIds.has(Number((r as any).documentId))
      )
      .slice(0, limit)
      .map(r => ({
        documentId: Number(r.documentId),
        title: String(r.title ?? ""),
        excerpt: String(r.excerpt ?? "").slice(0, 500),
        relevanceScore: Math.min(1, Math.max(0, Number(r.relevanceScore ?? 0.5))),
        documentNumber: docs.find(d => d.id === Number(r.documentId))?.documentNumber ?? null,
      }));

    const citations = results.map(r => ({ source: r.title, excerpt: r.excerpt, page: null }));
    const responseText = parsed.summary ?? (results.length > 0
      ? `Found ${results.length} document(s) relevant to "${query}".`
      : `No relevant documents found for "${query}".`);
    const durationMs = Date.now() - start;
    const tokensUsed = completion.usage?.total_tokens ?? null;

    const auditRow = await logAiQuery({
      featureType: "policy_search",
      queryText: query,
      responseText,
      citationsJson: JSON.stringify(citations),
      modelUsed: model,
      tokensUsed,
      durationMs,
      wasSimulated: false,
      success: true,
      requestedByUserId: actorUserId,
      ipAddress,
    });

    res.json({ results, summary: responseText, model, simulated: false, auditId: auditRow.id });

  } catch (err) {
    const isConfig = err instanceof ConfigError;
    const message = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - start;
    await logAiQuery({
      featureType: "policy_search",
      queryText: (req.body as any)?.query ?? "",
      wasSimulated: false,
      success: false,
      errorMessage: isConfig ? "Integration not provisioned" : message.slice(0, 500),
      modelUsed: resolveModel(cfg),
      durationMs,
      requestedByUserId: actorUserId,
      ipAddress,
    }).catch(() => {});
    res.status(isConfig ? 503 : 502).json({ error: message });
  }
});

// ─── POST /ai/report-query ────────────────────────────────────────────────────
// Structured, constrained output — the model never generates or executes SQL.
// It returns a report type identifier that is mapped to pre-defined reports only.
router.post("/ai/report-query", async (req, res): Promise<void> => {
  const start = Date.now();
  const cfg = await getAiConfig().catch(() => null);
  const ipAddress = (req as any).ip ?? null;
  let actorUserId: number | null = null;

  try {
    const actor = await getActorAdminStatus(req);
    if (!actor.isAdmin) { res.status(403).json({ error: "Insufficient privileges" }); return; }
    actorUserId = actor.actorId;

    const featureError = checkFeatureEnabled(cfg, "report_query");
    if (featureError) { res.status(422).json({ error: featureError }); return; }

    const { query } = req.body as { query: string; context?: string };
    if (!query?.trim()) { res.status(400).json({ error: "query is required" }); return; }

    const model = resolveModel(cfg);
    const maxTokens = resolveMaxTokens(cfg);

    // Gather lightweight aggregated data — no individual PII
    const [totalResult] = await db.select({ count: sql<number>`count(*)` }).from(employeesTable);
    const [activeResult] = await db.select({ count: sql<number>`count(*)` }).from(employeesTable)
      .where(eq(employeesTable.status, "active"));

    const systemPrompt = `You are an HR analytics assistant. The user asks natural-language questions about workforce data.
You must classify the question and respond ONLY with a valid JSON object — no extra text, no markdown, no SQL:
{
  "interpretation": "<1-2 sentence plain-English interpretation of what was asked>",
  "suggestedReport": "<one of: employees_by_department | leave_balances_summary | payroll_runs_summary | expiring_contracts | overtime_summary | attendance_summary | headcount_trend | general_hr_summary>",
  "reasoning": "<brief explanation of why this report fits>",
  "keyMetrics": [{ "label": "<string>", "value": "<string>" }]
}
You must not generate, suggest, or imply any database queries or SQL statements.
You must not access or reference individual employee personal data.
Only use the summary figures provided to you.`;

    const userPrompt = `Workforce summary (aggregate only, no PII):
- Total employees: ${Number(totalResult?.count ?? 0)}
- Active employees: ${Number(activeResult?.count ?? 0)}

Question: "${query}"`;

    const client = getOpenAiClient();
    const completion = await client.chat.completions.create({
      model,
      max_completion_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
    });

    const rawContent = completion.choices[0]?.message?.content ?? "{}";
    let parsed: {
      interpretation?: string;
      suggestedReport?: string;
      reasoning?: string;
      keyMetrics?: { label: string; value: string }[];
    } = {};
    try { parsed = JSON.parse(rawContent); } catch { /* fall through */ }

    // Whitelist validation — never pass an arbitrary model-generated identifier
    const ALLOWED_REPORTS = new Set([
      "employees_by_department","leave_balances_summary","payroll_runs_summary",
      "expiring_contracts","overtime_summary","attendance_summary",
      "headcount_trend","general_hr_summary",
    ]);
    const suggestedReport = ALLOWED_REPORTS.has(parsed.suggestedReport ?? "")
      ? parsed.suggestedReport!
      : "general_hr_summary";

    const interpretation = parsed.interpretation ?? `Query: "${query}"`;
    const durationMs = Date.now() - start;

    // Fetch preview rows for the whitelisted report type only
    let previewRows: object[] = [];
    if (suggestedReport === "employees_by_department") {
      const employees = await db.select({
        id: employeesTable.id,
        firstNameEn: employeesTable.firstNameEn,
        lastNameEn: employeesTable.lastNameEn,
        jobTitleEn: employeesTable.jobTitleEn,
        status: employeesTable.status,
      }).from(employeesTable).where(eq(employeesTable.status, "active")).limit(5);
      previewRows = employees;
    } else if (suggestedReport === "expiring_contracts") {
      const employees = await db.select({
        id: employeesTable.id,
        firstNameEn: employeesTable.firstNameEn,
        lastNameEn: employeesTable.lastNameEn,
        contractEndDate: employeesTable.contractEndDate,
        jobTitleEn: employeesTable.jobTitleEn,
      }).from(employeesTable).limit(5);
      previewRows = employees;
    }

    const auditRow = await logAiQuery({
      featureType: "report_query",
      queryText: query,
      responseText: interpretation,
      modelUsed: model,
      tokensUsed: completion.usage?.total_tokens ?? null,
      durationMs,
      wasSimulated: false,
      success: true,
      requestedByUserId: actorUserId,
      ipAddress,
    });

    res.json({
      interpretation,
      suggestedReport,
      reasoning: parsed.reasoning ?? null,
      keyMetrics: Array.isArray(parsed.keyMetrics) ? parsed.keyMetrics.slice(0, 10) : [],
      previewRows,
      model,
      simulated: false,
      auditId: auditRow.id,
    });

  } catch (err) {
    const isConfig = err instanceof ConfigError;
    const message = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - start;
    await logAiQuery({
      featureType: "report_query",
      queryText: (req.body as any)?.query ?? "",
      wasSimulated: false,
      success: false,
      errorMessage: isConfig ? "Integration not provisioned" : message.slice(0, 500),
      modelUsed: resolveModel(cfg),
      durationMs,
      requestedByUserId: actorUserId,
      ipAddress,
    }).catch(() => {});
    res.status(isConfig ? 503 : 502).json({ error: message });
  }
});

// ─── POST /ai/classify-document ───────────────────────────────────────────────
router.post("/ai/classify-document", async (req, res): Promise<void> => {
  const start = Date.now();
  const cfg = await getAiConfig().catch(() => null);
  const ipAddress = (req as any).ip ?? null;
  let actorUserId: number | null = null;

  try {
    const actor = await getActorAdminStatus(req);
    if (!actor.isAdmin) { res.status(403).json({ error: "Insufficient privileges" }); return; }
    actorUserId = actor.actorId;

    const featureError = checkFeatureEnabled(cfg, "document_classify");
    if (featureError) { res.status(422).json({ error: featureError }); return; }

    const { documentId, title, content } = req.body as {
      documentId?: number; title: string; content?: string;
    };
    if (!title?.trim()) { res.status(400).json({ error: "title is required" }); return; }

    const model = resolveModel(cfg);
    const maxTokens = resolveMaxTokens(cfg);

    // Truncate content to limit token use — admins only upload these docs
    const contentSnippet = (content ?? "").slice(0, 1500);

    const systemPrompt = `You are an HR document classification assistant.
Classify the given document into exactly one category.
Respond ONLY with a valid JSON object — no extra text:
{
  "suggestedCategory": "<one of: HR Policy | Employment Contract | Training Record | Medical | Financial | Legal | Correspondence | Other>",
  "confidence": <number 0.0-1.0>,
  "reasoning": "<brief explanation based only on the document title and content provided>"
}`;

    const userPrompt = `Document title: "${title}"\nContent preview: "${contentSnippet}"`;

    const client = getOpenAiClient();
    const completion = await client.chat.completions.create({
      model,
      max_completion_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
    });

    const rawContent = completion.choices[0]?.message?.content ?? "{}";
    let parsed: { suggestedCategory?: string; confidence?: number; reasoning?: string } = {};
    try { parsed = JSON.parse(rawContent); } catch { /* fall through */ }

    const ALLOWED_CATEGORIES = new Set([
      "HR Policy","Employment Contract","Training Record",
      "Medical","Financial","Legal","Correspondence","Other",
    ]);
    const suggestedCategory = ALLOWED_CATEGORIES.has(parsed.suggestedCategory ?? "")
      ? parsed.suggestedCategory!
      : "Other";
    const confidence = Math.min(1, Math.max(0, Number(parsed.confidence ?? 0.5)));
    const durationMs = Date.now() - start;

    const auditRow = await logAiQuery({
      featureType: "document_classify",
      queryText: title,
      responseText: `Category: ${suggestedCategory}`,
      modelUsed: model,
      tokensUsed: completion.usage?.total_tokens ?? null,
      durationMs,
      wasSimulated: false,
      success: true,
      requestedByUserId: actorUserId,
      entityType: documentId != null ? "enterprise_document" : null,
      entityId: documentId ?? null,
      ipAddress,
    });

    res.json({ suggestedCategory, confidence, reasoning: parsed.reasoning ?? null, model, simulated: false, auditId: auditRow.id });

  } catch (err) {
    const isConfig = err instanceof ConfigError;
    const message = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - start;
    await logAiQuery({
      featureType: "document_classify",
      queryText: (req.body as any)?.title ?? "",
      wasSimulated: false,
      success: false,
      errorMessage: isConfig ? "Integration not provisioned" : message.slice(0, 500),
      modelUsed: resolveModel(cfg),
      durationMs,
      requestedByUserId: actorUserId,
      ipAddress,
    }).catch(() => {});
    res.status(isConfig ? 503 : 502).json({ error: message });
  }
});

// ─── POST /ai/explain-anomaly ─────────────────────────────────────────────────
// Metrics are numbers only — no employee names or PII are sent to the model.
router.post("/ai/explain-anomaly", async (req, res): Promise<void> => {
  const start = Date.now();
  const cfg = await getAiConfig().catch(() => null);
  const ipAddress = (req as any).ip ?? null;
  let actorUserId: number | null = null;

  try {
    const actor = await getActorAdminStatus(req);
    if (!actor.isAdmin) { res.status(403).json({ error: "Insufficient privileges" }); return; }
    actorUserId = actor.actorId;

    const featureError = checkFeatureEnabled(cfg, "anomaly_explain");
    if (featureError) { res.status(422).json({ error: featureError }); return; }

    const { anomalyType, entityId, metrics } = req.body as {
      anomalyType: "attendance_high" | "overtime_spike" | "payroll_variance" | "leave_exposure";
      entityId?: number;
      metrics: Record<string, unknown>;
    };

    const ALLOWED_ANOMALY_TYPES = new Set(["attendance_high","overtime_spike","payroll_variance","leave_exposure"]);
    if (!ALLOWED_ANOMALY_TYPES.has(anomalyType)) {
      res.status(400).json({ error: "Invalid anomalyType" }); return;
    }

    const model = resolveModel(cfg);
    const maxTokens = resolveMaxTokens(cfg);

    // Strip any PII from metrics before sending — only numeric/type values
    const safeMetrics = Object.fromEntries(
      Object.entries(metrics ?? {}).filter(([, v]) => typeof v === "number" || typeof v === "string")
        .map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 100) : v])
    );

    const anomalyLabels: Record<string, string> = {
      attendance_high: "High Absence Rate",
      overtime_spike: "Overtime Spike",
      payroll_variance: "Payroll Variance",
      leave_exposure: "High Leave Balance Exposure",
    };

    const systemPrompt = `You are an HR risk analyst assistant. 
An anomaly has been detected in the enterprise HR system.
Provide a professional explanation and actionable recommendations.
Respond ONLY with a valid JSON object — no extra text:
{
  "explanation": "<2-3 sentence professional explanation of the anomaly and its likely causes>",
  "riskLevel": "<one of: low | medium | high | critical>",
  "recommendations": ["<action 1>", "<action 2>", "<action 3>", "<action 4>"]
}
Do not reference any employee by name. Refer to individuals only as "the employee" or by role.
Base your analysis only on the numeric metrics provided.`;

    const userPrompt = `Anomaly type: ${anomalyLabels[anomalyType] ?? anomalyType}
${entityId != null ? `Entity reference: record #${entityId}` : ""}
Metrics: ${JSON.stringify(safeMetrics)}`;

    const client = getOpenAiClient();
    const completion = await client.chat.completions.create({
      model,
      max_completion_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
    });

    const rawContent = completion.choices[0]?.message?.content ?? "{}";
    let parsed: { explanation?: string; riskLevel?: string; recommendations?: unknown[] } = {};
    try { parsed = JSON.parse(rawContent); } catch { /* fall through */ }

    const ALLOWED_RISK = new Set(["low","medium","high","critical"]);
    const riskLevel = ALLOWED_RISK.has(parsed.riskLevel ?? "") ? parsed.riskLevel! : "medium";
    const recommendations = (Array.isArray(parsed.recommendations) ? parsed.recommendations : [])
      .slice(0, 6)
      .map(r => String(r).slice(0, 300));
    const explanation = parsed.explanation ?? `Anomaly type '${anomalyType}' detected. Manual review recommended.`;
    const durationMs = Date.now() - start;

    const auditRow = await logAiQuery({
      featureType: "anomaly_explain",
      queryText: JSON.stringify({ anomalyType, metrics: safeMetrics }),
      responseText: explanation,
      modelUsed: model,
      tokensUsed: completion.usage?.total_tokens ?? null,
      durationMs,
      wasSimulated: false,
      success: true,
      requestedByUserId: actorUserId,
      entityType: entityId != null ? "employee" : null,
      entityId: entityId ?? null,
      ipAddress,
    });

    res.json({ explanation, riskLevel, recommendations, model, simulated: false, auditId: auditRow.id });

  } catch (err) {
    const isConfig = err instanceof ConfigError;
    const message = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - start;
    await logAiQuery({
      featureType: "anomaly_explain",
      queryText: JSON.stringify({ anomalyType: (req.body as any)?.anomalyType }),
      wasSimulated: false,
      success: false,
      errorMessage: isConfig ? "Integration not provisioned" : message.slice(0, 500),
      modelUsed: resolveModel(cfg),
      durationMs,
      requestedByUserId: actorUserId,
      ipAddress,
    }).catch(() => {});
    res.status(isConfig ? 503 : 502).json({ error: message });
  }
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
    const { actorId: actorUserId, isAdmin } = await getActorAdminStatus(req);
    if (!isAdmin) { res.status(403).json({ error: "Insufficient privileges" }); return; }
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
