/**
 * Phase 8 Seed — Setup Wizard, Data Import Templates, Diagnostics, Pilot
 * Run: ts-node -e "require('./seed-phase8.ts')" or via a migration script
 */

import {
  db,
  setupWizardProgressTable,
  deploymentChecklistItemsTable,
  environmentReadinessChecksTable,
  softwareUpdatePackagesTable,
  pilotAccountsTable,
  pilotScenariosTable,
  importMappingTemplatesTable,
  systemHealthChecksTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

async function seedPhase8() {
  console.log("🌱 Seeding Phase 8 data...");

  // ─── 1. Setup Wizard ───────────────────────────────────────────────────────
  const existingWizard = await db.select().from(setupWizardProgressTable).limit(1);
  if (existingWizard.length === 0) {
    await db.insert(setupWizardProgressTable).values({
      instanceId: "default",
      currentStep: "complete",
      completedStepsJson: JSON.stringify([
        "org_profile", "branding", "locale", "payroll", "workweek",
        "holidays", "org_structure", "roles_grades", "admins",
        "approvals", "devices", "backup", "security", "complete",
      ]),
      isComplete: true,
      completedAt: new Date(),
      completedByUserId: 1,
      answersJson: JSON.stringify({
        org_profile: { orgNameEn: "Demo Organization", orgNameAr: "المنظمة التجريبية" },
        locale: { defaultLanguage: "ar", timezone: "Asia/Riyadh" },
        payroll: { currency: "SAR", payrollCycle: "monthly" },
      }),
    });
    console.log("  ✅ Setup wizard seeded");
  } else {
    console.log("  ⏭  Setup wizard already exists");
  }

  // ─── 2. Deployment Checklist ───────────────────────────────────────────────
  const existingChecklist = await db.select().from(deploymentChecklistItemsTable).limit(1);
  if (existingChecklist.length === 0) {
    await db.insert(deploymentChecklistItemsTable).values([
      { category: "infrastructure", itemCode: "db_configured", titleEn: "Database Configured", titleAr: "قاعدة البيانات مُهيأة", status: "pass", priority: "required", implementationLevel: "production", sortOrder: 1 },
      { category: "infrastructure", itemCode: "backup_verified", titleEn: "Backup Verified", titleAr: "النسخ الاحتياطي مُتحقق منه", status: "pass", priority: "required", implementationLevel: "production", sortOrder: 2 },
      { category: "compliance", itemCode: "license_valid", titleEn: "License Valid", titleAr: "الترخيص صالح", status: "pass", priority: "required", implementationLevel: "production", sortOrder: 3 },
      { category: "configuration", itemCode: "setup_wizard_complete", titleEn: "Setup Wizard Complete", titleAr: "معالج الإعداد مكتمل", status: "pass", priority: "required", implementationLevel: "production", sortOrder: 4 },
      { category: "security", itemCode: "admin_accounts_set", titleEn: "Admin Accounts Configured", titleAr: "حسابات المسؤول مُهيأة", status: "pass", priority: "required", implementationLevel: "production", sortOrder: 5 },
      { category: "configuration", itemCode: "departments_configured", titleEn: "Departments Configured", titleAr: "الأقسام مُهيأة", status: "pass", priority: "required", implementationLevel: "production", sortOrder: 6 },
      { category: "configuration", itemCode: "grades_configured", titleEn: "Salary Grades Configured", titleAr: "درجات الراتب مُهيأة", status: "pass", priority: "required", implementationLevel: "production", sortOrder: 7 },
      { category: "configuration", itemCode: "leave_types_configured", titleEn: "Leave Types Configured", titleAr: "أنواع الإجازات مُهيأة", status: "pass", priority: "required", implementationLevel: "production", sortOrder: 8 },
      { category: "configuration", itemCode: "holidays_configured", titleEn: "Public Holidays Configured", titleAr: "العطل الرسمية مُهيأة", status: "pass", priority: "recommended", implementationLevel: "production", sortOrder: 9 },
      { category: "infrastructure", itemCode: "devices_enrolled", titleEn: "Biometric Devices Enrolled", titleAr: "أجهزة البصمة مُسجلة", status: "pending", priority: "recommended", implementationLevel: "prototype", sortOrder: 10 },
      { category: "configuration", itemCode: "approval_chains_set", titleEn: "Approval Chains Configured", titleAr: "سلاسل الاعتماد مُهيأة", status: "pass", priority: "recommended", implementationLevel: "production", sortOrder: 11 },
      { category: "security", itemCode: "security_policy_reviewed", titleEn: "Security Policy Reviewed", titleAr: "سياسة الأمان مُراجعة", status: "pending", priority: "optional", implementationLevel: "prototype", sortOrder: 12 },
    ]);
    console.log("  ✅ Deployment checklist seeded (12 items)");
  } else {
    console.log("  ⏭  Deployment checklist already exists");
  }

  // ─── 3. Environment Readiness Checks ──────────────────────────────────────
  const existingReadiness = await db.select().from(environmentReadinessChecksTable).limit(1);
  if (existingReadiness.length === 0) {
    await db.insert(environmentReadinessChecksTable).values([
      { checkName: "db_connectivity", checkCategory: "infrastructure", result: "pass", message: "Database connection verified", isMandatory: true, lastCheckedAt: new Date() },
      { checkName: "disk_space", checkCategory: "infrastructure", result: "pass", message: "45% disk used — OK", remediationHint: "Ensure at least 10GB free disk space", isMandatory: true, lastCheckedAt: new Date() },
      { checkName: "backup_dir_writable", checkCategory: "infrastructure", result: "pass", message: "Backup directory is writable", remediationHint: "Set BACKUP_DIR env var to a writable path", isMandatory: true, lastCheckedAt: new Date() },
      { checkName: "config_complete", checkCategory: "configuration", result: "pass", message: "Setup wizard completed", remediationHint: "Complete the setup wizard", isMandatory: true, lastCheckedAt: new Date() },
      { checkName: "smtp_configured", checkCategory: "configuration", result: "warn", message: "SMTP not configured — email notifications disabled", remediationHint: "Set SMTP_HOST, SMTP_PORT, SMTP_USER env vars", isMandatory: false, lastCheckedAt: new Date() },
      { checkName: "ldap_optional", checkCategory: "configuration", result: "pass", message: "LDAP not configured (optional)", isMandatory: false, lastCheckedAt: new Date() },
    ]);
    console.log("  ✅ Environment readiness checks seeded (6 items)");
  } else {
    console.log("  ⏭  Environment readiness checks already exist");
  }

  // ─── 4. Software Update Packages ──────────────────────────────────────────
  const existingUpdates = await db.select().from(softwareUpdatePackagesTable).limit(1);
  if (existingUpdates.length === 0) {
    await db.insert(softwareUpdatePackagesTable).values([
      { version: "1.0.0", buildNumber: "1000", releaseChannel: "stable", status: "installed", signatureValid: true, signatureVerifiedAt: new Date(), releaseNotesEn: "Initial release", releaseNotesAr: "الإصدار الأول", installedAt: new Date(), installedByUserId: 1 },
      { version: "1.1.0", buildNumber: "1100", releaseChannel: "stable", status: "installed", signatureValid: true, signatureVerifiedAt: new Date(), releaseNotesEn: "Phase 2 features", releaseNotesAr: "ميزات المرحلة الثانية", installedAt: new Date(), installedByUserId: 1 },
      { version: "1.2.0", buildNumber: "1200", releaseChannel: "stable", status: "installed", signatureValid: true, signatureVerifiedAt: new Date(), releaseNotesEn: "Phase 4 features", releaseNotesAr: "ميزات المرحلة الرابعة", installedAt: new Date(), installedByUserId: 1 },
      { version: "1.3.0", buildNumber: "1300", releaseChannel: "stable", status: "verified", signatureValid: true, signatureVerifiedAt: new Date(), releaseNotesEn: "Phase 6 features", releaseNotesAr: "ميزات المرحلة السادسة" },
      { version: "2.0.0-beta.1", buildNumber: "2001", releaseChannel: "beta", status: "pending_verification", releaseNotesEn: "Phase 8 preview release", releaseNotesAr: "معاينة المرحلة الثامنة" },
    ]);
    console.log("  ✅ Software update packages seeded (5 items)");
  } else {
    console.log("  ⏭  Software update packages already exist");
  }

  // ─── 5. Pilot Accounts ────────────────────────────────────────────────────
  const existingAccounts = await db.select().from(pilotAccountsTable).limit(1);
  if (existingAccounts.length === 0) {
    await db.insert(pilotAccountsTable).values([
      { persona: "hr_admin", labelEn: "HR Administrator", labelAr: "مسؤول الموارد البشرية", systemUsername: "demo.hr_admin", roleType: "hr_admin", descriptionEn: "Full HR system access", descriptionAr: "وصول كامل لنظام الموارد البشرية", isActive: true, sortOrder: 1 },
      { persona: "hr_manager", labelEn: "HR Manager", labelAr: "مدير الموارد البشرية", systemUsername: "demo.hr_manager", roleType: "hr_manager", descriptionEn: "HR management and approvals", descriptionAr: "إدارة الموارد البشرية والموافقات", isActive: true, sortOrder: 2 },
      { persona: "supervisor", labelEn: "Department Supervisor", labelAr: "مشرف القسم", systemUsername: "demo.supervisor", roleType: "supervisor", descriptionEn: "Team management and leave approvals", descriptionAr: "إدارة الفريق وموافقات الإجازات", isActive: true, sortOrder: 3 },
      { persona: "employee", labelEn: "Employee", labelAr: "موظف", systemUsername: "demo.employee", roleType: "employee", descriptionEn: "Self-service employee access", descriptionAr: "وصول الخدمة الذاتية للموظف", isActive: true, sortOrder: 4 },
      { persona: "finance_officer", labelEn: "Finance Officer", labelAr: "مسؤول المالية", systemUsername: "demo.finance", roleType: "finance", descriptionEn: "Payroll and financial reports", descriptionAr: "الرواتب والتقارير المالية", isActive: true, sortOrder: 5 },
      { persona: "it_admin", labelEn: "IT Administrator", labelAr: "مسؤول تقنية المعلومات", systemUsername: "demo.it_admin", roleType: "it_admin", descriptionEn: "System configuration and devices", descriptionAr: "إعداد النظام والأجهزة", isActive: true, sortOrder: 6 },
      { persona: "auditor", labelEn: "Auditor", labelAr: "المدقق", systemUsername: "demo.auditor", roleType: "auditor", descriptionEn: "Read-only audit access", descriptionAr: "وصول تدقيق للقراءة فقط", isActive: true, sortOrder: 7 },
      { persona: "commander", labelEn: "Unit Commander", labelAr: "قائد الوحدة", systemUsername: "demo.commander", roleType: "commander", descriptionEn: "Military unit management", descriptionAr: "إدارة الوحدة العسكرية", isActive: true, sortOrder: 8 },
    ]);
    console.log("  ✅ Pilot accounts seeded (8 personas)");
  } else {
    console.log("  ⏭  Pilot accounts already exist");
  }

  // ─── 6. Pilot Scenarios ────────────────────────────────────────────────────
  const existingScenarios = await db.select().from(pilotScenariosTable).limit(1);
  if (existingScenarios.length === 0) {
    const scenarios = [
      {
        scenarioCode: "new_employee_onboarding",
        titleEn: "New Employee Onboarding",
        titleAr: "تأهيل موظف جديد",
        category: "general",
        applicableTo: "all",
        estimatedMinutes: 20,
        targetPersonas: "hr_admin,hr_manager",
        sortOrder: 1,
        stepsJson: JSON.stringify([
          { stepNumber: 1, titleEn: "Create Employee Record", titleAr: "إنشاء سجل الموظف", instructions: "Navigate to Employees > Add New and fill in all required fields.", navigateTo: "/employees/new", actionHint: "Click 'Add Employee'" },
          { stepNumber: 2, titleEn: "Assign Department & Role", titleAr: "تعيين القسم والدور", instructions: "Select the employee's department and assign their role.", navigateTo: "/employees", actionHint: "Edit the employee record" },
          { stepNumber: 3, titleEn: "Initiate Onboarding Checklist", titleAr: "بدء قائمة تأهيل", instructions: "Open the onboarding module and start the checklist.", navigateTo: "/employee-onboarding", actionHint: "Click 'Start Onboarding'" },
          { stepNumber: 4, titleEn: "Issue ID Card & Equipment", titleAr: "إصدار بطاقة الهوية والمعدات", instructions: "Issue ID card and required equipment to the new employee.", navigateTo: "/id-card-records", actionHint: "Issue ID Card" },
        ]),
      },
      {
        scenarioCode: "leave_request_approval",
        titleEn: "Leave Request Approval",
        titleAr: "الموافقة على طلب إجازة",
        category: "general",
        applicableTo: "all",
        estimatedMinutes: 10,
        targetPersonas: "supervisor,hr_manager",
        sortOrder: 2,
        stepsJson: JSON.stringify([
          { stepNumber: 1, titleEn: "Submit Leave Request", titleAr: "تقديم طلب إجازة", instructions: "Log in as employee and navigate to Leave Requests.", navigateTo: "/leave-requests", actionHint: "Click 'New Request'" },
          { stepNumber: 2, titleEn: "Review Pending Requests", titleAr: "مراجعة الطلبات المعلقة", instructions: "Switch to supervisor account and review pending approvals.", navigateTo: "/approval-inbox", actionHint: "Open Approval Inbox" },
          { stepNumber: 3, titleEn: "Approve or Reject", titleAr: "الموافقة أو الرفض", instructions: "Approve or reject the leave request with a comment.", navigateTo: "/approval-inbox", actionHint: "Click Approve/Reject" },
        ]),
      },
      {
        scenarioCode: "payroll_calculation",
        titleEn: "Payroll Calculation",
        titleAr: "حساب الرواتب",
        category: "general",
        applicableTo: "all",
        estimatedMinutes: 25,
        targetPersonas: "finance_officer,hr_admin",
        sortOrder: 3,
        stepsJson: JSON.stringify([
          { stepNumber: 1, titleEn: "Open Payroll Period", titleAr: "فتح دورة الرواتب", instructions: "Navigate to Payroll Periods and open the current period.", navigateTo: "/payroll-periods", actionHint: "Click on current period" },
          { stepNumber: 2, titleEn: "Run Payroll", titleAr: "تشغيل الرواتب", instructions: "Start a new payroll run for all active employees.", navigateTo: "/payroll-runs", actionHint: "Click 'Run Payroll'" },
          { stepNumber: 3, titleEn: "Review Payslips", titleAr: "مراجعة قسائم الرواتب", instructions: "Review generated payslips for accuracy.", navigateTo: "/payroll-runs", actionHint: "Click 'View Payslips'" },
          { stepNumber: 4, titleEn: "Approve & Close Period", titleAr: "الموافقة وإغلاق الدورة", instructions: "Approve the payroll run and close the period.", navigateTo: "/payroll-runs", actionHint: "Click 'Approve Payroll'" },
        ]),
      },
      {
        scenarioCode: "attendance_review",
        titleEn: "Attendance Review",
        titleAr: "مراجعة الحضور",
        category: "general",
        applicableTo: "all",
        estimatedMinutes: 15,
        targetPersonas: "supervisor,hr_manager",
        sortOrder: 4,
        stepsJson: JSON.stringify([
          { stepNumber: 1, titleEn: "View Attendance Dashboard", titleAr: "عرض لوحة تحكم الحضور", instructions: "Navigate to the dashboard and review attendance summary.", navigateTo: "/dashboard", actionHint: "Click Attendance widget" },
          { stepNumber: 2, titleEn: "Review Daily Records", titleAr: "مراجعة السجلات اليومية", instructions: "Open attendance records for the current week.", navigateTo: "/attendance", actionHint: "Filter by department" },
          { stepNumber: 3, titleEn: "Process Corrections", titleAr: "معالجة التصحيحات", instructions: "Submit attendance corrections for absent employees.", navigateTo: "/attendance-corrections", actionHint: "Click 'Add Correction'" },
        ]),
      },
      {
        scenarioCode: "recruitment_workflow",
        titleEn: "Recruitment Workflow",
        titleAr: "سير عمل التوظيف",
        category: "commercial",
        applicableTo: "commercial",
        estimatedMinutes: 30,
        targetPersonas: "hr_admin,hr_manager",
        sortOrder: 5,
        stepsJson: JSON.stringify([
          { stepNumber: 1, titleEn: "Create Job Requisition", titleAr: "إنشاء طلب وظيفة", instructions: "Submit a job requisition for approval.", navigateTo: "/job-requisitions", actionHint: "Click 'New Requisition'" },
          { stepNumber: 2, titleEn: "Post Job Opening", titleAr: "نشر فرصة وظيفية", instructions: "Create and publish a job posting.", navigateTo: "/job-postings", actionHint: "Click 'New Posting'" },
          { stepNumber: 3, titleEn: "Review Applications", titleAr: "مراجعة الطلبات", instructions: "Shortlist candidates from received applications.", navigateTo: "/applications", actionHint: "View applications" },
          { stepNumber: 4, titleEn: "Schedule Interview", titleAr: "جدولة مقابلة", instructions: "Schedule an interview and record scores.", navigateTo: "/interview-scores", actionHint: "Add interview score" },
          { stepNumber: 5, titleEn: "Issue Job Offer", titleAr: "إصدار عرض عمل", instructions: "Issue a job offer to the selected candidate.", navigateTo: "/job-offers", actionHint: "Click 'Issue Offer'" },
        ]),
      },
      {
        scenarioCode: "security_clearance",
        titleEn: "Security Clearance Process",
        titleAr: "إجراء التصفية الأمنية",
        category: "military",
        applicableTo: "military",
        estimatedMinutes: 20,
        targetPersonas: "commander,hr_admin",
        sortOrder: 6,
        stepsJson: JSON.stringify([
          { stepNumber: 1, titleEn: "Initiate Clearance Request", titleAr: "بدء طلب التصفية", instructions: "Open Security Clearances module and create a new request.", navigateTo: "/security-clearances", actionHint: "Click 'New Clearance'" },
          { stepNumber: 2, titleEn: "Submit Background Check", titleAr: "تقديم فحص الخلفية", instructions: "Initiate a background check for the employee.", navigateTo: "/background-checks", actionHint: "Submit background check" },
          { stepNumber: 3, titleEn: "Commander Review", titleAr: "مراجعة القائد", instructions: "Log in as commander and review the clearance request.", navigateTo: "/security-clearances", actionHint: "Review and approve" },
        ]),
      },
      {
        scenarioCode: "performance_appraisal",
        titleEn: "Performance Appraisal",
        titleAr: "تقييم الأداء",
        category: "general",
        applicableTo: "all",
        estimatedMinutes: 25,
        targetPersonas: "hr_manager,supervisor",
        sortOrder: 7,
        stepsJson: JSON.stringify([
          { stepNumber: 1, titleEn: "Create Appraisal Cycle", titleAr: "إنشاء دورة تقييم", instructions: "Set up an appraisal cycle with start/end dates.", navigateTo: "/appraisal-cycles", actionHint: "Click 'New Cycle'" },
          { stepNumber: 2, titleEn: "Set Employee Goals", titleAr: "تحديد أهداف الموظف", instructions: "Create and assign goals to employees.", navigateTo: "/employee-goals", actionHint: "Add goals" },
          { stepNumber: 3, titleEn: "Complete Appraisal", titleAr: "إتمام التقييم", instructions: "Open appraisal records and score each employee.", navigateTo: "/appraisal-records", actionHint: "Submit appraisal" },
          { stepNumber: 4, titleEn: "Calibration Session", titleAr: "جلسة المعايرة", instructions: "Run calibration session to normalize scores.", navigateTo: "/calibration-sessions", actionHint: "Start calibration" },
        ]),
      },
      {
        scenarioCode: "data_import_walkthrough",
        titleEn: "Data Import Walkthrough",
        titleAr: "عرض استيراد البيانات",
        category: "general",
        applicableTo: "all",
        estimatedMinutes: 15,
        targetPersonas: "hr_admin,it_admin",
        sortOrder: 8,
        stepsJson: JSON.stringify([
          { stepNumber: 1, titleEn: "Prepare Import Data", titleAr: "تحضير بيانات الاستيراد", instructions: "Prepare a CSV or JSON file with employee data.", navigateTo: "/imports", actionHint: "Go to Data Import" },
          { stepNumber: 2, titleEn: "Upload & Validate", titleAr: "رفع والتحقق", instructions: "Create a new import job and review validation results.", navigateTo: "/imports", actionHint: "Click 'New Import'" },
          { stepNumber: 3, titleEn: "Confirm Preview", titleAr: "تأكيد المعاينة", instructions: "Review the validated rows and confirm the preview.", navigateTo: "/imports", actionHint: "Click 'Confirm Preview'" },
          { stepNumber: 4, titleEn: "Execute Import", titleAr: "تنفيذ الاستيراد", instructions: "Execute the import to create employee records.", navigateTo: "/imports", actionHint: "Click 'Execute'" },
        ]),
      },
    ];

    await db.insert(pilotScenariosTable).values(scenarios);
    console.log("  ✅ Pilot scenarios seeded (8 scenarios)");
  } else {
    console.log("  ⏭  Pilot scenarios already exist");
  }

  // ─── 7. Import Mapping Templates ──────────────────────────────────────────
  const existingTemplates = await db.select().from(importMappingTemplatesTable).limit(1);
  if (existingTemplates.length === 0) {
    await db.insert(importMappingTemplatesTable).values([
      {
        name: "employee_standard",
        importType: "employees",
        columnMappingJson: JSON.stringify({
          "Employee ID": "employeeNumber",
          "First Name": "firstNameEn",
          "Last Name": "lastNameEn",
          "Email": "email",
          "Department": "departmentId",
          "Hire Date": "hireDate",
          "Job Title": "jobTitleEn",
          "Nationality": "nationality",
        }),
        isDefault: true,
        usageCount: 0,
        createdByUserId: 1,
      },
      {
        name: "salary_grade_standard",
        importType: "salary_grades",
        columnMappingJson: JSON.stringify({
          "Grade Code": "gradeCode",
          "Grade Name": "nameEn",
          "Min Salary": "minSalary",
          "Max Salary": "maxSalary",
          "Basic Salary": "basicSalary",
        }),
        isDefault: true,
        usageCount: 0,
        createdByUserId: 1,
      },
      {
        name: "leave_balance_standard",
        importType: "leave_balances",
        columnMappingJson: JSON.stringify({
          "Employee ID": "employeeId",
          "Leave Type": "leaveTypeId",
          "Year": "year",
          "Entitled Days": "entitled",
          "Used Days": "used",
          "Pending Days": "pending",
        }),
        isDefault: true,
        usageCount: 0,
        createdByUserId: 1,
      },
    ]);
    console.log("  ✅ Import mapping templates seeded (3 templates)");
  } else {
    console.log("  ⏭  Import mapping templates already exist");
  }

  // ─── 8. Health Check Run (demo) ────────────────────────────────────────────
  const existingHealthChecks = await db.select().from(systemHealthChecksTable).limit(1);
  if (existingHealthChecks.length === 0) {
    const runId = randomUUID();
    const runAt = new Date();
    await db.insert(systemHealthChecksTable).values([
      { checkName: "Database Connectivity", checkCategory: "database", result: "pass", message: "Database query succeeded", metricValue: "3", metricUnit: "ms", durationMs: 3, isCritical: true, runId, runAt, triggeredByUserId: 1 },
      { checkName: "Disk Usage", checkCategory: "disk", result: "pass", message: "Disk usage: 45%", metricValue: "45", metricUnit: "%", thresholdWarn: "75", thresholdFail: "90", isCritical: false, runId, runAt, triggeredByUserId: 1 },
      { checkName: "Memory Usage", checkCategory: "memory", result: "pass", message: "Memory usage: 62%", metricValue: "62", metricUnit: "%", thresholdWarn: "80", thresholdFail: "90", isCritical: false, runId, runAt, triggeredByUserId: 1 },
      { checkName: "API Health Endpoint", checkCategory: "api", result: "pass", message: "API is responding", metricValue: "1", metricUnit: "ms", durationMs: 1, isCritical: true, runId, runAt, triggeredByUserId: 1 },
      { checkName: "Last Backup Age", checkCategory: "backup", result: "pass", message: "Last backup: 2 hours ago", metricValue: "2", metricUnit: "hours", thresholdWarn: "24", thresholdFail: "48", isCritical: false, runId, runAt, triggeredByUserId: 1 },
      { checkName: "License Validity", checkCategory: "license", result: "pass", message: "License active (no expiry)", isCritical: true, runId, runAt, triggeredByUserId: 1 },
      { checkName: "System Configuration", checkCategory: "config", result: "pass", message: "All required config keys present", isCritical: false, runId, runAt, triggeredByUserId: 1 },
      { checkName: "Default Password Check", checkCategory: "security", result: "pass", message: "No default passwords detected (simulated)", isCritical: true, runId, runAt, triggeredByUserId: 1 },
    ]);
    console.log("  ✅ Initial health check run seeded (8 checks, all pass)");
  } else {
    console.log("  ⏭  Health checks already exist");
  }

  console.log("✅ Phase 8 seeding complete.");
}

seedPhase8().catch((err) => {
  console.error("❌ Phase 8 seeding failed:", err);
  process.exit(1);
});
