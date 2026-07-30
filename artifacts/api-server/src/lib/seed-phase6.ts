/**
 * Phase 6 seed — Document Management, Reporting, Notifications, Deployment Ops.
 * Run with: npx tsx artifacts/api-server/src/lib/seed-phase6.ts
 */
import { db } from "@workspace/db";
import {
  documentCategoriesTable, enterpriseDocumentsTable, documentVersionsTable,
  documentAccessLogsTable, documentAcknowledgementsTable, documentTemplatesTable,
  reportDefinitionsTable, savedReportFiltersTable, reportSchedulesTable, reportOutputsTable,
  notificationsTable, notificationPreferencesTable, escalationRulesTable, approvalInboxItemsTable,
  healthChecksTable, updatePackagesTable, deploymentEventsTable, installationReadinessTable,
} from "@workspace/db";

async function main() {
  console.log("🌱 Seeding Phase 6 — Document Mgmt, Reporting, Notifications, Deployment...");

  // ─── DELETE in reverse FK dependency order ──────────────────────────────────
  console.log("  → cleaning phase 6 tables");

  // Deployment Ops
  await db.delete(installationReadinessTable);
  await db.delete(deploymentEventsTable);
  await db.delete(updatePackagesTable);
  await db.delete(healthChecksTable);

  // Notifications & Approval Inbox
  await db.delete(approvalInboxItemsTable);
  await db.delete(escalationRulesTable);
  await db.delete(notificationPreferencesTable);
  await db.delete(notificationsTable);

  // Reporting
  await db.delete(reportOutputsTable);
  await db.delete(reportSchedulesTable);
  await db.delete(savedReportFiltersTable);
  await db.delete(reportDefinitionsTable);

  // Document Management
  await db.delete(documentAcknowledgementsTable);
  await db.delete(documentAccessLogsTable);
  await db.delete(documentVersionsTable);
  await db.delete(documentTemplatesTable);
  await db.delete(enterpriseDocumentsTable);
  await db.delete(documentCategoriesTable);

  // ─── DOCUMENT CATEGORIES ────────────────────────────────────────────────────
  console.log("  → document_categories");
  const [
    catPersonal, catContract, catCompliance,
    catMedical, catDisciplinary, catClassified,
  ] = await db.insert(documentCategoriesTable).values([
    {
      code: "PERSONAL",
      nameEn: "Personal Documents",
      nameAr: "الوثائق الشخصية",
      categoryType: "personal",
      defaultClassification: "internal",
      retentionYears: 7,
      allowDownload: true,
      requiresExpiryDate: false,
    },
    {
      code: "CONTRACT",
      nameEn: "Employment Contracts",
      nameAr: "عقود العمل",
      categoryType: "contract",
      defaultClassification: "confidential",
      retentionYears: 10,
      requiresAcknowledgement: true,
      watermarkOnDownload: true,
    },
    {
      code: "COMPLIANCE",
      nameEn: "Compliance & Policy Documents",
      nameAr: "وثائق الامتثال والسياسات",
      categoryType: "compliance",
      defaultClassification: "internal",
      retentionYears: 5,
      requiresAcknowledgement: true,
    },
    {
      code: "MEDICAL",
      nameEn: "Medical Records",
      nameAr: "السجلات الطبية",
      categoryType: "medical",
      defaultClassification: "confidential",
      retentionYears: 10,
      allowPrint: false,
      watermarkOnDownload: true,
    },
    {
      code: "DISCIPLINARY",
      nameEn: "Disciplinary Records",
      nameAr: "سجلات الانضباط",
      categoryType: "disciplinary",
      defaultClassification: "confidential",
      retentionYears: 7,
    },
    {
      code: "MILITARY_CLASSIFIED",
      nameEn: "Classified Military Documents",
      nameAr: "الوثائق العسكرية السرية",
      categoryType: "classified",
      defaultClassification: "secret",
      retentionYears: 25,
      allowDownload: false,
      allowPrint: false,
      organizationType: "military",
    },
  ]).returning();

  // ─── ENTERPRISE DOCUMENTS ───────────────────────────────────────────────────
  console.log("  → enterprise_documents");
  const [doc1, doc2, doc3, doc4, doc5] = await db.insert(enterpriseDocumentsTable).values([
    {
      documentNumber: "DOC-2024-001",
      categoryId: catCompliance.id,
      employeeId: null,
      scope: "org_policy",
      titleEn: "Employee Code of Conduct 2024",
      titleAr: "قواعد سلوك الموظفين 2024",
      classificationLevel: "internal",
      status: "active",
      requiresAcknowledgement: true,
      issuedAt: "2024-01-01",
      currentVersionNumber: "2.1",
    },
    {
      documentNumber: "DOC-2024-002",
      categoryId: catContract.id,
      employeeId: 3,
      scope: "employee_record",
      titleEn: "Employment Contract — Brigade Commander",
      classificationLevel: "confidential",
      status: "active",
      issuedAt: "2021-07-01",
    },
    {
      documentNumber: "DOC-2025-003",
      categoryId: catPersonal.id,
      employeeId: 1,
      scope: "employee_record",
      titleEn: "National ID Copy — HR Director",
      classificationLevel: "internal",
      status: "active",
      issuedAt: "2025-01-15",
    },
    {
      documentNumber: "DOC-2025-004",
      categoryId: catCompliance.id,
      employeeId: null,
      scope: "org_policy",
      titleEn: "Information Security Policy v3.0",
      titleAr: "سياسة أمن المعلومات",
      classificationLevel: "internal",
      status: "active",
      requiresAcknowledgement: true,
      expiresAt: "2027-12-31",
    },
    {
      documentNumber: "DOC-2025-005",
      categoryId: catDisciplinary.id,
      employeeId: 8,
      scope: "employee_record",
      titleEn: "Written Warning — Attendance",
      classificationLevel: "confidential",
      status: "active",
      issuedAt: "2025-11-15",
    },
  ]).returning();

  // ─── DOCUMENT VERSIONS ──────────────────────────────────────────────────────
  console.log("  → document_versions");
  const docVersionPairs: Array<{ doc: typeof doc1; docNumber: string }> = [
    { doc: doc1, docNumber: "DOC-2024-001" },
    { doc: doc2, docNumber: "DOC-2024-002" },
    { doc: doc3, docNumber: "DOC-2025-003" },
    { doc: doc4, docNumber: "DOC-2025-004" },
    { doc: doc5, docNumber: "DOC-2025-005" },
  ];

  await db.insert(documentVersionsTable).values(
    docVersionPairs.map(({ doc, docNumber }) => ({
      documentId: doc.id,
      versionNumber: "1.0",
      fileName: `${docNumber}-v1.pdf`,
      storagePath: `/data/documents/${docNumber}/v1.0.pdf`,
      mimeType: "application/pdf",
      fileSize: 245678,
      isCurrentVersion: true,
      uploadedByUserId: 1,
    }))
  );

  // ─── DOCUMENT ACKNOWLEDGEMENTS ──────────────────────────────────────────────
  console.log("  → document_acknowledgements");
  await db.insert(documentAcknowledgementsTable).values([
    {
      documentId: doc1.id,
      employeeId: 2,
      status: "acknowledged",
      acknowledgedAt: new Date("2024-02-15"),
    },
    {
      documentId: doc1.id,
      employeeId: 3,
      status: "acknowledged",
      acknowledgedAt: new Date("2024-02-20"),
    },
    {
      documentId: doc4.id,
      employeeId: 5,
      status: "pending",
      deadlineDate: "2026-08-31",
    },
  ]);

  // ─── DOCUMENT TEMPLATES ─────────────────────────────────────────────────────
  console.log("  → document_templates");
  await db.insert(documentTemplatesTable).values([
    {
      code: "SALARY_CERT",
      nameEn: "Salary Certificate",
      nameAr: "شهادة الراتب",
      templateType: "salary_certificate",
      bodyHtml:
        "<h1>SALARY CERTIFICATE</h1><p>This is to certify that {{employeeNameEn}} holds the position of {{jobTitle}} in {{departmentName}} with a monthly basic salary of {{baseSalary}} SAR.</p>",
    },
    {
      code: "EMP_LETTER",
      nameEn: "Employment Verification Letter",
      nameAr: "خطاب تأكيد التوظيف",
      templateType: "employment_certificate",
      bodyHtml:
        "<h1>EMPLOYMENT VERIFICATION</h1><p>This letter certifies that {{employeeNameEn}} has been employed since {{startDate}}.</p>",
    },
    {
      code: "WARNING_LTR",
      nameEn: "Written Warning Letter",
      nameAr: "خطاب إنذار كتابي",
      templateType: "warning_letter",
      bodyHtml:
        "<h1>WRITTEN WARNING</h1><p>Dear {{employeeNameEn}}, this letter serves as a formal written warning regarding {{incidentDescription}}.</p>",
    },
  ]);

  // ─── REPORT DEFINITIONS ─────────────────────────────────────────────────────
  console.log("  → report_definitions");
  const minimalQuerySpec = JSON.stringify({
    columns: ["employeeId", "departmentId", "status"],
    filters: [],
    groupBy: ["departmentId"],
  });

  const [rptWorkforce, rptAttendance, rptLeave, rptPayroll, rptRecruit] =
    await db.insert(reportDefinitionsTable).values([
      {
        code: "RPT-WORKFORCE-01",
        nameEn: "Workforce Headcount by Department",
        nameAr: "توزيع القوى العاملة حسب الإدارة",
        reportType: "workforce",
        outputFormat: "tabular",
        isSystemReport: true,
        allowedRoles: "hr,admin,executive",
        querySpecJson: minimalQuerySpec,
      },
      {
        code: "RPT-ATTENDANCE-01",
        nameEn: "Monthly Attendance Summary",
        nameAr: "ملخص الحضور الشهري",
        reportType: "attendance",
        isSystemReport: true,
        allowedRoles: "hr,admin,manager",
        querySpecJson: minimalQuerySpec,
      },
      {
        code: "RPT-LEAVE-01",
        nameEn: "Leave Utilization Report",
        nameAr: "تقرير استخدام الإجازات",
        reportType: "leave",
        isSystemReport: true,
        allowedRoles: "hr,admin",
        querySpecJson: minimalQuerySpec,
      },
      {
        code: "RPT-PAYROLL-01",
        nameEn: "Payroll Cost Analysis",
        nameAr: "تحليل تكاليف الرواتب",
        reportType: "payroll",
        isSystemReport: true,
        allowedRoles: "hr,admin,finance",
        maskedFieldsJson: '["baseSalary","totalPackage"]',
        querySpecJson: minimalQuerySpec,
      },
      {
        code: "RPT-RECRUIT-01",
        nameEn: "Recruitment Pipeline Report",
        nameAr: "تقرير خط أنابيب التوظيف",
        reportType: "recruitment",
        isSystemReport: true,
        allowedRoles: "hr,admin",
        querySpecJson: minimalQuerySpec,
      },
    ]).returning();

  // ─── REPORT SCHEDULES ───────────────────────────────────────────────────────
  console.log("  → report_schedules");
  await db.insert(reportSchedulesTable).values([
    {
      reportDefinitionId: rptAttendance.id,
      nameEn: "Monthly Attendance - Auto",
      frequency: "monthly",
      dayOfMonth: 1,
      timeOfDay: "06:00",
      exportFormat: "pdf",
      language: "en",
      isActive: true,
      outputPath: "/reports/attendance/",
    },
    {
      reportDefinitionId: rptWorkforce.id,
      nameEn: "Weekly Headcount - Auto",
      frequency: "weekly",
      dayOfWeek: 0,
      timeOfDay: "07:00",
      exportFormat: "excel",
      language: "both",
      isActive: true,
    },
  ]);

  // ─── REPORT OUTPUTS ─────────────────────────────────────────────────────────
  console.log("  → report_outputs");
  await db.insert(reportOutputsTable).values([
    {
      reportDefinitionId: rptWorkforce.id,
      generatedByUserId: 1,
      outputFormat: "pdf",
      language: "en",
      status: "ready",
      fileName: "workforce-headcount-2026-07.pdf",
      fileSizeBytes: 156789,
      rowCount: 47,
      generationCompletedAt: new Date("2026-07-15"),
    },
    {
      reportDefinitionId: rptAttendance.id,
      status: "ready",
      fileName: "attendance-jun-2026.pdf",
      fileSizeBytes: 234567,
      rowCount: 312,
      outputFormat: "pdf",
      language: "en",
    },
  ]);

  // ─── NOTIFICATIONS ──────────────────────────────────────────────────────────
  console.log("  → notifications");
  await db.insert(notificationsTable).values([
    {
      recipientUserId: 1,
      notificationType: "appraisal_due",
      titleEn: "Annual Appraisal Deadline Approaching",
      bodyEn: "3 employees have pending manager appraisals due within 7 days.",
      severity: "warning",
      requiresAction: true,
      actionUrl: "/performance",
      isRead: false,
    },
    {
      recipientUserId: 2,
      notificationType: "leave_request",
      titleEn: "New Leave Request Pending Approval",
      bodyEn: "Omar Al-Ghamdi has submitted an annual leave request.",
      severity: "info",
      requiresAction: true,
      actionUrl: "/approvals",
      isRead: false,
    },
    {
      recipientUserId: 3,
      notificationType: "document_expiry",
      titleEn: "Security Clearance Expiring Soon",
      bodyEn: "Your security clearance expires in 30 days.",
      severity: "warning",
      isRead: false,
      actionUrl: "/security-clearances",
    },
    {
      recipientUserId: 1,
      notificationType: "announcement",
      titleEn: "New Policy Document Published",
      bodyEn: "The Information Security Policy v3.0 has been published and requires acknowledgement.",
      severity: "info",
      isRead: true,
      readAt: new Date("2026-07-20"),
    },
    {
      recipientUserId: 2,
      notificationType: "approval_required",
      titleEn: "Promotion Recommendation Awaiting Approval",
      bodyEn: "A promotion recommendation for employee #3 requires your review.",
      severity: "urgent",
      requiresAction: true,
      actionUrl: "/disciplinary",
      isRead: false,
      actionDeadline: "2026-08-15",
    },
  ]);

  // ─── NOTIFICATION PREFERENCES ────────────────────────────────────────────────
  console.log("  → notification_preferences");
  await db.insert(notificationPreferencesTable).values([
    {
      userId: 1,
      quietHoursEnabled: false,
      preferredLanguage: "en",
      dashboardFrequency: "realtime",
    },
    {
      userId: 2,
      quietHoursEnabled: true,
      quietHoursStart: "22:00",
      quietHoursEnd: "07:00",
      preferredLanguage: "ar",
      dashboardFrequency: "hourly",
    },
  ]);

  // ─── ESCALATION RULES ───────────────────────────────────────────────────────
  console.log("  → escalation_rules");
  await db.insert(escalationRulesTable).values([
    {
      nameEn: "Leave Approval Escalation",
      entityType: "leave_request",
      triggerStatus: "pending",
      escalateAfterHours: 24,
      escalateToRole: "hr_manager",
      notificationSeverity: "warning",
      isActive: true,
    },
    {
      nameEn: "Dual Auth Timeout Escalation",
      entityType: "dual_auth_request",
      triggerStatus: "pending",
      escalateAfterHours: 4,
      escalateToRole: "admin",
      notificationSeverity: "error",
      isActive: true,
    },
    {
      nameEn: "Appraisal Submission Escalation",
      entityType: "appraisal_record",
      triggerStatus: "not_started",
      escalateAfterHours: 168,
      escalateToRole: "hr_manager",
      notificationSeverity: "warning",
      isActive: true,
    },
  ]);

  // ─── APPROVAL INBOX ITEMS ───────────────────────────────────────────────────
  console.log("  → approval_inbox_items");
  await db.insert(approvalInboxItemsTable).values([
    {
      assignedToUserId: 1,
      entityType: "leave_request",
      entityId: 1,
      titleEn: "Annual Leave — Fatima Al-Zahrani (5 days)",
      approvalType: "leave_approval",
      requestedByEmployeeId: 2,
      requestedAt: new Date("2026-07-25"),
      priority: "normal",
      status: "pending",
    },
    {
      assignedToUserId: 1,
      entityType: "promotion_recommendation",
      entityId: 1,
      titleEn: "Promotion Recommendation — Omar Al-Ghamdi to G9",
      approvalType: "promotion",
      requestedByEmployeeId: 3,
      requestedAt: new Date("2026-07-20"),
      deadline: "2026-08-15",
      priority: "high",
      status: "pending",
    },
    {
      assignedToUserId: 2,
      entityType: "job_requisition",
      entityId: 1,
      titleEn: "Requisition Approval — Senior HR Specialist (2 positions)",
      approvalType: "job_requisition",
      requestedByEmployeeId: 1,
      requestedAt: new Date("2026-07-18"),
      status: "approved",
      decidedAt: new Date("2026-07-22"),
    },
  ]);

  // ─── HEALTH CHECKS ──────────────────────────────────────────────────────────
  console.log("  → health_checks");
  await db.insert(healthChecksTable).values([
    {
      checkType: "database",
      checkName: "PostgreSQL Connection",
      status: "pass",
      message: "Connected successfully",
      responseTimeMs: 12,
      triggeredBy: "startup",
    },
    {
      checkType: "disk",
      checkName: "Document Storage Space",
      status: "pass",
      message: "87.3 GB free (73% available)",
      responseTimeMs: 5,
      triggeredBy: "scheduled",
    },
    {
      checkType: "license",
      checkName: "Software License Validity",
      status: "pass",
      message: "Enterprise license valid — expires 2027-12-31",
      responseTimeMs: 2,
      triggeredBy: "startup",
    },
    {
      checkType: "backup",
      checkName: "Last Backup Recency",
      status: "warn",
      message: "Last backup was 26 hours ago — threshold is 24 hours",
      responseTimeMs: 8,
      triggeredBy: "scheduled",
    },
    {
      checkType: "sync",
      checkName: "Branch Server Connectivity",
      status: "pass",
      message: "3 of 3 registered branch servers reachable",
      responseTimeMs: 145,
      triggeredBy: "scheduled",
    },
  ]);

  // ─── UPDATE PACKAGES ────────────────────────────────────────────────────────
  console.log("  → update_packages");
  await db.insert(updatePackagesTable).values([
    {
      packageVersion: "2.5.0",
      packageName: "HRMS Enterprise Suite 2.5.0",
      isCritical: false,
      requiresRestart: true,
      status: "available",
      checksum: "a3f5b2c9d1e4f67890abcdef1234567890abcdef1234567890abcdef12345678",
      signatureVerified: false,
      fileSizeBytes: 45678901,
      minCompatibleVersion: "2.4.0",
    },
  ]);

  // ─── DEPLOYMENT EVENTS ──────────────────────────────────────────────────────
  console.log("  → deployment_events");
  await db.insert(deploymentEventsTable).values([
    {
      eventType: "install",
      description: "Initial system installation — HRMS Enterprise v2.0.0",
      outcome: "success",
      performedBySystem: true,
    },
    {
      eventType: "update",
      description: "Updated from v2.3.0 to v2.4.0 — leave management and payroll engine",
      outcome: "success",
      performedByUserId: 1,
    },
    {
      eventType: "backup",
      description:
        "Automated daily backup — compressed database dump to /backups/hrms-2026-07-29.sql.gz",
      outcome: "success",
      performedBySystem: true,
    },
  ]);

  // ─── INSTALLATION READINESS ─────────────────────────────────────────────────
  console.log("  → installation_readiness");
  await db.insert(installationReadinessTable).values([
    {
      checkCategory: "database",
      checkItemEn: "PostgreSQL version ≥ 14",
      isMandatory: true,
      status: "pass",
      resultMessage: "PostgreSQL 16.3 detected",
    },
    {
      checkCategory: "database",
      checkItemEn: "Database user has required privileges",
      isMandatory: true,
      status: "pass",
    },
    {
      checkCategory: "storage",
      checkItemEn: "Document storage directory writable",
      isMandatory: true,
      status: "pass",
      resultMessage: "/data/documents is writable",
    },
    {
      checkCategory: "network",
      checkItemEn: "No outbound internet required",
      isMandatory: false,
      status: "pass",
      resultMessage: "All services operate offline",
    },
    {
      checkCategory: "security",
      checkItemEn: "SSL/TLS certificates configured",
      isMandatory: true,
      status: "warn",
      resultMessage:
        "Self-signed certificate detected — replace with CA-signed for production",
    },
    {
      checkCategory: "license",
      checkItemEn: "Valid enterprise license installed",
      isMandatory: true,
      status: "pass",
    },
  ]);

  console.log("✅ Phase 6 seed complete.");
}

main().catch(console.error);
