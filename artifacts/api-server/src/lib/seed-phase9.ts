/**
 * Phase 9 seed: Multi-Org, Policy Localization, Integration Governance, Config Packages
 * Run: npx tsx src/lib/seed-phase9.ts
 */
import {
  db,
  organizationsTable, organizationBrandingTable,
  policyLocalesTable, numberingSchemesTable, employmentTypeConfigsTable,
  calendarConfigsTable, retentionRulesTable,
  integrationGovernanceRulesTable, integrationCredentialVaultRefsTable,
  integrationConnectionProfilesTable,
  approvalChainConfigsTable,
  environmentSnapshotsTable,
  configPackagesTable, configPackageItemsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { createHash } from "crypto";

async function main() {
  console.log("🌱 Seeding Phase 9...");

  // ─── Organizations ─────────────────────────────────────────────────────────

  const [armco] = await db.insert(organizationsTable).values({
    orgType: "company",
    orgCode: "ARMCO",
    nameEn: "Aramco HR",
    nameAr: "أرامكو للموارد البشرية",
    shortNameEn: "Aramco",
    shortNameAr: "أرامكو",
    status: "active",
    countryCode: "SA",
    isDefault: false,
    activatedAt: new Date(),
    createdByUserId: 1,
  }).returning();

  const [moi] = await db.insert(organizationsTable).values({
    orgType: "ministry",
    orgCode: "MOI",
    nameEn: "Ministry of Interior",
    nameAr: "وزارة الداخلية",
    shortNameEn: "MOI",
    shortNameAr: "وزارة الداخلية",
    status: "active",
    countryCode: "SA",
    isDefault: true,
    activatedAt: new Date(),
    createdByUserId: 1,
  }).returning();

  const [rslf] = await db.insert(organizationsTable).values({
    orgType: "military_unit",
    orgCode: "RSLF-HQ",
    nameEn: "Royal Saudi Land Forces HQ",
    nameAr: "قوات الجيش السعودي - المقر الرئيسي",
    shortNameEn: "RSLF HQ",
    shortNameAr: "الجيش السعودي",
    status: "active",
    countryCode: "SA",
    isDefault: false,
    activatedAt: new Date(),
    createdByUserId: 1,
  }).returning();

  console.log(`✅ Organizations: Aramco(${armco.id}), MOI(${moi.id}), RSLF(${rslf.id})`);

  // ─── Organization Branding ────────────────────────────────────────────────

  await db.insert(organizationBrandingTable).values([
    {
      orgId: armco.id,
      displayNameEn: "Aramco HR Portal",
      displayNameAr: "بوابة أرامكو للموارد البشرية",
      primaryColor: "#D97706",
      accentColor: "#F59E0B",
      defaultTheme: "light",
      updatedByUserId: 1,
    },
    {
      orgId: moi.id,
      displayNameEn: "MOI HR System",
      displayNameAr: "نظام الموارد البشرية - وزارة الداخلية",
      primaryColor: "#1D4ED8",
      accentColor: "#3B82F6",
      defaultTheme: "dark",
      updatedByUserId: 1,
    },
    {
      orgId: rslf.id,
      displayNameEn: "RSLF HR Command",
      displayNameAr: "قيادة الموارد البشرية - الجيش السعودي",
      primaryColor: "#15803D",
      accentColor: "#22C55E",
      defaultTheme: "dark",
      updatedByUserId: 1,
    },
  ]);

  console.log("✅ Organization branding created");

  // ─── Policy Locales ────────────────────────────────────────────────────────

  await db.insert(policyLocalesTable).values([
    {
      orgId: armco.id,
      defaultLanguage: "ar",
      timezone: "Asia/Riyadh",
      calendarType: "gregorian",
      showHijriDates: false,
      currencyCode: "SAR",
      updatedByUserId: 1,
    },
    {
      orgId: moi.id,
      defaultLanguage: "ar",
      timezone: "Asia/Riyadh",
      calendarType: "umm_al_qura",
      showHijriDates: true,
      currencyCode: "SAR",
      updatedByUserId: 1,
    },
    {
      orgId: rslf.id,
      defaultLanguage: "ar",
      timezone: "Asia/Riyadh",
      calendarType: "gregorian",
      showHijriDates: false,
      currencyCode: "SAR",
      updatedByUserId: 1,
    },
  ]);

  console.log("✅ Policy locales created");

  // ─── Numbering Schemes (MOI) ──────────────────────────────────────────────

  await db.insert(numberingSchemesTable).values([
    {
      orgId: moi.id,
      entityType: "employee",
      template: "EMP-{YYYY}-{NNNN}",
      prefix: "EMP",
      currentSequence: 0,
      sequencePadding: 4,
      resetCycle: "per_year",
      isActive: true,
    },
    {
      orgId: moi.id,
      entityType: "leave_request",
      template: "LR-{YYYY}-{MM}-{NNN}",
      prefix: "LR",
      currentSequence: 0,
      sequencePadding: 3,
      resetCycle: "per_month",
      isActive: true,
    },
    {
      orgId: moi.id,
      entityType: "payroll_period",
      template: "PAY-{YYYY}-{NN}",
      prefix: "PAY",
      currentSequence: 0,
      sequencePadding: 2,
      resetCycle: "per_year",
      isActive: true,
    },
  ]);

  console.log("✅ Numbering schemes created");

  // ─── Employment Type Configs (MOI) ────────────────────────────────────────

  await db.insert(employmentTypeConfigsTable).values([
    { orgId: moi.id, employmentType: "civil_servant", labelEn: "Civil Servant", labelAr: "موظف مدني", eligiblePension: true, probationDays: 180, sortOrder: 1 },
    { orgId: moi.id, employmentType: "contract", labelEn: "Contract Employee", labelAr: "موظف عقد", eligiblePension: false, defaultContractMonths: 12, maxRenewals: 3, sortOrder: 2 },
    { orgId: moi.id, employmentType: "consultant", labelEn: "Consultant", labelAr: "استشاري", eligibleLeave: false, eligibleBenefits: false, eligiblePension: false, probationEnabled: false, sortOrder: 3 },
    { orgId: moi.id, employmentType: "temp", labelEn: "Temporary", labelAr: "مؤقت", eligibleBenefits: false, eligiblePension: false, defaultContractMonths: 3, maxRenewals: 1, sortOrder: 4 },
    { orgId: moi.id, employmentType: "intern", labelEn: "Intern", labelAr: "متدرب", eligibleLeave: false, eligiblePayroll: true, eligibleBenefits: false, eligiblePension: false, probationEnabled: false, defaultContractMonths: 6, sortOrder: 5 },
  ]);

  console.log("✅ Employment type configs created");

  // ─── Calendar Configs ─────────────────────────────────────────────────────

  await db.insert(calendarConfigsTable).values([
    {
      orgId: armco.id,
      weekendDaysJson: "[5,6]",
      standardHoursPerDay: 9,
      defaultShiftStart: "07:00",
      defaultShiftEnd: "16:00",
      updatedByUserId: 1,
    },
    {
      orgId: moi.id,
      weekendDaysJson: "[4,5]",
      standardHoursPerDay: 8,
      defaultShiftStart: "08:00",
      defaultShiftEnd: "16:00",
      updatedByUserId: 1,
    },
    {
      orgId: rslf.id,
      weekendDaysJson: "[4,5]",
      standardHoursPerDay: 8,
      defaultShiftStart: "06:00",
      defaultShiftEnd: "14:00",
      updatedByUserId: 1,
    },
  ]);

  console.log("✅ Calendar configs created");

  // ─── Retention Rules (MOI) ────────────────────────────────────────────────

  await db.insert(retentionRulesTable).values([
    { orgId: moi.id, dataCategory: "employee_records", labelEn: "Employee Records", labelAr: "سجلات الموظفين", retentionMonths: 120, expiryAction: "archive" },
    { orgId: moi.id, dataCategory: "payroll_runs", labelEn: "Payroll Runs", labelAr: "مسيرات الرواتب", retentionMonths: 84, expiryAction: "archive" },
    { orgId: moi.id, dataCategory: "audit_logs", labelEn: "Audit Logs", labelAr: "سجلات التدقيق", retentionMonths: 84, expiryAction: "archive" },
    { orgId: moi.id, dataCategory: "attendance_logs", labelEn: "Attendance Logs", labelAr: "سجلات الحضور", retentionMonths: 36, expiryAction: "archive" },
    { orgId: moi.id, dataCategory: "documents", labelEn: "Documents", labelAr: "الوثائق", retentionMonths: 60, expiryAction: "archive" },
    { orgId: moi.id, dataCategory: "leave_requests", labelEn: "Leave Requests", labelAr: "طلبات الإجازة", retentionMonths: 36, expiryAction: "archive" },
    { orgId: moi.id, dataCategory: "appraisals", labelEn: "Performance Appraisals", labelAr: "تقييمات الأداء", retentionMonths: 60, expiryAction: "archive" },
    { orgId: moi.id, dataCategory: "health_data", labelEn: "Health Data", labelAr: "البيانات الصحية", retentionMonths: 0, expiryAction: "archive" },
  ]);

  console.log("✅ Retention rules created");

  // ─── Integration Governance Rules ─────────────────────────────────────────

  await db.insert(integrationGovernanceRulesTable).values([
    {
      orgId: moi.id,
      integrationType: "ldap",
      ruleCode: "ldap-required",
      titleEn: "LDAP Integration Required",
      titleAr: "تكامل LDAP مطلوب",
      permissionLevel: "required",
      requiresDualAuth: true,
      requiresMakerChecker: true,
      maxActiveProfiles: 2,
      allowExternalNetwork: false,
    },
    {
      orgId: moi.id,
      integrationType: "attendance_device",
      ruleCode: "attendance-allowed",
      titleEn: "Attendance Device Integration Allowed",
      titleAr: "تكامل أجهزة الحضور مسموح",
      permissionLevel: "allowed",
      requiresMakerChecker: true,
      maxActiveProfiles: 5,
      allowExternalNetwork: false,
    },
    {
      orgId: moi.id,
      integrationType: "smtp",
      ruleCode: "smtp-allowed",
      titleEn: "SMTP Email Integration Allowed",
      titleAr: "تكامل البريد الإلكتروني SMTP مسموح",
      permissionLevel: "allowed",
      requiresMakerChecker: false,
      maxActiveProfiles: 1,
      allowExternalNetwork: false,
    },
    {
      orgId: moi.id,
      integrationType: "external_api",
      ruleCode: "external-prohibited",
      titleEn: "External API Integration Prohibited",
      titleAr: "تكامل واجهة API الخارجية محظور",
      permissionLevel: "prohibited",
      requiresDualAuth: true,
      requiresMakerChecker: true,
      maxActiveProfiles: 0,
      allowExternalNetwork: false,
    },
  ]);

  console.log("✅ Governance rules created");

  // ─── Credential Vault Refs ────────────────────────────────────────────────

  const [ldapCred] = await db.insert(integrationCredentialVaultRefsTable).values({
    labelEn: "LDAP Main Credentials",
    labelAr: "بيانات اعتماد LDAP الرئيسية",
    credentialType: "ldap",
    vaultKeyRef: "vault:ldap_bind_dn",
    vaultSecretRef: "vault:ldap_bind_password",
    descriptionEn: "Active Directory bind credentials for MOI domain",
    status: "active",
    ownerUserId: 1,
    createdByUserId: 1,
  }).returning();

  const [smtpCred] = await db.insert(integrationCredentialVaultRefsTable).values({
    labelEn: "SMTP Relay Credentials",
    labelAr: "بيانات اعتماد مرحل البريد",
    credentialType: "smtp",
    vaultKeyRef: "vault:smtp_username",
    vaultSecretRef: "vault:smtp_password",
    descriptionEn: "Internal SMTP relay credentials",
    status: "active",
    ownerUserId: 1,
    createdByUserId: 1,
  }).returning();

  const [attendanceCred] = await db.insert(integrationCredentialVaultRefsTable).values({
    labelEn: "Attendance API Credentials",
    labelAr: "بيانات اعتماد واجهة أجهزة الحضور",
    credentialType: "attendance_device",
    vaultKeyRef: "vault:attendance_api_key",
    descriptionEn: "API key for attendance device integration",
    status: "active",
    ownerUserId: 1,
    createdByUserId: 1,
  }).returning();

  console.log(`✅ Credential vault refs created`);

  // ─── Connection Profiles ──────────────────────────────────────────────────

  await db.insert(integrationConnectionProfilesTable).values([
    {
      orgId: moi.id,
      profileName: "LDAP Active Directory",
      profileNameAr: "دليل نشط LDAP",
      integrationType: "ldap",
      environment: "production",
      connectionParamsJson: JSON.stringify({ host: "192.168.1.10", port: 389, baseDn: "DC=moi,DC=gov,DC=sa", bindDnRef: "vault:ldap_bind_dn" }),
      credentialVaultRefId: ldapCred.id,
      governanceStatus: "pending_approval",
      isAirGapSafe: true,
      createdByUserId: 1,
    },
    {
      orgId: moi.id,
      profileName: "Attendance Device API",
      profileNameAr: "واجهة برمجة أجهزة الحضور",
      integrationType: "attendance_device",
      environment: "production",
      connectionParamsJson: JSON.stringify({ baseUrl: "http://192.168.2.20:8080/api", apiKeyRef: "vault:attendance_api_key" }),
      credentialVaultRefId: attendanceCred.id,
      governanceStatus: "approved",
      approvedByUserId: 1,
      approvedAt: new Date(),
      isAirGapSafe: true,
      createdByUserId: 1,
    },
  ]);

  console.log("✅ Connection profiles created");

  // ─── Approval Chain Configs ────────────────────────────────────────────────

  await db.insert(approvalChainConfigsTable).values([
    {
      orgId: moi.id,
      name: "Leave 2-Step Approval",
      nameAr: "موافقة إجازة من خطوتين",
      chainType: "leave",
      stepsJson: JSON.stringify([
        { stepNumber: 1, labelEn: "Direct Manager", labelAr: "المدير المباشر", approverType: "department_head", autoApproveIfNone: false, timeoutHours: 48 },
        { stepNumber: 2, labelEn: "HR Manager", labelAr: "مدير الموارد البشرية", approverType: "role", autoApproveIfNone: true, timeoutHours: 24 },
      ]),
      requireAllSteps: true,
      totalTimeoutHours: 72,
      timeoutAction: "escalate",
      createdByUserId: 1,
    },
    {
      orgId: moi.id,
      name: "Policy Change 3-Step Approval",
      nameAr: "موافقة تغيير السياسة من 3 خطوات",
      chainType: "policy_change",
      stepsJson: JSON.stringify([
        { stepNumber: 1, labelEn: "Department Head", labelAr: "رئيس القسم", approverType: "department_head", autoApproveIfNone: false, timeoutHours: 48 },
        { stepNumber: 2, labelEn: "HR Director", labelAr: "مدير الموارد البشرية", approverType: "role", autoApproveIfNone: false, timeoutHours: 72 },
        { stepNumber: 3, labelEn: "Minister Approval", labelAr: "موافقة الوزير", approverType: "user", autoApproveIfNone: false, timeoutHours: 120 },
      ]),
      requireAllSteps: true,
      totalTimeoutHours: 240,
      timeoutAction: "escalate",
      createdByUserId: 1,
    },
    {
      orgId: moi.id,
      name: "Payroll Approval 2-Step",
      nameAr: "موافقة الرواتب من خطوتين",
      chainType: "payroll",
      stepsJson: JSON.stringify([
        { stepNumber: 1, labelEn: "Payroll Manager", labelAr: "مدير الرواتب", approverType: "role", autoApproveIfNone: false, timeoutHours: 24 },
        { stepNumber: 2, labelEn: "Finance Director", labelAr: "مدير المالية", approverType: "role", autoApproveIfNone: false, timeoutHours: 48 },
      ]),
      requireAllSteps: true,
      totalTimeoutHours: 72,
      timeoutAction: "reject",
      createdByUserId: 1,
    },
  ]);

  console.log("✅ Approval chain configs created");

  // ─── Environment Snapshot ─────────────────────────────────────────────────

  const snapshotData = {
    capturedAt: new Date().toISOString(),
    scope: "full",
    environment: "production",
    org: "MOI",
    config: {
      organizations: 3,
      policies: "active",
      integrations: "configured",
    },
  };
  const snapshotStr = JSON.stringify(snapshotData);
  const checksum = createHash("sha256").update(snapshotStr).digest("hex");

  await db.insert(environmentSnapshotsTable).values({
    environment: "production",
    orgId: moi.id,
    snapshotName: "Initial Production Snapshot — MOI",
    scope: "full",
    snapshotJson: snapshotStr,
    checksum,
    itemCount: 3,
    capturedByUserId: 1,
    isPinned: true,
    notes: "Initial production baseline for MOI deployment",
  });

  console.log("✅ Environment snapshot created");

  // ─── Config Packages ──────────────────────────────────────────────────────

  const brandingPayload = JSON.stringify({ branding: { orgId: moi.id, primaryColor: "#1D4ED8" } });
  const brandingChecksum = createHash("sha256").update(brandingPayload).digest("hex");

  const [appliedPkg] = await db.insert(configPackagesTable).values({
    packageName: "MOI Branding Patch v1.0",
    packageType: "branding",
    status: "applied",
    version: "1.0.0",
    sourceEnvironment: "development",
    targetEnvironment: "production",
    orgId: moi.id,
    descriptionEn: "Applied branding patch with MOI colors",
    policyAreasJson: JSON.stringify(["org_branding"]),
    payloadJson: brandingPayload,
    payloadChecksum: brandingChecksum,
    appliedAt: new Date(),
    appliedByUserId: 1,
    createdByUserId: 1,
  }).returning();

  await db.insert(configPackageItemsTable).values({
    packageId: appliedPkg.id,
    policyArea: "org_branding",
    entityType: "organization_branding",
    entityId: moi.id,
    entityLabel: "MOI Branding",
    changeType: "update",
    afterJson: JSON.stringify({ primaryColor: "#1D4ED8" }),
    applyStatus: "applied",
  });

  const policyPayload = JSON.stringify({ policies: ["leave_policy", "calendar_config"] });
  const policyChecksum = createHash("sha256").update(policyPayload).digest("hex");

  await db.insert(configPackagesTable).values({
    packageName: "MOI Policy Set v2.0",
    packageType: "policy_set",
    status: "draft",
    version: "2.0.0",
    sourceEnvironment: "development",
    targetEnvironment: "production",
    orgId: moi.id,
    descriptionEn: "Pending policy configuration set for MOI",
    policyAreasJson: JSON.stringify(["leave_policy", "calendar_config"]),
    payloadJson: policyPayload,
    payloadChecksum: policyChecksum,
    createdByUserId: 1,
  });

  console.log("✅ Config packages created");
  console.log("🎉 Phase 9 seed complete!");
}

main().catch(console.error).finally(() => process.exit(0));
