/**
 * Phase 4 seed — Government / Military Readiness demo data.
 * Run with: npx tsx artifacts/api-server/src/lib/seed-phase4.ts
 */
import { db } from "@workspace/db";
import {
  systemConfigTable,
  militaryRanksTable,
  orgUnitsTable,
  dutyStationsTable,
  employeePostingsTable,
  employeeTransfersTable,
  securityClearancesTable,
  mobilizationStatusesTable,
  chainOfCommandTable,
  dualAuthRequestsTable,
  breakGlassAccessTable,
  branchServersTable,
  syncQueueTable,
  backupRecordsTable,
  licenseRecordsTable,
} from "@workspace/db";
import { createHash } from "crypto";

async function seed() {
  console.log("🌱 Seeding Phase 4 — Government / Military Readiness...");

  // ─── System Config ────────────────────────────────────────────────────────
  console.log("  → system_config");
  await db.delete(systemConfigTable);
  await db.insert(systemConfigTable).values([
    // Organization profile
    { key: "org.type", value: "military", valueType: "string", category: "organization", labelEn: "Organization Type", labelAr: "نوع المنظمة", descriptionEn: "commercial | government | military", isPublic: true, isReadonly: false },
    { key: "org.name", value: "Royal Armed Forces Command — HR Directorate", valueType: "string", category: "organization", labelEn: "Organization Name", labelAr: "اسم المنظمة", isPublic: true, isReadonly: false },
    { key: "org.name_ar", value: "قيادة القوات المسلحة الملكية — مديرية الموارد البشرية", valueType: "string", category: "organization", labelEn: "Organization Name (Arabic)", labelAr: "اسم المنظمة (عربي)", isPublic: true, isReadonly: false },
    { key: "org.country", value: "Saudi Arabia", valueType: "string", category: "organization", labelEn: "Country", labelAr: "الدولة", isPublic: true, isReadonly: false },
    // Payroll settings
    { key: "payroll.maxOtSessionHours", value: "12", valueType: "number", category: "payroll", labelEn: "Max Overtime Session (hours)", labelAr: "الحد الأقصى لجلسة العمل الإضافي (ساعات)", descriptionEn: "Sanity cap for a single paired overtime session. Longer sessions are clamped to this cap and the payroll run is flagged for HR review. Must be a positive number of hours.", isPublic: true, isReadonly: false },
    { key: "payroll.weekendDays", value: "[5,6]", valueType: "json", category: "payroll", labelEn: "Weekend Days (0=Sun … 6=Sat)", labelAr: "أيام عطلة نهاية الأسبوع (0=الأحد … 6=السبت)", descriptionEn: "JSON array of weekly off-day indexes used by payroll working-day calculations. Default [5,6] = Friday/Saturday.", isPublic: true, isReadonly: false },
    // Security settings
    { key: "security.level", value: "secret", valueType: "string", category: "security", labelEn: "Default Classification Level", labelAr: "مستوى التصنيف الافتراضي", descriptionEn: "unclassified | restricted | confidential | secret | top_secret", isPublic: false, isReadonly: false },
    { key: "security.dual_auth_enabled", value: "true", valueType: "boolean", category: "security", labelEn: "Dual Authorization Enabled", labelAr: "تفعيل التفويض المزدوج", isPublic: false, isReadonly: false },
    { key: "security.break_glass_ttl_minutes", value: "60", valueType: "number", category: "security", labelEn: "Break-Glass TTL (minutes)", labelAr: "مدة وصول الطوارئ (دقائق)", isPublic: false, isReadonly: false },
    { key: "security.privileged_session_monitoring", value: "true", valueType: "boolean", category: "security", labelEn: "Privileged Session Monitoring", labelAr: "مراقبة الجلسات المميزة", isPublic: false, isReadonly: false },
    { key: "security.audit_retention_days", value: "3650", valueType: "number", category: "security", labelEn: "Audit Log Retention (days)", labelAr: "مدة الاحتفاظ بسجلات التدقيق (أيام)", isPublic: false, isReadonly: false },
    // Feature flags
    { key: "features.military_hierarchy", value: "true", valueType: "boolean", category: "features", labelEn: "Military Hierarchy Module", labelAr: "وحدة التسلسل العسكري", isPublic: false, isReadonly: false },
    { key: "features.security_clearances", value: "true", valueType: "boolean", category: "features", labelEn: "Security Clearance Management", labelAr: "إدارة التصاريح الأمنية", isPublic: false, isReadonly: false },
    { key: "features.mobilization", value: "true", valueType: "boolean", category: "features", labelEn: "Mobilization Tracking", labelAr: "تتبع التعبئة", isPublic: false, isReadonly: false },
    { key: "features.airgap_sync", value: "true", valueType: "boolean", category: "features", labelEn: "Air-Gap Branch Sync", labelAr: "مزامنة الفروع المعزولة", isPublic: false, isReadonly: false },
    { key: "features.smart_card_auth", value: "false", valueType: "boolean", category: "features", labelEn: "Smart Card Authentication [REQUIRES SETUP]", labelAr: "مصادقة البطاقة الذكية [يتطلب إعداداً]", descriptionEn: "Requires external smart card reader infrastructure and PKI CA configuration", isPublic: false, isReadonly: false },
    { key: "features.hsm_encryption", value: "false", valueType: "boolean", category: "features", labelEn: "HSM Encryption [REQUIRES SETUP]", labelAr: "تشفير HSM [يتطلب إعداداً]", descriptionEn: "Requires Hardware Security Module (HSM) provisioning", isPublic: false, isReadonly: false },
    // DR / Backup
    { key: "backup.rpo_hours", value: "24", valueType: "number", category: "backup", labelEn: "Recovery Point Objective (hours)", labelAr: "هدف نقطة الاسترداد (ساعات)", isPublic: false, isReadonly: false },
    { key: "backup.rto_hours", value: "4", valueType: "number", category: "backup", labelEn: "Recovery Time Objective (hours)", labelAr: "هدف وقت الاسترداد (ساعات)", isPublic: false, isReadonly: false },
    { key: "backup.retention_days", value: "365", valueType: "number", category: "backup", labelEn: "Backup Retention (days)", labelAr: "مدة الاحتفاظ بالنسخ الاحتياطية (أيام)", isPublic: false, isReadonly: false },
  ]);

  // ─── Military Ranks ───────────────────────────────────────────────────────
  console.log("  → military_ranks");
  await db.delete(militaryRanksTable);
  await db.insert(militaryRanksTable).values([
    // Enlisted
    { rankCode: "RCT", abbreviationEn: "Rct", abbreviationAr: "مجند", nameEn: "Recruit", nameAr: "مجنّد", category: "enlisted", natoEquivalent: "OR-1", rankOrder: 1, organizationType: "military" },
    { rankCode: "PVT", abbreviationEn: "Pvt", abbreviationAr: "جندي", nameEn: "Private", nameAr: "جندي", category: "enlisted", natoEquivalent: "OR-2", rankOrder: 2, organizationType: "military" },
    { rankCode: "LCPL", abbreviationEn: "LCpl", abbreviationAr: "عريف", nameEn: "Lance Corporal", nameAr: "عريف", category: "enlisted", natoEquivalent: "OR-3", rankOrder: 3, organizationType: "military" },
    { rankCode: "CPL", abbreviationEn: "Cpl", abbreviationAr: "جندي أول", nameEn: "Corporal", nameAr: "جندي أول", category: "enlisted", natoEquivalent: "OR-4", rankOrder: 4, organizationType: "military" },
    // NCO
    { rankCode: "SGT", abbreviationEn: "Sgt", abbreviationAr: "رقيب", nameEn: "Sergeant", nameAr: "رقيب", category: "nco", natoEquivalent: "OR-5", rankOrder: 5, organizationType: "military" },
    { rankCode: "SSGT", abbreviationEn: "SSgt", abbreviationAr: "رقيب أول", nameEn: "Staff Sergeant", nameAr: "رقيب أول", category: "nco", natoEquivalent: "OR-6", rankOrder: 6, organizationType: "military" },
    { rankCode: "SFC", abbreviationEn: "SFC", abbreviationAr: "رقيب أول متميز", nameEn: "Sergeant First Class", nameAr: "رقيب أول متميز", category: "nco", natoEquivalent: "OR-7", rankOrder: 7, organizationType: "military" },
    { rankCode: "MSG", abbreviationEn: "MSG", abbreviationAr: "رقيب أقدم", nameEn: "Master Sergeant", nameAr: "رقيب أقدم", category: "nco", natoEquivalent: "OR-8", rankOrder: 8, organizationType: "military" },
    { rankCode: "SGM", abbreviationEn: "SGM", abbreviationAr: "رقيب مراسم", nameEn: "Sergeant Major", nameAr: "رقيب مراسم", category: "nco", natoEquivalent: "OR-9", rankOrder: 9, organizationType: "military" },
    // Officers
    { rankCode: "2LT", abbreviationEn: "2Lt", abbreviationAr: "ملازم ثانٍ", nameEn: "Second Lieutenant", nameAr: "ملازم ثانٍ", category: "officer", natoEquivalent: "OF-1", rankOrder: 10, organizationType: "military" },
    { rankCode: "1LT", abbreviationEn: "1Lt", abbreviationAr: "ملازم أول", nameEn: "First Lieutenant", nameAr: "ملازم أول", category: "officer", natoEquivalent: "OF-1", rankOrder: 11, organizationType: "military" },
    { rankCode: "CPT", abbreviationEn: "Cpt", abbreviationAr: "نقيب", nameEn: "Captain", nameAr: "نقيب", category: "officer", natoEquivalent: "OF-2", rankOrder: 12, organizationType: "military" },
    { rankCode: "MAJ", abbreviationEn: "Maj", abbreviationAr: "رائد", nameEn: "Major", nameAr: "رائد", category: "officer", natoEquivalent: "OF-3", rankOrder: 13, organizationType: "military" },
    { rankCode: "LTCOL", abbreviationEn: "LtCol", abbreviationAr: "مقدم", nameEn: "Lieutenant Colonel", nameAr: "مقدم", category: "officer", natoEquivalent: "OF-4", rankOrder: 14, organizationType: "military" },
    { rankCode: "COL", abbreviationEn: "Col", abbreviationAr: "عقيد", nameEn: "Colonel", nameAr: "عقيد", category: "officer", natoEquivalent: "OF-5", rankOrder: 15, organizationType: "military" },
    // Generals / Flag
    { rankCode: "BGEN", abbreviationEn: "BGen", abbreviationAr: "عميد", nameEn: "Brigadier General", nameAr: "عميد", category: "general", natoEquivalent: "OF-6", rankOrder: 16, organizationType: "military" },
    { rankCode: "MGEN", abbreviationEn: "MGen", abbreviationAr: "لواء", nameEn: "Major General", nameAr: "لواء", category: "general", natoEquivalent: "OF-7", rankOrder: 17, organizationType: "military" },
    { rankCode: "LTGEN", abbreviationEn: "LtGen", abbreviationAr: "فريق", nameEn: "Lieutenant General", nameAr: "فريق", category: "general", natoEquivalent: "OF-8", rankOrder: 18, organizationType: "military" },
    { rankCode: "GEN", abbreviationEn: "Gen", abbreviationAr: "فريق أول", nameEn: "General", nameAr: "فريق أول", category: "flag", natoEquivalent: "OF-9", rankOrder: 19, organizationType: "military" },
    // Government grades
    { rankCode: "GOV-5", abbreviationEn: "G5", abbreviationAr: "م5", nameEn: "Government Grade 5", nameAr: "المستوى الحكومي 5", category: "civilian", rankOrder: 5, organizationType: "government" },
    { rankCode: "GOV-7", abbreviationEn: "G7", abbreviationAr: "م7", nameEn: "Government Grade 7", nameAr: "المستوى الحكومي 7", category: "civilian", rankOrder: 7, organizationType: "government" },
    { rankCode: "GOV-10", abbreviationEn: "G10", abbreviationAr: "م10", nameEn: "Government Grade 10", nameAr: "المستوى الحكومي 10", category: "civilian", rankOrder: 10, organizationType: "government" },
  ]);

  // ─── Org Units ────────────────────────────────────────────────────────────
  console.log("  → org_units");
  await db.delete(orgUnitsTable);
  // Insert top-level roots first to get real IDs
  const [rafHq] = await db.insert(orgUnitsTable).values({ unitCode: "RAF-HQ", nameEn: "Royal Armed Forces — HQ", nameAr: "القوات المسلحة الملكية — المقر العام", shortNameEn: "RAF-HQ", unitType: "command", organizationType: "military", parentId: null, levelDepth: 1, authorizedStrength: 50000, currentStrength: 47832, classificationLevel: "secret" }).returning();
  const [govAdmin] = await db.insert(orgUnitsTable).values({ unitCode: "GOV-ADMIN", nameEn: "General Administration Department", nameAr: "دائرة الإدارة العامة", shortNameEn: "GAD", unitType: "department", organizationType: "government", parentId: null, levelDepth: 1, authorizedStrength: 80, currentStrength: 74, classificationLevel: "unclassified" }).returning();
  // Directorates under HQ
  const [rafHr] = await db.insert(orgUnitsTable).values({ unitCode: "RAF-HR", nameEn: "HR Directorate", nameAr: "مديرية الموارد البشرية", shortNameEn: "HR-DIR", unitType: "directorate", organizationType: "military", parentId: rafHq.id, levelDepth: 2, authorizedStrength: 200, currentStrength: 187, classificationLevel: "confidential" }).returning();
  const [rafOps] = await db.insert(orgUnitsTable).values({ unitCode: "RAF-OPS", nameEn: "Operations Directorate", nameAr: "مديرية العمليات", shortNameEn: "OPS-DIR", unitType: "directorate", organizationType: "military", parentId: rafHq.id, levelDepth: 2, authorizedStrength: 500, currentStrength: 498, classificationLevel: "secret" }).returning();
  const [rafLog] = await db.insert(orgUnitsTable).values({ unitCode: "RAF-LOG", nameEn: "Logistics Directorate", nameAr: "مديرية اللوجستيك", shortNameEn: "LOG-DIR", unitType: "directorate", organizationType: "military", parentId: rafHq.id, levelDepth: 2, authorizedStrength: 300, currentStrength: 289, classificationLevel: "confidential" }).returning();
  const [rafInt] = await db.insert(orgUnitsTable).values({ unitCode: "RAF-INT", nameEn: "Intelligence Directorate", nameAr: "مديرية الاستخبارات", shortNameEn: "INT-DIR", unitType: "directorate", organizationType: "military", parentId: rafHq.id, levelDepth: 2, authorizedStrength: 150, currentStrength: 143, classificationLevel: "top_secret" }).returning();
  const [govFin] = await db.insert(orgUnitsTable).values({ unitCode: "GOV-FIN", nameEn: "Finance Department", nameAr: "دائرة المالية", shortNameEn: "FIN", unitType: "department", organizationType: "government", parentId: govAdmin.id, levelDepth: 2, authorizedStrength: 30, currentStrength: 28, classificationLevel: "restricted" }).returning();
  // Brigades under OPS
  const [brig1] = await db.insert(orgUnitsTable).values({ unitCode: "1-BRIG", nameEn: "1st Brigade", nameAr: "اللواء الأول", shortNameEn: "1BDE", unitType: "brigade", organizationType: "military", parentId: rafOps.id, levelDepth: 3, authorizedStrength: 3500, currentStrength: 3412, classificationLevel: "confidential" }).returning();
  const [brig2] = await db.insert(orgUnitsTable).values({ unitCode: "2-BRIG", nameEn: "2nd Brigade", nameAr: "اللواء الثاني", shortNameEn: "2BDE", unitType: "brigade", organizationType: "military", parentId: rafOps.id, levelDepth: 3, authorizedStrength: 3500, currentStrength: 3287, classificationLevel: "confidential" }).returning();
  // Battalions under 1st Brigade
  const [bn11] = await db.insert(orgUnitsTable).values({ unitCode: "1-1-BN", nameEn: "1st Battalion / 1st Brigade", nameAr: "الكتيبة الأولى / اللواء الأول", shortNameEn: "1/1 BN", unitType: "battalion", organizationType: "military", parentId: brig1.id, levelDepth: 4, authorizedStrength: 800, currentStrength: 782, classificationLevel: "restricted" }).returning();
  const [bn12] = await db.insert(orgUnitsTable).values({ unitCode: "1-2-BN", nameEn: "2nd Battalion / 1st Brigade", nameAr: "الكتيبة الثانية / اللواء الأول", shortNameEn: "1/2 BN", unitType: "battalion", organizationType: "military", parentId: brig1.id, levelDepth: 4, authorizedStrength: 800, currentStrength: 771, classificationLevel: "restricted" }).returning();
  // Map for use by postings
  const uId = { rafHq: rafHq.id, rafHr: rafHr.id, rafOps: rafOps.id, rafLog: rafLog.id, rafInt: rafInt.id, brig1: brig1.id, brig2: brig2.id, bn11: bn11.id, bn12: bn12.id, govAdmin: govAdmin.id, govFin: govFin.id };

  // ─── Duty Stations ────────────────────────────────────────────────────────
  console.log("  → duty_stations");
  await db.delete(dutyStationsTable);
  await db.insert(dutyStationsTable).values([
    { stationCode: "RIYADH-HQ", nameEn: "Riyadh — Main HQ", nameAr: "الرياض — المقر الرئيسي", country: "Saudi Arabia", region: "Riyadh Region", city: "Riyadh", latitude: "24.6877", longitude: "46.7219", stationType: "headquarters", classificationLevel: "secret", timezoneName: "Asia/Riyadh" },
    { stationCode: "JEDDAH-REG", nameEn: "Jeddah — Western Regional Command", nameAr: "جدة — قيادة المنطقة الغربية", country: "Saudi Arabia", region: "Makkah Region", city: "Jeddah", latitude: "21.5433", longitude: "39.1728", stationType: "main_base", classificationLevel: "confidential", timezoneName: "Asia/Riyadh" },
    { stationCode: "DAMMAM-EAST", nameEn: "Dammam — Eastern Province Command", nameAr: "الدمام — قيادة المنطقة الشرقية", country: "Saudi Arabia", region: "Eastern Province", city: "Dammam", latitude: "26.3927", longitude: "49.9777", stationType: "main_base", classificationLevel: "confidential", timezoneName: "Asia/Riyadh" },
    { stationCode: "TABUK-FWD", nameEn: "Tabuk — Forward Operating Base", nameAr: "تبوك — القاعدة الأمامية", country: "Saudi Arabia", region: "Tabuk Region", city: "Tabuk", latitude: "28.3838", longitude: "36.5556", stationType: "forward_base", classificationLevel: "secret", timezoneName: "Asia/Riyadh" },
    { stationCode: "KHAMIS-TRG", nameEn: "Khamis Mushayt — Training Center", nameAr: "خميس مشيط — مركز التدريب", country: "Saudi Arabia", region: "Aseer Region", city: "Khamis Mushayt", latitude: "18.3059", longitude: "42.7296", stationType: "training_center", classificationLevel: "restricted", timezoneName: "Asia/Riyadh" },
    { stationCode: "ADMIN-RIYADH", nameEn: "Riyadh — Administrative Compound", nameAr: "الرياض — المجمع الإداري", country: "Saudi Arabia", region: "Riyadh Region", city: "Riyadh", stationType: "administrative", classificationLevel: "unclassified", timezoneName: "Asia/Riyadh" },
  ]);

  // ─── Employee Postings (sample — using first 10 employees) ────────────────
  console.log("  → employee_postings");
  await db.delete(employeePostingsTable);
  const ranks = await db.select().from(militaryRanksTable);
  const rankByCode: Record<string, number> = {};
  for (const r of ranks) rankByCode[r.rankCode] = r.id;
  // Build duty station ID lookup by stationCode
  const dStations = await db.select().from(dutyStationsTable);
  const dsId: Record<string, number> = {};
  for (const d of dStations) dsId[d.stationCode] = d.id;

  await db.insert(employeePostingsTable).values([
    { employeeId: 1, orgUnitId: uId.rafHr, dutyStationId: dsId["RIYADH-HQ"], rankId: rankByCode["COL"], positionTitleEn: "Director of Human Resources", positionTitleAr: "مدير الموارد البشرية", positionCode: "HR-DIR-001", postingType: "permanent", startDate: "2022-01-15", isCurrent: true, orderNumber: "ORD-2022-001" },
    { employeeId: 2, orgUnitId: uId.rafHr, dutyStationId: dsId["RIYADH-HQ"], rankId: rankByCode["LTCOL"], positionTitleEn: "Deputy HR Director", positionTitleAr: "نائب مدير الموارد البشرية", positionCode: "HR-DEP-001", postingType: "permanent", startDate: "2022-03-01", isCurrent: true, orderNumber: "ORD-2022-015" },
    { employeeId: 3, orgUnitId: uId.brig1, dutyStationId: dsId["JEDDAH-REG"], rankId: rankByCode["BGEN"], positionTitleEn: "1st Brigade Commander", positionTitleAr: "قائد اللواء الأول", positionCode: "1BDE-CMD", postingType: "permanent", startDate: "2021-07-01", isCurrent: true, orderNumber: "ORD-2021-089" },
    { employeeId: 4, orgUnitId: uId.brig1, dutyStationId: dsId["JEDDAH-REG"], rankId: rankByCode["COL"], positionTitleEn: "Brigade Chief of Staff", positionTitleAr: "رئيس أركان اللواء", positionCode: "1BDE-COS", postingType: "permanent", startDate: "2021-09-15", isCurrent: true, orderNumber: "ORD-2021-102" },
    { employeeId: 5, orgUnitId: uId.bn11, dutyStationId: dsId["JEDDAH-REG"], rankId: rankByCode["LTCOL"], positionTitleEn: "Battalion Commander", positionTitleAr: "قائد الكتيبة", positionCode: "1-1BN-CMD", postingType: "permanent", startDate: "2023-01-10", isCurrent: true, orderNumber: "ORD-2023-003" },
    { employeeId: 6, orgUnitId: uId.rafOps, dutyStationId: dsId["RIYADH-HQ"], rankId: rankByCode["MAJ"], positionTitleEn: "Operations Planning Officer", positionTitleAr: "ضابط تخطيط العمليات", positionCode: "OPS-PLN-002", postingType: "permanent", startDate: "2022-06-01", isCurrent: true, orderNumber: "ORD-2022-044" },
    { employeeId: 7, orgUnitId: uId.rafInt, dutyStationId: dsId["RIYADH-HQ"], rankId: rankByCode["CPT"], positionTitleEn: "Intelligence Analyst", positionTitleAr: "محلل استخباراتي", positionCode: "INT-ANL-003", postingType: "permanent", startDate: "2023-03-15", isCurrent: true, orderNumber: "ORD-2023-022" },
    { employeeId: 8, orgUnitId: uId.bn12, dutyStationId: dsId["DAMMAM-EAST"], rankId: rankByCode["MAJ"], positionTitleEn: "Battalion Operations Officer", positionTitleAr: "ضابط عمليات الكتيبة", positionCode: "1-2BN-OPS", postingType: "permanent", startDate: "2022-11-01", isCurrent: true, orderNumber: "ORD-2022-098" },
    { employeeId: 9, orgUnitId: uId.rafLog, dutyStationId: dsId["RIYADH-HQ"], rankId: rankByCode["CPT"], positionTitleEn: "Supply Chain Officer", positionTitleAr: "ضابط سلسلة الإمداد", positionCode: "LOG-SUP-004", postingType: "permanent", startDate: "2023-05-01", isCurrent: true, orderNumber: "ORD-2023-041" },
    { employeeId: 10, orgUnitId: uId.bn11, dutyStationId: dsId["TABUK-FWD"], rankId: rankByCode["1LT"], positionTitleEn: "Platoon Leader", positionTitleAr: "قائد الفصيلة", positionCode: "1-1BN-PLT-A", postingType: "permanent", startDate: "2023-08-01", isCurrent: true, orderNumber: "ORD-2023-071" },
  ]);

  // ─── Employee Transfers (sample historical transfers) ─────────────────────
  console.log("  → employee_transfers");
  await db.delete(employeeTransfersTable);
  await db.insert(employeeTransfersTable).values([
    { employeeId: 4, fromOrgUnitId: uId.brig2, toOrgUnitId: uId.brig1, fromStationId: dsId["DAMMAM-EAST"], toStationId: dsId["JEDDAH-REG"], transferDate: "2021-09-01", effectiveDate: "2021-09-15", orderNumber: "TRF-2021-088", status: "executed", reasonEn: "Command restructuring — reallocation of senior staff between brigades", requiresDualAuth: false },
    { employeeId: 7, fromOrgUnitId: uId.rafOps, toOrgUnitId: uId.rafInt, fromStationId: dsId["RIYADH-HQ"], toStationId: dsId["RIYADH-HQ"], transferDate: "2023-02-15", effectiveDate: "2023-03-15", orderNumber: "TRF-2023-019", status: "executed", reasonEn: "Specialist technical skills required in Intelligence Directorate", requiresDualAuth: true },
    { employeeId: 10, fromOrgUnitId: uId.bn12, toOrgUnitId: uId.bn11, fromStationId: dsId["DAMMAM-EAST"], toStationId: dsId["TABUK-FWD"], transferDate: "2023-07-20", effectiveDate: "2023-08-01", orderNumber: "TRF-2023-067", status: "executed", requiresDualAuth: false },
    { employeeId: 6, fromOrgUnitId: null, toOrgUnitId: uId.rafOps, toStationId: dsId["RIYADH-HQ"], transferDate: "2026-09-01", effectiveDate: "2026-09-15", orderNumber: "TRF-2026-044", status: "approved", reasonEn: "Annual rotation — Operations Directorate", requiresDualAuth: false },
  ]);

  // ─── Security Clearances ──────────────────────────────────────────────────
  console.log("  → security_clearances");
  await db.delete(securityClearancesTable);
  await db.insert(securityClearancesTable).values([
    { employeeId: 1, clearanceLevel: "top_secret", status: "active", grantedDate: "2018-04-01", expiryDate: "2028-04-01", investigationAuthority: "Military Security General Directorate", investigationReferenceNumber: "MSGD-TS-2018-0041", requiresDualAuthForChanges: true },
    { employeeId: 2, clearanceLevel: "secret", status: "active", grantedDate: "2019-07-15", expiryDate: "2024-07-15", investigationAuthority: "Military Security General Directorate", investigationReferenceNumber: "MSGD-S-2019-0187", requiresDualAuthForChanges: true },
    { employeeId: 3, clearanceLevel: "top_secret", status: "active", grantedDate: "2017-01-10", expiryDate: "2027-01-10", investigationAuthority: "Military Security General Directorate", accessCaveats: "SI,TK", requiresDualAuthForChanges: true },
    { employeeId: 4, clearanceLevel: "secret", status: "active", grantedDate: "2019-03-20", expiryDate: "2024-03-20", investigationAuthority: "Military Security General Directorate", requiresDualAuthForChanges: true },
    { employeeId: 5, clearanceLevel: "secret", status: "active", grantedDate: "2020-09-01", expiryDate: "2025-09-01", investigationAuthority: "Military Security General Directorate", requiresDualAuthForChanges: true },
    { employeeId: 6, clearanceLevel: "confidential", status: "active", grantedDate: "2021-06-01", expiryDate: "2026-06-01", investigationAuthority: "Personnel Security Office", requiresDualAuthForChanges: false },
    { employeeId: 7, clearanceLevel: "sci", status: "active", grantedDate: "2022-01-15", expiryDate: "2027-01-15", investigationAuthority: "Military Security General Directorate", accessCaveats: "SI,TK,HCS", requiresDualAuthForChanges: true },
    { employeeId: 8, clearanceLevel: "confidential", status: "active", grantedDate: "2022-11-01", expiryDate: "2027-11-01", investigationAuthority: "Personnel Security Office", requiresDualAuthForChanges: false },
    { employeeId: 9, clearanceLevel: "restricted", status: "active", grantedDate: "2023-05-01", expiryDate: "2028-05-01", investigationAuthority: "Personnel Security Office", requiresDualAuthForChanges: false },
    { employeeId: 10, clearanceLevel: "confidential", status: "active", grantedDate: "2023-08-01", expiryDate: "2028-08-01", investigationAuthority: "Personnel Security Office", requiresDualAuthForChanges: false },
    // One expired, one pending
    { employeeId: 11, clearanceLevel: "secret", status: "expired", grantedDate: "2019-02-01", expiryDate: "2024-02-01", investigationAuthority: "Military Security General Directorate", requiresDualAuthForChanges: true },
    { employeeId: 12, clearanceLevel: "confidential", status: "pending_investigation", grantedDate: null, expiryDate: null, investigationAuthority: "Personnel Security Office", requiresDualAuthForChanges: false },
  ]);

  // ─── Mobilization Statuses ────────────────────────────────────────────────
  console.log("  → mobilization_statuses");
  await db.delete(mobilizationStatusesTable);
  await db.insert(mobilizationStatusesTable).values([
    { employeeId: 1, status: "available", readinessCode: "A1", deploymentType: "administrative" },
    { employeeId: 2, status: "available", readinessCode: "A1", deploymentType: "administrative" },
    { employeeId: 3, status: "mobilized", unitAssignment: "1st Brigade", deploymentStart: "2026-06-01", deploymentLocation: "Western Region", readinessCode: "A1", deploymentType: "operational" },
    { employeeId: 4, status: "available", readinessCode: "A2", deploymentType: "administrative", mraRating: "MRA-2" },
    { employeeId: 5, status: "mobilized", unitAssignment: "1/1 Battalion", deploymentStart: "2026-06-01", deploymentLocation: "Western Region", readinessCode: "A1", deploymentType: "operational" },
    { employeeId: 6, status: "available", readinessCode: "A1", deploymentType: "administrative" },
    { employeeId: 7, status: "available", readinessCode: "A1", deploymentType: "administrative" },
    { employeeId: 8, status: "deployed", unitAssignment: "1/2 Battalion", deploymentStart: "2026-07-01", deploymentLocation: "Eastern Province", deploymentEnd: "2026-12-31", readinessCode: "A1", deploymentType: "support" },
    { employeeId: 9, status: "available", readinessCode: "B1", deploymentType: "administrative", remarksEn: "Awaiting medical clearance" },
    { employeeId: 10, status: "reserve", unitAssignment: "Strategic Reserve Unit", readinessCode: "A2", deploymentType: "administrative" },
    { employeeId: 11, status: "deferred", readinessCode: "C1", deploymentType: "administrative", exemptionReason: "Medical deferral — pending review by Medical Board" },
  ]);

  // ─── Chain of Command ─────────────────────────────────────────────────────
  console.log("  → chain_of_command");
  await db.delete(chainOfCommandTable);
  await db.insert(chainOfCommandTable).values([
    { employeeId: 2, supervisorEmployeeId: 1, relationshipType: "direct", effectiveFrom: "2022-01-15", isActive: true },
    { employeeId: 4, supervisorEmployeeId: 3, relationshipType: "direct", effectiveFrom: "2021-09-15", isActive: true },
    { employeeId: 5, supervisorEmployeeId: 3, relationshipType: "direct", effectiveFrom: "2023-01-10", isActive: true },
    { employeeId: 8, supervisorEmployeeId: 4, relationshipType: "direct", effectiveFrom: "2022-11-01", isActive: true },
    { employeeId: 10, supervisorEmployeeId: 5, relationshipType: "direct", effectiveFrom: "2023-08-01", isActive: true },
    { employeeId: 6, supervisorEmployeeId: 2, relationshipType: "functional", effectiveFrom: "2022-06-01", isActive: true },
    { employeeId: 7, supervisorEmployeeId: 1, relationshipType: "dotted_line", effectiveFrom: "2023-03-15", isActive: true },
    { employeeId: 9, supervisorEmployeeId: 2, relationshipType: "direct", effectiveFrom: "2023-05-01", isActive: true },
  ]);

  // ─── Dual Auth Requests ───────────────────────────────────────────────────
  console.log("  → dual_auth_requests");
  await db.delete(dualAuthRequestsTable);
  const now = new Date();
  const inOneHour = new Date(now.getTime() + 3600000);
  const inTwoDays = new Date(now.getTime() + 172800000);
  const yesterday = new Date(now.getTime() - 86400000);
  await db.insert(dualAuthRequestsTable).values([
    { actionType: "clearance_change", targetEntityType: "security_clearance", targetEntityId: 11, targetEntityLabel: "Employee #11 — Clearance Reinstatement", descriptionEn: "Reinstate secret clearance for employee following completion of reinvestigation", justification: "Employee has completed periodic reinvestigation. Reinstatement recommended by Security Officer.", initiatedByUserId: 2, status: "pending", expiresAt: inTwoDays, requiresSeparateDepartments: true },
    { actionType: "forced_transfer", targetEntityType: "employee_transfer", targetEntityId: 4, targetEntityLabel: "Transfer Order TRF-2026-044", descriptionEn: "Executive-directed inter-brigade transfer — requires dual authorization under PERSEC directive 2024-07", justification: "Operational requirement for specialized expertise in Operations Directorate.", initiatedByUserId: 1, status: "first_approved", firstApproverUserId: 3, firstApprovedAt: new Date(now.getTime() - 3600000), expiresAt: inTwoDays, requiresSeparateDepartments: true },
    { actionType: "data_export", targetEntityType: "payroll_run", targetEntityId: 3, targetEntityLabel: "Payroll Run — Aug 2026", descriptionEn: "Export full payroll data for audit submission to Ministry of Finance", initiatedByUserId: 1, status: "approved", firstApproverUserId: 2, firstApprovedAt: yesterday, secondApproverUserId: 3, secondApprovedAt: new Date(yesterday.getTime() + 1800000), expiresAt: inOneHour, completedAt: new Date(yesterday.getTime() + 1800000), requiresSeparateDepartments: true },
    { actionType: "account_lockout", targetEntityType: "system_user", targetEntityId: 5, targetEntityLabel: "User account suspension", descriptionEn: "Emergency suspension of user account following anomalous access pattern detection", initiatedByUserId: 3, status: "rejected", rejectedByUserId: 1, rejectionReason: "Insufficient evidence. Refer to security review board.", expiresAt: yesterday, requiresSeparateDepartments: true },
  ]);

  // ─── Break-Glass Access ───────────────────────────────────────────────────
  console.log("  → break_glass_access");
  await db.delete(breakGlassAccessTable);
  await db.insert(breakGlassAccessTable).values([
    { userId: 1, resourceType: "security_clearance", resourceId: 7, resourceLabel: "SCI Clearance Record — Employee #7", justification: "System maintenance — security officer scheduled review of all SCI-access holder records during compliance audit window.", expiresAt: new Date(now.getTime() + 1800000), isActive: true, notificationSent: true, notifiedAt: now },
    { userId: 2, resourceType: "payroll_run", resourceId: 3, resourceLabel: "Payroll Run Aug 2026", justification: "Emergency payroll correction required — payroll officer unreachable, August salary processing deadline in 2 hours.", expiresAt: new Date(yesterday.getTime() + 3600000), isActive: false, revokedAt: new Date(yesterday.getTime() + 1800000), revokedByUserId: 1, revocationReason: "Payroll officer returned — emergency access no longer required.", reviewOutcome: "justified", reviewedAt: yesterday, notificationSent: true },
    { userId: 3, resourceType: "employee_record", resourceId: 11, resourceLabel: "Personnel file — Employee #11", justification: "Security investigation requires review of full personnel record including disciplinary history. Normal access restricted pending investigation outcome.", expiresAt: new Date(now.getTime() + 7200000), isActive: true, notificationSent: true, notifiedAt: new Date(now.getTime() - 600000) },
  ]);

  // ─── Branch Servers ───────────────────────────────────────────────────────
  console.log("  → branch_servers");
  await db.delete(branchServersTable);
  await db.insert(branchServersTable).values([
    { serverCode: "HQ", nameEn: "HQ — Riyadh Main Server", nameAr: "المقر الرئيسي — الرياض", location: "Riyadh Secure Data Center", orgUnitCode: "RAF-HQ", ipAddress: "10.10.1.1", status: "active", syncEnabled: true, lastSeenAt: new Date(), lastSyncAt: new Date(now.getTime() - 3600000), lastSyncStatus: "completed", pendingSyncCount: 0, softwareVersion: "4.2.1-defense", adminEmail: "sysadmin@raf-hr.mil.sa" },
    { serverCode: "JEDDAH-01", nameEn: "Jeddah — Western Command Server", nameAr: "جدة — خادم قيادة الغرب", location: "Jeddah Military Complex", orgUnitCode: "2-BRIG", ipAddress: "10.20.1.5", status: "active", syncEnabled: true, lastSeenAt: new Date(now.getTime() - 900000), lastSyncAt: new Date(now.getTime() - 14400000), lastSyncStatus: "completed", pendingSyncCount: 3, softwareVersion: "4.2.0-defense", adminEmail: "admin@jeddah.raf.mil.sa" },
    { serverCode: "DAMMAM-01", nameEn: "Dammam — Eastern Province Server", nameAr: "الدمام — خادم المنطقة الشرقية", location: "Dammam Air Force Base", orgUnitCode: "1-2-BN", ipAddress: "10.30.1.3", status: "active", syncEnabled: true, lastSeenAt: new Date(now.getTime() - 1800000), lastSyncAt: new Date(now.getTime() - 28800000), lastSyncStatus: "completed", pendingSyncCount: 7, softwareVersion: "4.1.9-defense", adminEmail: "admin@dammam.raf.mil.sa" },
    { serverCode: "TABUK-01", nameEn: "Tabuk — Forward Base Server", nameAr: "تبوك — خادم القاعدة الأمامية", location: "Tabuk Forward Operating Base", orgUnitCode: "RAF-OPS", ipAddress: "10.40.1.2", status: "offline", syncEnabled: true, lastSeenAt: new Date(now.getTime() - 172800000), lastSyncAt: new Date(now.getTime() - 172800000), lastSyncStatus: "failed", pendingSyncCount: 41, softwareVersion: "4.1.8-defense", adminEmail: "admin@tabuk.raf.mil.sa" },
    { serverCode: "KHAMIS-01", nameEn: "Khamis Mushayt — Training Center Server", nameAr: "خميس مشيط — خادم مركز التدريب", location: "Khamis Military Training Center", orgUnitCode: "RAF-LOG", status: "maintenance", syncEnabled: false, lastSeenAt: new Date(now.getTime() - 43200000), pendingSyncCount: 0, softwareVersion: "4.2.1-defense", adminEmail: "admin@khamis.raf.mil.sa" },
  ]);

  // ─── Sync Queue ───────────────────────────────────────────────────────────
  console.log("  → sync_queue");
  await db.delete(syncQueueTable);
  await db.insert(syncQueueTable).values([
    { sourceServerCode: "HQ", targetServerCode: "JEDDAH-01", entityType: "employee_posting", entityId: 3, entityLabel: "Posting update — Employee #3", operation: "update", status: "completed", payloadHash: "a8f3c2d1e4b5", isEncrypted: true, processedAt: new Date(now.getTime() - 14400000) },
    { sourceServerCode: "HQ", targetServerCode: "JEDDAH-01", entityType: "leave_request", entityId: 12, entityLabel: "Leave Request LR-2026-0012", operation: "create", status: "pending", payloadHash: "b7e2d1c4a3f9", isEncrypted: true },
    { sourceServerCode: "HQ", targetServerCode: "JEDDAH-01", entityType: "payroll_period", entityId: 3, entityLabel: "Payroll Period Aug-2026", operation: "update", status: "pending", payloadHash: "c9f4e3d2b1a8", isEncrypted: true },
    { sourceServerCode: "JEDDAH-01", targetServerCode: "HQ", entityType: "attendance_record", entityId: 445, entityLabel: "Attendance sync batch", operation: "bulk_sync", status: "pending", payloadHash: "d1a2b3c4e5f6", isEncrypted: true },
    { sourceServerCode: "HQ", targetServerCode: "DAMMAM-01", entityType: "system_config", entityId: 1, entityLabel: "Config update — security.level", operation: "update", status: "conflict", payloadHash: "e2b3c4d5a6f7", isEncrypted: true, conflictNotes: "Branch server has newer version of this config key. Local modification timestamp: 2026-07-28T11:30:00Z, HQ modification timestamp: 2026-07-28T10:45:00Z." },
    { sourceServerCode: "HQ", targetServerCode: "TABUK-01", entityType: "employee_transfer", entityId: 4, entityLabel: "Transfer Order TRF-2026-044", operation: "create", status: "failed", payloadHash: "f3c4d5e6b7a1", isEncrypted: true, errorMessage: "Connection timeout: server unreachable after 3 retry attempts.", retryCount: 3 },
    { sourceServerCode: "HQ", targetServerCode: "TABUK-01", entityType: "public_holiday", entityId: 10, entityLabel: "Holiday batch sync", operation: "bulk_sync", status: "failed", payloadHash: "a4d5e6f7c8b2", isEncrypted: true, errorMessage: "Server offline.", retryCount: 3 },
    { sourceServerCode: "HQ", targetServerCode: "DAMMAM-01", entityType: "leave_balance", entityId: null, entityLabel: "Annual leave balance refresh", operation: "bulk_sync", status: "pending", payloadHash: "b5e6f7a8d9c3", isEncrypted: true },
    { sourceServerCode: "DAMMAM-01", targetServerCode: "HQ", entityType: "attendance_correction", entityId: 88, entityLabel: "Correction batch upload", operation: "create", status: "in_progress", payloadHash: "c6f7a8b9e1d4", isEncrypted: true },
    { sourceServerCode: "HQ", targetServerCode: "JEDDAH-01", entityType: "roster_shift", entityId: 15, entityLabel: "Roster update — Sep 2026", operation: "update", status: "pending", payloadHash: "d7a8b9c1f2e5", isEncrypted: true },
  ]);

  // ─── Backup Records ───────────────────────────────────────────────────────
  console.log("  → backup_records");
  await db.delete(backupRecordsTable);
  await db.insert(backupRecordsTable).values([
    { backupType: "full", status: "verified", startedAt: new Date(now.getTime() - 7 * 86400000), completedAt: new Date(now.getTime() - 7 * 86400000 + 3600000), fileSizeBytes: 2_000_000_000, checksum: "sha256:a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2", storageLocation: "/backup/archive/full-2026-07-23.enc", retentionDays: 365, isVerified: true, verifiedAt: new Date(now.getTime() - 6 * 86400000), restoreTestResult: "restored_ok", restoreTestedAt: new Date(now.getTime() - 5 * 86400000), serverCode: "HQ" },
    { backupType: "incremental", status: "completed", startedAt: new Date(now.getTime() - 6 * 86400000), completedAt: new Date(now.getTime() - 6 * 86400000 + 900000), fileSizeBytes: 134_217_728, checksum: "sha256:b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3", storageLocation: "/backup/archive/incr-2026-07-24.enc", retentionDays: 90, isVerified: false, restoreTestResult: "not_tested", serverCode: "HQ" },
    { backupType: "incremental", status: "completed", startedAt: new Date(now.getTime() - 5 * 86400000), completedAt: new Date(now.getTime() - 5 * 86400000 + 900000), fileSizeBytes: 167_772_160, checksum: "sha256:c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4", storageLocation: "/backup/archive/incr-2026-07-25.enc", retentionDays: 90, isVerified: false, restoreTestResult: "not_tested", serverCode: "HQ" },
    { backupType: "incremental", status: "completed", startedAt: new Date(now.getTime() - 4 * 86400000), completedAt: new Date(now.getTime() - 4 * 86400000 + 900000), fileSizeBytes: 150_994_944, checksum: "sha256:d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5", storageLocation: "/backup/archive/incr-2026-07-26.enc", retentionDays: 90, isVerified: false, restoreTestResult: "not_tested", serverCode: "HQ" },
    { backupType: "incremental", status: "completed", startedAt: new Date(now.getTime() - 3 * 86400000), completedAt: new Date(now.getTime() - 3 * 86400000 + 900000), fileSizeBytes: 184_549_376, checksum: "sha256:e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6", storageLocation: "/backup/archive/incr-2026-07-27.enc", retentionDays: 90, isVerified: false, restoreTestResult: "not_tested", serverCode: "HQ" },
    { backupType: "differential", status: "completed", startedAt: new Date(now.getTime() - 2 * 86400000), completedAt: new Date(now.getTime() - 2 * 86400000 + 1800000), fileSizeBytes: 671_088_640, checksum: "sha256:f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1", storageLocation: "/backup/archive/diff-2026-07-28.enc", retentionDays: 90, isVerified: false, restoreTestResult: "not_tested", serverCode: "HQ" },
    { backupType: "incremental", status: "completed", startedAt: new Date(now.getTime() - 86400000), completedAt: new Date(now.getTime() - 86400000 + 900000), fileSizeBytes: 125_829_120, checksum: "sha256:a7b8c9d1e2f3a7b8c9d1e2f3a7b8c9d1e2f3a7b8c9d1e2f3a7b8c9d1e2f3a7b8", storageLocation: "/backup/archive/incr-2026-07-29.enc", retentionDays: 90, isVerified: false, restoreTestResult: "not_tested", serverCode: "HQ" },
    // Branch backup
    { backupType: "full", status: "completed", startedAt: new Date(now.getTime() - 14 * 86400000), completedAt: new Date(now.getTime() - 14 * 86400000 + 5400000), fileSizeBytes: 1_073_741_824, storageLocation: "/backup/branch/jeddah-full-2026-07-16.enc", retentionDays: 180, isVerified: false, restoreTestResult: "not_tested", serverCode: "JEDDAH-01" },
  ]);

  // ─── License Record ───────────────────────────────────────────────────────
  console.log("  → license_records");
  await db.delete(licenseRecordsTable);
  const demoKey = "RAF-HRMS-DEF-2024-DEMO-KEY-XXXXXX";
  const keyHash = createHash("sha256").update(demoKey).digest("hex");
  await db.insert(licenseRecordsTable).values([
    {
      productName: "HRMS Command",
      edition: "defense",
      licenseKeyHash: keyHash,
      issuedTo: "Royal Armed Forces — HR Directorate",
      issuedToOrgCode: "RAF-HQ",
      maxUsers: 5000,
      maxBranches: 50,
      validFrom: "2024-01-01",
      validUntil: "2029-12-31",
      featuresJson: JSON.stringify(["military_hierarchy", "security_clearances", "mobilization", "dual_auth", "break_glass", "airgap_sync", "privileged_sessions", "classification_labels", "watermarked_reports", "offline_operation"]),
      isActive: true,
      activatedAt: new Date("2024-01-15"),
      lastValidatedAt: new Date(now.getTime() - 86400000),
      validationMethod: "offline",
      offlineGraceDays: 365,
      nextValidationDue: "2025-01-01",
    },
  ]);

  console.log("✅ Phase 4 seed complete.");
  process.exit(0);
}

seed().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
