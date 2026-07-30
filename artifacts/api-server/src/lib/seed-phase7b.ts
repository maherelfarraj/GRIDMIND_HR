/**
 * Phase 7B+7C seed — Integration Administration Center + Local AI Layer.
 * Run with: npx tsx artifacts/api-server/src/lib/seed-phase7b.ts
 */
import { db } from "@workspace/db";
import {
  integrationConnectorsTable,
  connectionHealthLogTable,
  integrationRetryQueueTable,
  integrationEventLogTable,
  aiConfigTable,
  aiPermissionsTable,
  aiQueriesTable,
} from "@workspace/db";

async function main() {
  console.log("🌱 Seeding Phase 7B+7C — Integration Center + Local AI...");

  // ─── CLEAN ─────────────────────────────────────────────────────────────────
  console.log("  → cleaning phase 7B+7C tables");
  await db.delete(aiQueriesTable);
  await db.delete(aiPermissionsTable);
  await db.delete(aiConfigTable);
  await db.delete(integrationEventLogTable);
  await db.delete(integrationRetryQueueTable);
  await db.delete(connectionHealthLogTable);
  await db.delete(integrationConnectorsTable);

  // ─── INTEGRATION CONNECTORS ─────────────────────────────────────────────────
  console.log("  → integration_connectors");
  const now = new Date();
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);

  const [conn1, conn2, conn3, conn4, conn5, conn6, conn7, conn8] = await db
    .insert(integrationConnectorsTable)
    .values([
      {
        nameEn: "Attendance Device Network",
        nameAr: "شبكة أجهزة الحضور",
        connectorType: "attendance_device",
        protocol: "rest_api",
        endpoint: "http://10.0.1.50/api",
        portNumber: 8080,
        useTls: false,
        timeoutSeconds: 15,
        status: "healthy",
        lastTestedAt: hoursAgo(1),
        lastSuccessAt: hoursAgo(1),
        simulatedLabel: "⚠ Simulated — Biometric Device API",
        descriptionEn: "Connects to the biometric attendance device network for real-time punch data.",
        descriptionAr: "يتصل بشبكة أجهزة الحضور البيومترية للحصول على بيانات البصمة في الوقت الفعلي.",
        sortOrder: 1,
      },
      {
        nameEn: "Active Directory",
        nameAr: "الدليل النشط",
        connectorType: "active_directory",
        protocol: "ldap",
        endpoint: "ldap://dc01.internal.local",
        portNumber: 389,
        useTls: false,
        timeoutSeconds: 30,
        status: "degraded",
        lastTestedAt: hoursAgo(3),
        lastSuccessAt: hoursAgo(24),
        lastErrorMessage: "LDAP bind failed: account locked after 3 failed attempts",
        simulatedLabel: "⚠ Simulated — LDAP/AD Integration",
        descriptionEn: "Synchronises user accounts and groups with Windows Active Directory.",
        descriptionAr: "تزامن حسابات المستخدمين والمجموعات مع Active Directory.",
        sortOrder: 2,
      },
      {
        nameEn: "Email Gateway",
        nameAr: "بوابة البريد الإلكتروني",
        connectorType: "email_gateway",
        protocol: "smtp",
        endpoint: "smtp.mail.internal",
        portNumber: 587,
        useTls: true,
        credentialsJson: '{"username":"hrms@example.internal","password":"[DEMO]"}',
        timeoutSeconds: 20,
        status: "healthy",
        lastTestedAt: hoursAgo(0.5),
        lastSuccessAt: hoursAgo(0.5),
        simulatedLabel: "⚠ Simulated — SMTP Relay",
        descriptionEn: "SMTP relay for sending system notifications, payslips, and HR communications.",
        descriptionAr: "بوابة SMTP لإرسال الإشعارات وكشوف الرواتب والمراسلات الإدارية.",
        sortOrder: 3,
      },
      {
        nameEn: "SMS Gateway",
        nameAr: "بوابة الرسائل القصيرة",
        connectorType: "sms_gateway",
        protocol: "rest_api",
        endpoint: null,
        portNumber: null,
        useTls: true,
        timeoutSeconds: 15,
        status: "unconfigured",
        simulatedLabel: "⚠ Simulated — SMS Provider API",
        descriptionEn: "REST API integration with SMS provider for OTP and emergency notifications.",
        descriptionAr: "تكامل REST API مع مزود الرسائل القصيرة للرموز المؤقتة وإشعارات الطوارئ.",
        sortOrder: 4,
      },
      {
        nameEn: "ERP Finance Export",
        nameAr: "تصدير نظام ERP المالي",
        connectorType: "erp_finance",
        protocol: "rest_api",
        endpoint: "https://erp.finance.internal/api/v2",
        portNumber: 443,
        useTls: true,
        credentialsJson: '{"apiKey":"[DEMO]","tenantId":"hrms-001"}',
        timeoutSeconds: 60,
        status: "error",
        lastTestedAt: hoursAgo(2),
        lastErrorMessage: "HTTP 503 — ERP service unavailable. Retry scheduled.",
        simulatedLabel: "⚠ Simulated — ERP/Finance API",
        descriptionEn: "Exports payroll and GL entries to the ERP/Finance system.",
        descriptionAr: "يصدر قيود الرواتب والأستاذ العام إلى نظام تخطيط موارد المؤسسات.",
        sortOrder: 5,
      },
      {
        nameEn: "Offline File Exchange",
        nameAr: "تبادل الملفات دون اتصال",
        connectorType: "file_exchange",
        protocol: "file",
        endpoint: "/data/exchange",
        portNumber: null,
        useTls: false,
        timeoutSeconds: 120,
        status: "healthy",
        lastTestedAt: hoursAgo(6),
        lastSuccessAt: hoursAgo(6),
        simulatedLabel: "Offline File Import/Export",
        descriptionEn: "Flat-file CSV/XML exchange for branch offices without direct network connectivity.",
        descriptionAr: "تبادل ملفات CSV/XML للمكاتب الفرعية غير المتصلة بالشبكة مباشرة.",
        sortOrder: 6,
      },
      {
        nameEn: "LDAP Directory",
        nameAr: "دليل LDAP",
        connectorType: "ldap",
        protocol: "ldap",
        endpoint: "ldap://ldap.internal.local",
        portNumber: 636,
        useTls: true,
        timeoutSeconds: 30,
        status: "healthy",
        lastTestedAt: hoursAgo(4),
        lastSuccessAt: hoursAgo(4),
        descriptionEn: "Generic LDAP directory integration for external identity providers.",
        descriptionAr: "تكامل دليل LDAP العام لموفري الهوية الخارجيين.",
        sortOrder: 7,
      },
      {
        nameEn: "Custom HR API",
        nameAr: "واجهة برمجة HR مخصصة",
        connectorType: "custom",
        protocol: "rest_api",
        endpoint: null,
        portNumber: null,
        useTls: false,
        timeoutSeconds: 30,
        status: "unconfigured",
        descriptionEn: "Custom REST API integration endpoint for bespoke third-party HR tools.",
        descriptionAr: "نقطة تكامل REST API مخصصة لأدوات HR الخارجية.",
        sortOrder: 8,
      },
    ])
    .returning();

  // ─── CONNECTION HEALTH LOG ──────────────────────────────────────────────────
  console.log("  → connection_health_log");
  const healthEntries = [];

  // Last 10 tests for connector 1 (attendance device) — all success
  for (let i = 0; i < 10; i++) {
    healthEntries.push({
      connectorId: conn1.id,
      testedAt: hoursAgo(i * 0.5),
      success: true,
      latencyMs: 40 + Math.floor(Math.random() * 60),
      checkedByUserId: 1,
    });
  }

  // 10 entries for connector 3 (email gateway) — all success
  for (let i = 0; i < 10; i++) {
    healthEntries.push({
      connectorId: conn3.id,
      testedAt: hoursAgo(i * 1),
      success: true,
      latencyMs: 80 + Math.floor(Math.random() * 40),
      checkedByUserId: 1,
    });
  }

  // Alternating success/failure for conn 2 (Active Directory — degraded)
  for (let i = 0; i < 6; i++) {
    const success = i % 2 === 0;
    healthEntries.push({
      connectorId: conn2.id,
      testedAt: hoursAgo(i * 2),
      success,
      latencyMs: success ? 120 : null,
      errorMessage: success ? null : "LDAP bind failed: account locked after 3 failed attempts",
      checkedByUserId: 1,
    });
  }

  // A few error entries for conn 5 (ERP — error status)
  for (let i = 0; i < 4; i++) {
    healthEntries.push({
      connectorId: conn5.id,
      testedAt: hoursAgo(i + 0.5),
      success: false,
      latencyMs: null,
      errorMessage: "HTTP 503 — ERP service unavailable",
      checkedByUserId: 1,
    });
  }

  await db.insert(connectionHealthLogTable).values(healthEntries);

  // ─── INTEGRATION RETRY QUEUE ───────────────────────────────────────────────
  console.log("  → integration_retry_queue");
  const retryNow = new Date();
  const minutesFromNow = (m: number) => new Date(retryNow.getTime() + m * 60_000);
  const minutesAgo = (m: number) => new Date(retryNow.getTime() - m * 60_000);

  await db.insert(integrationRetryQueueTable).values([
    {
      connectorId: conn5.id,
      operationType: "payroll_export",
      payloadJson: JSON.stringify({ runId: 42, period: "2024-12", amount: 158000.00 }),
      attemptCount: 3,
      maxAttempts: 5,
      nextRetryAt: minutesFromNow(15),
      lastError: "HTTP 503 — ERP service unavailable",
      status: "retrying",
      createdAt: minutesAgo(90),
      updatedAt: minutesAgo(5),
    },
    {
      connectorId: conn5.id,
      operationType: "gl_entry_post",
      payloadJson: JSON.stringify({ glBatch: "GL-2024-1201", entries: 48 }),
      attemptCount: 5,
      maxAttempts: 5,
      nextRetryAt: minutesAgo(10),
      lastError: "Connection timeout after 60s",
      status: "abandoned",
      createdAt: minutesAgo(300),
      updatedAt: minutesAgo(10),
    },
    {
      connectorId: conn2.id,
      operationType: "user_sync",
      payloadJson: JSON.stringify({ employeeId: 101, action: "create_account" }),
      attemptCount: 1,
      maxAttempts: 5,
      nextRetryAt: minutesFromNow(30),
      lastError: "LDAP bind failed: account locked",
      status: "pending",
      createdAt: minutesAgo(45),
      updatedAt: minutesAgo(15),
    },
    {
      connectorId: conn2.id,
      operationType: "group_membership_update",
      payloadJson: JSON.stringify({ employeeId: 87, groups: ["HR_Staff", "Finance_View"] }),
      attemptCount: 2,
      maxAttempts: 5,
      nextRetryAt: minutesFromNow(60),
      lastError: "LDAP bind failed: timeout",
      status: "pending",
      createdAt: minutesAgo(120),
      updatedAt: minutesAgo(30),
    },
    {
      connectorId: conn1.id,
      operationType: "punch_sync",
      payloadJson: JSON.stringify({ deviceId: "DEV-007", dateRange: "2024-12-01/2024-12-07" }),
      attemptCount: 0,
      maxAttempts: 5,
      nextRetryAt: minutesFromNow(5),
      lastError: null,
      status: "pending",
      createdAt: minutesAgo(2),
      updatedAt: minutesAgo(2),
    },
  ]);

  // ─── INTEGRATION EVENT LOG ──────────────────────────────────────────────────
  console.log("  → integration_event_log");
  const eventEntries = [];

  // Connector 1 — attendance device sync events
  for (let i = 0; i < 7; i++) {
    eventEntries.push({
      connectorId: conn1.id,
      eventType: "sync",
      direction: "inbound",
      entityType: "punch_event",
      entityCount: 48 + i * 3,
      success: true,
      durationMs: 1200 + i * 80,
      messageEn: `Attendance sync completed — ${48 + i * 3} punch events imported`,
      actorUserId: 1,
      occurredAt: hoursAgo((7 - i) * 4),
    });
  }

  // Connector 2 — AD test & error events
  eventEntries.push(
    {
      connectorId: conn2.id,
      eventType: "test",
      direction: "outbound",
      success: true,
      durationMs: 145,
      messageEn: "LDAP connectivity test passed",
      actorUserId: 1,
      occurredAt: hoursAgo(26),
    },
    {
      connectorId: conn2.id,
      eventType: "error",
      direction: "outbound",
      success: false,
      durationMs: 30005,
      messageEn: "LDAP bind failed: account locked",
      detailsJson: JSON.stringify({ code: "ECONNRESET", retry: true }),
      actorUserId: 1,
      occurredAt: hoursAgo(5),
    },
    {
      connectorId: conn2.id,
      eventType: "retry",
      direction: "outbound",
      entityType: "user_account",
      entityCount: 1,
      success: false,
      durationMs: 15000,
      messageEn: "Retry #2 of user_sync for employee 101 — failed",
      actorUserId: 1,
      occurredAt: hoursAgo(3),
    }
  );

  // Connector 3 — email gateway events
  for (let i = 0; i < 5; i++) {
    eventEntries.push({
      connectorId: conn3.id,
      eventType: "sync",
      direction: "outbound",
      entityType: "email_notification",
      entityCount: 12 + i * 2,
      success: true,
      durationMs: 380 + i * 30,
      messageEn: `Email batch sent — ${12 + i * 2} notifications delivered`,
      actorUserId: 1,
      occurredAt: hoursAgo((5 - i) * 3),
    });
  }

  // Connector 5 — ERP error events
  for (let i = 0; i < 5; i++) {
    eventEntries.push({
      connectorId: conn5.id,
      eventType: "error",
      direction: "outbound",
      entityType: "payroll_export",
      success: false,
      durationMs: 60001,
      messageEn: `ERP export failed — HTTP 503 Service Unavailable (attempt ${i + 1})`,
      detailsJson: JSON.stringify({ httpStatus: 503, attempt: i + 1 }),
      actorUserId: 1,
      occurredAt: hoursAgo((5 - i) * 0.5),
    });
  }

  // Config change events
  eventEntries.push(
    {
      connectorId: conn3.id,
      eventType: "config_change",
      direction: "internal",
      success: true,
      messageEn: "Email Gateway TLS enabled by admin",
      actorUserId: 1,
      occurredAt: hoursAgo(48),
    },
    {
      connectorId: conn6.id,
      eventType: "sync",
      direction: "inbound",
      entityType: "employee_record",
      entityCount: 22,
      success: true,
      durationMs: 2800,
      messageEn: "Offline file import — 22 employee records processed",
      actorUserId: 1,
      occurredAt: hoursAgo(8),
    },
    {
      connectorId: conn7.id,
      eventType: "test",
      direction: "outbound",
      success: true,
      durationMs: 210,
      messageEn: "LDAP directory test passed",
      actorUserId: 1,
      occurredAt: hoursAgo(5),
    },
    {
      connectorId: null,
      eventType: "config_change",
      direction: "internal",
      success: true,
      messageEn: "Integration configuration updated — system-level change",
      actorUserId: 1,
      occurredAt: hoursAgo(72),
    }
  );

  await db.insert(integrationEventLogTable).values(eventEntries);

  // ─── AI CONFIG ──────────────────────────────────────────────────────────────
  console.log("  → ai_config");
  await db.insert(aiConfigTable).values({
    id: 1,
    modelEndpoint: null,
    modelName: "llama3.2",
    isEnabled: false,
    enabledFeatures: JSON.stringify([]),
    maxTokens: 2048,
    temperatureX100: 70,
    requireApprovalForBulk: true,
    auditAllQueries: true,
    updatedByUserId: 1,
  });

  // ─── AI PERMISSIONS ─────────────────────────────────────────────────────────
  console.log("  → ai_permissions");
  await db.insert(aiPermissionsTable).values([
    { roleId: 1, featureType: "policy_search", isAllowed: true, grantedByUserId: 1 },
    { roleId: 1, featureType: "report_query", isAllowed: true, grantedByUserId: 1 },
    { roleId: 1, featureType: "document_classify", isAllowed: true, grantedByUserId: 1 },
    { roleId: 1, featureType: "anomaly_explain", isAllowed: true, grantedByUserId: 1 },
  ]);

  // ─── AI QUERIES ─────────────────────────────────────────────────────────────
  console.log("  → ai_queries");
  const aiQueriesData = [
    {
      featureType: "policy_search",
      queryText: "What is the annual leave entitlement for full-time staff?",
      responseText: "Full-time staff are entitled to 30 calendar days of annual leave per year as per HR Policy HR-POL-001.",
      citationsJson: JSON.stringify([{ source: "HR Leave Policy HR-POL-001", excerpt: "Full-time employees are entitled to 30 days annual leave.", page: 3 }]),
      modelUsed: "llama3.2",
      tokensUsed: 210,
      durationMs: 1240,
      wasSimulated: true,
      success: true,
      requestedByUserId: 1,
    },
    {
      featureType: "policy_search",
      queryText: "overtime approval process and maximum hours",
      responseText: "Overtime requires department head approval. Maximum overtime is 2 hours per day and 10 hours per week per HR-POL-007.",
      citationsJson: JSON.stringify([{ source: "Overtime Policy HR-POL-007", excerpt: "Overtime must be pre-approved by department head.", page: 2 }]),
      modelUsed: "llama3.2",
      tokensUsed: 185,
      durationMs: 980,
      wasSimulated: true,
      success: true,
      requestedByUserId: 1,
    },
    {
      featureType: "policy_search",
      queryText: "maternity leave and paternity leave policy",
      responseText: "Maternity leave: 60 days with full pay. Paternity leave: 5 days. Ref: HR-POL-003.",
      citationsJson: JSON.stringify([{ source: "Parental Leave Policy HR-POL-003", excerpt: "Maternity: 60 days. Paternity: 5 days.", page: 1 }]),
      modelUsed: "llama3.2",
      tokensUsed: 145,
      durationMs: 870,
      wasSimulated: true,
      success: true,
      requestedByUserId: 2,
    },
    {
      featureType: "report_query",
      queryText: "Show me headcount by department for this month",
      responseText: "Showing active headcount grouped by department.",
      modelUsed: "llama3.2",
      tokensUsed: 320,
      durationMs: 1500,
      wasSimulated: true,
      success: true,
      requestedByUserId: 1,
    },
    {
      featureType: "report_query",
      queryText: "How many employees are on leave this week?",
      responseText: "Showing employees with active leave requests this week.",
      modelUsed: "llama3.2",
      tokensUsed: 290,
      durationMs: 1320,
      wasSimulated: true,
      success: true,
      requestedByUserId: 1,
    },
    {
      featureType: "report_query",
      queryText: "What is the total payroll for December 2024?",
      responseText: "Returning latest payroll run summary for December 2024.",
      modelUsed: "llama3.2",
      tokensUsed: 275,
      durationMs: 1180,
      wasSimulated: true,
      success: true,
      requestedByUserId: 1,
    },
    {
      featureType: "document_classify",
      queryText: "Employment contract for Ahmed Al-Rashidi — January 2024",
      responseText: "Category: Employment Contract",
      modelUsed: "llama3.2",
      tokensUsed: 120,
      durationMs: 650,
      wasSimulated: true,
      success: true,
      requestedByUserId: 1,
      entityType: "enterprise_document",
      entityId: 1,
    },
    {
      featureType: "document_classify",
      queryText: "Medical Certificate — sick leave 3 days",
      responseText: "Category: Medical",
      modelUsed: "llama3.2",
      tokensUsed: 98,
      durationMs: 520,
      wasSimulated: true,
      success: true,
      requestedByUserId: 2,
      entityType: "enterprise_document",
      entityId: 2,
    },
    {
      featureType: "document_classify",
      queryText: "Annual Financial Statement FY2023",
      responseText: "Category: Financial",
      modelUsed: "llama3.2",
      tokensUsed: 105,
      durationMs: 530,
      wasSimulated: true,
      success: true,
      requestedByUserId: 1,
    },
    {
      featureType: "anomaly_explain",
      queryText: JSON.stringify({ anomalyType: "attendance_high", entityId: 42, metrics: { absences: 8, threshold: 3 } }),
      responseText: "Employee #42 has recorded 8 absences this month, exceeding the 3-absence threshold. This pattern may indicate a health issue, personal circumstances, or engagement risk.",
      modelUsed: "llama3.2",
      tokensUsed: 310,
      durationMs: 1600,
      wasSimulated: true,
      success: true,
      requestedByUserId: 1,
      entityType: "employee",
      entityId: 42,
    },
    {
      featureType: "anomaly_explain",
      queryText: JSON.stringify({ anomalyType: "overtime_spike", entityId: 17, metrics: { overtimeHours: 45, avgHours: 12 } }),
      responseText: "Employee #17 accumulated 45 overtime hours this month vs. a 12-hour average. This spike warrants review for workload distribution and potential burnout risk.",
      modelUsed: "llama3.2",
      tokensUsed: 280,
      durationMs: 1450,
      wasSimulated: true,
      success: true,
      requestedByUserId: 1,
      entityType: "employee",
      entityId: 17,
    },
    {
      featureType: "policy_search",
      queryText: "disciplinary procedure for misconduct",
      responseText: "Disciplinary procedures follow a 3-stage process: verbal warning, written warning, and formal hearing. Ref: HR-POL-012.",
      citationsJson: JSON.stringify([{ source: "Disciplinary Policy HR-POL-012", excerpt: "Three-stage disciplinary process.", page: 4 }]),
      modelUsed: "llama3.2",
      tokensUsed: 220,
      durationMs: 1100,
      wasSimulated: true,
      success: true,
      requestedByUserId: 1,
    },
    {
      featureType: "report_query",
      queryText: "list employees whose contracts expire in the next 30 days",
      responseText: "Showing employees with contract end dates within the next 30 days.",
      modelUsed: "llama3.2",
      tokensUsed: 265,
      durationMs: 1290,
      wasSimulated: true,
      success: true,
      requestedByUserId: 1,
    },
    {
      featureType: "anomaly_explain",
      queryText: JSON.stringify({ anomalyType: "payroll_variance", entityId: null, metrics: { variancePct: 12.4, previousRun: 154000, currentRun: 173100 } }),
      responseText: "Payroll variance of 12.4% detected this run (previous: 154,000; current: 173,100). Key drivers may include new hires, salary adjustments, or overtime spikes. Recommend reviewing run details.",
      modelUsed: "llama3.2",
      tokensUsed: 340,
      durationMs: 1750,
      wasSimulated: true,
      success: true,
      requestedByUserId: 1,
    },
    {
      featureType: "document_classify",
      queryText: "Training Completion Certificate — Leadership Programme 2024",
      responseText: "Category: Training Record",
      modelUsed: "llama3.2",
      tokensUsed: 110,
      durationMs: 545,
      wasSimulated: true,
      success: true,
      requestedByUserId: 1,
      entityType: "enterprise_document",
      entityId: 5,
    },
  ];

  await db.insert(aiQueriesTable).values(aiQueriesData);

  console.log("✅ Phase 7B+7C seed complete.");
  process.exit(0);
}

main().catch((e) => {
  console.error("❌ Seed failed:", e);
  process.exit(1);
});
