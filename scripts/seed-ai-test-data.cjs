#!/usr/bin/env node
/**
 * Synthetic HR test dataset for AI acceptance testing.
 *
 * Scope   : dev org id=205 only (GSI development environment)
 * Safety  : fully idempotent — every INSERT uses ON CONFLICT DO NOTHING
 * Marker  : all records carry "🧪 TEST DATA" in descriptions / notes
 *           employee numbers use prefix "TEST-", dept codes use prefix "T-"
 * Cleanup : run with --clean flag to DELETE all seeded records
 *
 * Run: node scripts/seed-ai-test-data.cjs
 */

'use strict';

// pnpm hoists to the store; resolve from the api-server package where pg lives
const PG_PATH   = require.resolve('pg', { paths: [
  require('path').join(__dirname, '../artifacts/api-server'),
  require('path').join(__dirname, '../node_modules/.pnpm/pg@8.22.0/node_modules'),
]}) ;
const { Pool } = require(PG_PATH);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const ORG_ID   = 205;
const ADMIN_ID = 286;          // maher user — uploader for documents
const CLEAN    = process.argv.includes('--clean');
const PWD_HASH = '$2b$12$hRt3JfHJfsPpk7OpUPjI0.AIsBylFKdpRDKx4i0t9HqZveOyIGtOW'; // TestPass@2026

// ─── helpers ──────────────────────────────────────────────────────────────────

async function q(sql, params = []) {
  const r = await pool.query(sql, params);
  return r.rows;
}

/** Generate working dates (Mon-Fri) going back N days from today */
function workingDates(n) {
  const dates = [];
  const d = new Date('2026-08-17');
  while (dates.length < n) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) dates.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() - 1);
  }
  return dates;
}

function pad(n) { return String(n).padStart(2, '0'); }
function checkIn(h, m)  { return `${pad(h)}:${pad(m)}:00`; }
function checkOut(h, m) { return `${pad(h)}:${pad(m)}:00`; }

// ─── clean mode ───────────────────────────────────────────────────────────────

async function clean() {
  console.log('🧹 Cleaning seeded test data…');
  await q(`DELETE FROM payroll_runs WHERE payroll_period_id IN
           (SELECT id FROM payroll_periods WHERE period_code LIKE 'TEST-%' AND org_id=$1)`, [ORG_ID]);
  await q(`DELETE FROM payroll_periods WHERE period_code LIKE 'TEST-%' AND org_id=$1`, [ORG_ID]);
  await q(`DELETE FROM leave_balances WHERE org_id=$1`, [ORG_ID]);
  await q(`DELETE FROM attendance_records WHERE org_id=$1 AND notes LIKE '%TEST DATA%'`, [ORG_ID]);
  await q(`DELETE FROM system_users WHERE username LIKE 'test.%' AND org_id=$1`, [ORG_ID]);
  await q(`DELETE FROM employees WHERE employee_number LIKE 'TEST-%' AND org_id=$1`, [ORG_ID]);
  await q(`DELETE FROM enterprise_documents WHERE tags_json LIKE '%test-data%' AND uploaded_by_user_id=$1`, [ADMIN_ID]);
  await q(`DELETE FROM leave_types WHERE code_en LIKE 'TEST-%'`);
  await q(`DELETE FROM departments WHERE code LIKE 'T-%' AND description LIKE '%TEST DATA%'`);
  console.log('✅ Cleaned.');
}

// ─── seed ─────────────────────────────────────────────────────────────────────

async function seed() {
  console.log('🌱 Seeding synthetic HR test data for org', ORG_ID, '…\n');

  // ── 1. DEPARTMENTS ──────────────────────────────────────────────────────────
  console.log('📁 Departments…');
  const deptRows = await q(`
    INSERT INTO departments (name_en, name_ar, code, organization_type, description)
    VALUES
      ('Executive Office',  'المكتب التنفيذي',          'T-EXEC', 'commercial', '🧪 TEST DATA — Executive leadership'),
      ('Human Resources',   'الموارد البشرية',           'T-HR',   'commercial', '🧪 TEST DATA — HR department'),
      ('Finance',           'المالية',                   'T-FIN',  'commercial', '🧪 TEST DATA — Finance team'),
      ('Engineering',       'الهندسة',                   'T-ENG',  'commercial', '🧪 TEST DATA — Engineering'),
      ('Operations',        'العمليات',                  'T-OPS',  'commercial', '🧪 TEST DATA — Operations'),
      ('Sales',             'المبيعات',                  'T-SAL',  'commercial', '🧪 TEST DATA — Sales')
    ON CONFLICT (code) DO NOTHING
    RETURNING id, code`);

  // Build lookup by code (works even if all rows already exist)
  const allDepts = await q(`SELECT id, code FROM departments WHERE code IN
    ('T-EXEC','T-HR','T-FIN','T-ENG','T-OPS','T-SAL')`);
  const dept = {};
  allDepts.forEach(d => { dept[d.code] = d.id; });
  console.log('  dept ids:', dept);

  // ── 2. LEAVE TYPES (global — no org_id) ────────────────────────────────────
  console.log('📋 Leave types…');
  await q(`
    INSERT INTO leave_types
      (code_en, name_en, name_ar, category, default_days_per_year, accrual_frequency,
       accrual_amount, max_carryover_days, requires_approval, is_active, color, description_en)
    VALUES
      ('TEST-AL','Annual Leave (Test)','إجازة سنوية (اختبار)','annual',21,'annual',21,30,true,true,'#6366F1',
       '🧪 TEST DATA — Standard annual leave for acceptance testing'),
      ('TEST-SL','Sick Leave (Test)','إجازة مرضية (اختبار)','sick',10,'annual',10,5,true,true,'#EF4444',
       '🧪 TEST DATA — Medical sick leave'),
      ('TEST-UL','Unpaid Leave (Test)','إجازة غير مدفوعة (اختبار)','unpaid',0,'manual',0,0,true,false,'#94A3B8',
       '🧪 TEST DATA — Unpaid/exceptional leave')
    ON CONFLICT (code_en) DO NOTHING`);

  const ltRows = await q(`SELECT id, code_en FROM leave_types WHERE code_en IN ('TEST-AL','TEST-SL','TEST-UL')`);
  const lt = {};
  ltRows.forEach(r => { lt[r.code_en] = r.id; });
  console.log('  leave type ids:', lt);

  // ── 3. EMPLOYEES ────────────────────────────────────────────────────────────
  // Roles: 1=Super Admin, 2=HR Manager, 3=Dept Head, 4=Security, 5=HR Clerk, 6=Read-Only Auditor
  console.log('👥 Employees…');

  const empDefs = [
    // [num, fnEn, lnEn, fnAr, lnAr, natId, jobEn, jobAr, deptCode, managerId(placeholder), roleId, status, empType, nationality, hireDate, email, note]
    ['TEST-001','Layla',  'Hassan',   'ليلى',  'حسن',    'NID-T001','HR Manager',           'مدير موارد بشرية',    'T-HR',   null, 2, 'active',   'full_time','Jordanian', '2021-03-01','layla.hassan.test@test.gridmindhr.dev',   ''],
    ['TEST-002','Omar',   'Khalid',   'عمر',   'خالد',   'NID-T002','Finance Manager',      'مدير مالي',           'T-FIN',  null, 3, 'active',   'full_time','Jordanian', '2020-06-15','omar.khalid.test@test.gridmindhr.dev',    ''],
    ['TEST-003','Sara',   'Mitchell', 'سارة',  'ميتشل',  'NID-T003','Senior Engineer',      'مهندسة أولى',         'T-ENG',  null, 3, 'active',   'full_time','British',   '2019-09-01','sara.mitchell.test@test.gridmindhr.dev',  ''],
    ['TEST-004','James',  'Chen',     'جيمس',  'تشن',    'NID-T004','Software Engineer',    'مهندس برمجيات',       'T-ENG',  null, 5, 'active',   'full_time','Canadian',  '2022-01-10','james.chen.test@test.gridmindhr.dev',     ''],
    // emp5 — normal HR clerk
    ['TEST-005','Fatima', 'Al-Rashid','فاطمة', 'الراشد', 'NID-T005','HR Specialist',        'أخصائية موارد بشرية', 'T-HR',   null, 5, 'active',   'full_time','Saudi',     '2022-07-01','fatima.alrashid.test@test.gridmindhr.dev',''],
    // emp6 — ATTENDANCE ANOMALY: high absences + late arrivals
    ['TEST-006','Ahmed',  'Nasser',   'أحمد',  'ناصر',   'NID-T006','Finance Analyst',      'محلل مالي',           'T-FIN',  null, 5, 'active',   'full_time','Egyptian',  '2023-02-01','ahmed.nasser.test@test.gridmindhr.dev',   ''],
    // emp7 — operations lead
    ['TEST-007','Priya',  'Sharma',   'بريا',  'شارما',  'NID-T007','Operations Lead',      'قائدة العمليات',      'T-OPS',  null, 3, 'active',   'full_time','Indian',    '2021-11-15','priya.sharma.test@test.gridmindhr.dev',   ''],
    // emp8 — sales manager
    ['TEST-008','Carlos', 'Rivera',   'كارلوس','ريفيرا', 'NID-T008','Sales Manager',        'مدير مبيعات',         'T-SAL',  null, 3, 'active',   'full_time','Spanish',   '2020-08-20','carlos.rivera.test@test.gridmindhr.dev',  ''],
    // emp9 — HIGH LEAVE BALANCE EXPOSURE (engineer)
    ['TEST-009','Nadia',  'Al-Hamdan','نادية', 'الحمدان','NID-T009','Software Engineer',    'مهندسة برمجيات',      'T-ENG',  null, 5, 'active',   'full_time','Emirati',   '2018-04-01','nadia.alhamdan.test@test.gridmindhr.dev', ''],
    // emp10 — HIGH LEAVE BALANCE EXPOSURE (operations)
    ['TEST-010','Yusuf',  'Ibrahim',  'يوسف',  'إبراهيم','NID-T010','Operations Specialist','أخصائي عمليات',       'T-OPS',  null, 5, 'active',   'full_time','Sudanese',  '2017-12-01','yusuf.ibrahim.test@test.gridmindhr.dev',  ''],
    // emp11 — INACTIVE employee
    ['TEST-011','Diana',  'Thompson', 'ديانا', 'تومبسون','NID-T011','Sales Representative', 'مندوبة مبيعات',       'T-SAL',  null, 5, 'inactive', 'full_time','American',  '2021-05-01','diana.thompson.test@test.gridmindhr.dev', ''],
    // emp12 — CONTRACT employee, PAYROLL VARIANCE scenario
    ['TEST-012','Wei',    'Zhang',    'وي',    'تشانغ',  'NID-T012','Contract Engineer',    'مهندس متعاقد',        'T-ENG',  null, 6, 'active',   'contract', 'Chinese',   '2025-01-01','wei.zhang.test@test.gridmindhr.dev',      ''],
  ];

  // Insert employees (skip if employee_number already exists)
  for (const e of empDefs) {
    const [num, fnEn, lnEn, fnAr, lnAr, natId, jobEn, jobAr, deptCode, _mgr, roleId, status, empType, nation, hireDate, email] = e;
    await q(`
      INSERT INTO employees
        (employee_number,first_name_en,last_name_en,first_name_ar,last_name_ar,
         national_id,job_title_en,job_title_ar,department_id,role_id,
         status,employment_type,nationality,hire_date,email,org_id,organization_type)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'commercial')
      ON CONFLICT (employee_number) DO NOTHING`,
      [num, fnEn, lnEn, fnAr, lnAr, natId, jobEn, jobAr, dept[deptCode], roleId,
       status, empType, nation, hireDate, email, ORG_ID]);
  }

  // Fetch all test employee IDs
  const empRows = await q(
    `SELECT id, employee_number, department_id FROM employees WHERE employee_number LIKE 'TEST-%' AND org_id=$1 ORDER BY employee_number`,
    [ORG_ID]);
  const empById  = {};
  const empByNum = {};
  empRows.forEach(r => { empById[r.id] = r; empByNum[r.employee_number] = r; });
  console.log(`  inserted/found ${empRows.length} employees`);

  // Wire up managers now that IDs are known
  const mgrMap = {
    'TEST-004': empByNum['TEST-003']?.id,  // James → Sara (ENG lead)
    'TEST-005': empByNum['TEST-001']?.id,  // Fatima → Layla (HR)
    'TEST-006': empByNum['TEST-002']?.id,  // Ahmed → Omar (Finance)
    'TEST-009': empByNum['TEST-003']?.id,  // Nadia → Sara (ENG)
    'TEST-010': empByNum['TEST-007']?.id,  // Yusuf → Priya (OPS)
    'TEST-011': empByNum['TEST-008']?.id,  // Diana → Carlos (Sales)
    'TEST-012': empByNum['TEST-003']?.id,  // Wei → Sara (ENG)
  };
  for (const [num, mgrid] of Object.entries(mgrMap)) {
    if (mgrid && empByNum[num]) {
      await q(`UPDATE employees SET manager_id=$1 WHERE id=$2 AND org_id=$3`,
              [mgrid, empByNum[num].id, ORG_ID]);
    }
  }

  // ── 4. SYSTEM USERS ─────────────────────────────────────────────────────────
  console.log('👤 System users…');
  const userDefs = [
    ['test.manager',  'test.manager@test.gridmindhr.dev',  'Test Manager',  'مدير اختبار',    2, empByNum['TEST-001']?.id],
    ['test.depthead', 'test.depthead@test.gridmindhr.dev', 'Test Dept Head','رئيس قسم اختبار',3, empByNum['TEST-007']?.id],
    ['test.employee', 'test.employee@test.gridmindhr.dev', 'Test Employee', 'موظف اختبار',    5, empByNum['TEST-005']?.id],
    ['test.auditor',  'test.auditor@test.gridmindhr.dev',  'Test Auditor',  'مدقق اختبار',    6, empByNum['TEST-012']?.id],
  ];
  for (const [uname, email, fullEn, fullAr, roleId, empId] of userDefs) {
    await q(`
      INSERT INTO system_users
        (username,email,full_name_en,full_name_ar,role_id,employee_id,
         is_active,password_hash,org_id,preferred_language)
      VALUES ($1,$2,$3,$4,$5,$6,true,$7,$8,'en')
      ON CONFLICT (username) DO NOTHING`,
      [uname, email, fullEn, fullAr, roleId, empId, PWD_HASH, ORG_ID]);
  }
  console.log('  users: test.manager, test.depthead, test.employee, test.auditor (pw: TestPass@2026)');

  // ── 5. LEAVE BALANCES ───────────────────────────────────────────────────────
  console.log('📅 Leave balances…');
  const YEAR = 2026;
  // [empNum, ltCode, openingBalance, accrued, used, carriedOver]
  const leaveDefs = [
    // Normal employees
    ['TEST-001','TEST-AL', 0, 21, 5,  0],  // Layla — normal
    ['TEST-002','TEST-AL', 0, 21, 8,  0],  // Omar — normal
    ['TEST-003','TEST-AL', 0, 21, 10, 0],  // Sara — normal
    ['TEST-004','TEST-AL', 0, 21, 3,  0],  // James — normal
    ['TEST-005','TEST-AL', 0, 21, 7,  0],  // Fatima — normal
    ['TEST-006','TEST-AL', 0, 21, 2,  0],  // Ahmed — low usage (attendance issues instead)
    ['TEST-007','TEST-AL', 0, 21, 6,  0],  // Priya — normal
    ['TEST-008','TEST-AL', 0, 21, 9,  0],  // Carlos — normal
    // HIGH LEAVE EXPOSURE employees
    ['TEST-009','TEST-AL', 0, 21, 0, 35],  // Nadia — 35 carried + 21 accrued = 56 days unused
    ['TEST-010','TEST-AL', 0, 21, 3, 30],  // Yusuf — 30 carried + 18 remaining = 48 days at risk
    // Contract/inactive
    ['TEST-011','TEST-AL', 0,  7, 7,  0],  // Diana — inactive, used all
    ['TEST-012','TEST-AL', 0,  7, 0,  0],  // Wei — contract, partial accrual
    // Sick leave balances
    ['TEST-001','TEST-SL', 0, 10, 2, 0],
    ['TEST-006','TEST-SL', 0, 10, 5, 0],  // Ahmed — sick leave used more
    ['TEST-009','TEST-SL', 0, 10, 0, 0],
  ];
  for (const [empNum, ltCode, ob, accrued, used, co] of leaveDefs) {
    const eid = empByNum[empNum]?.id;
    const lid = lt[ltCode];
    if (!eid || !lid) continue;
    await q(`
      INSERT INTO leave_balances
        (employee_id, leave_type_id, year, opening_balance, accrued, used, pending, adjustment, carried_over, org_id)
      VALUES ($1,$2,$3,$4,$5,$6,0,0,$7,$8)
      ON CONFLICT DO NOTHING`,
      [eid, lid, YEAR, ob, accrued, used, co, ORG_ID]);
  }

  // ── 6. ATTENDANCE RECORDS ───────────────────────────────────────────────────
  console.log('🕐 Attendance records…');
  const dates60 = workingDates(60);   // last 60 working days
  const dates30 = dates60.slice(0, 30); // last 30 working days

  // Helper: insert one attendance record
  async function insertAtt(empId, deptId, date, ciH, ciM, coH, coM, status, lateMin, otMin, wHours, note) {
    await q(`
      INSERT INTO attendance_records
        (employee_id, org_id, department_id, date,
         check_in_time, check_out_time, status,
         late_minutes, overtime_minutes, working_hours, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT DO NOTHING`,
      [empId, ORG_ID, deptId, date,
       status === 'absent' ? null : checkIn(ciH, ciM),
       status === 'absent' ? null : checkOut(coH, coM),
       status, lateMin ?? 0, otMin ?? 0, wHours ?? 8.0,
       `🧪 TEST DATA — ${note ?? 'normal'}`]);
  }

  // emp6 (Ahmed) — ANOMALY: high absence + late arrivals in last 30 days
  const ahmed = empByNum['TEST-006'];
  if (ahmed) {
    const absenceDates = new Set([dates30[2], dates30[8], dates30[15]]);        // 3 absences
    const lateDates = new Set([dates30[0],dates30[1],dates30[3],dates30[4],
                               dates30[6],dates30[9],dates30[11],dates30[13]]); // 8 late arrivals
    for (const date of dates60) {
      if (absenceDates.has(date)) {
        await insertAtt(ahmed.id, ahmed.department_id, date, 9,0, 17,0, 'absent', 0, 0, 0, 'unplanned absence');
      } else if (lateDates.has(date)) {
        const late = 20 + Math.floor(Math.random() * 25);
        await insertAtt(ahmed.id, ahmed.department_id, date, 9,late, 17,45, 'late', late, 0, 8.5, `late arrival ${late}min`);
      } else {
        await insertAtt(ahmed.id, ahmed.department_id, date, 8,55, 17,5, 'present', 0, 0, 8.2, 'normal');
      }
    }
  }

  // Engineering team (emp3,emp4,emp9) — OVERTIME SPIKE in last 30 days
  const engTeam = ['TEST-003','TEST-004','TEST-009'].map(n => empByNum[n]).filter(Boolean);
  const otDates = new Set(dates30.filter((_, i) => i % 2 === 0)); // every other day
  for (const emp of engTeam) {
    for (const date of dates60) {
      if (otDates.has(date)) {
        await insertAtt(emp.id, emp.department_id, date, 8,0, 20,0, 'present', 0, 240, 12.0, 'sprint overtime');
      } else {
        await insertAtt(emp.id, emp.department_id, date, 8,0, 17,0, 'present', 0, 0, 9.0, 'normal');
      }
    }
  }

  // All other active employees — normal attendance
  const normalEmps = ['TEST-001','TEST-002','TEST-005','TEST-007','TEST-008','TEST-010','TEST-012']
    .map(n => empByNum[n]).filter(Boolean);
  for (const emp of normalEmps) {
    for (const date of dates60) {
      const late = Math.random() < 0.05 ? 5 + Math.floor(Math.random() * 10) : 0;
      await insertAtt(emp.id, emp.department_id, date, 8, late, 17, 5, late > 0 ? 'late' : 'present',
        late, 0, late > 0 ? 8.0 : 8.1, 'normal');
    }
  }
  console.log(`  inserted attendance for ${dates60.length} working days`);

  // ── 7. PAYROLL PERIOD + RUNS ─────────────────────────────────────────────────
  console.log('💰 Payroll…');
  const periods = await q(`
    INSERT INTO payroll_periods
      (period_code, name_en, name_ar, period_type, start_date, end_date, pay_date,
       status, total_employees, currency, org_id, notes)
    VALUES
      ('TEST-2026-07','July 2026 Payroll (Test)','رواتب يوليو 2026 (اختبار)',
       'monthly','2026-07-01','2026-07-31','2026-07-28',
       'closed', 12, 'SAR', $1, '🧪 TEST DATA — synthetic payroll for AI acceptance testing')
    ON CONFLICT DO NOTHING RETURNING id`, [ORG_ID]);

  const periodRows = await q(`SELECT id FROM payroll_periods WHERE period_code='TEST-2026-07' AND org_id=$1`, [ORG_ID]);
  const periodId = periodRows[0]?.id;

  if (periodId) {
    // [empNum, baseSalary, otHours, otPay, hasException, exceptionNote]
    const runDefs = [
      ['TEST-001', 12000, 0,    0,    false, null],
      ['TEST-002', 18000, 0,    0,    false, null],
      ['TEST-003', 16000, 38.5, 5775, false, null],
      ['TEST-004', 12000, 42.0, 6300, false, null],
      ['TEST-005',  9000, 0,    0,    false, null],
      // emp6 — PAYROLL VARIANCE: deduction discrepancy
      ['TEST-006', 10000, 0, 0, true,  'Attendance deduction mismatch: 3 unplanned absences; net deduction applied vs budgeted differs by JD 450'],
      ['TEST-007', 14000, 0,    0,    false, null],
      ['TEST-008', 15000, 0,    0,    false, null],
      ['TEST-009', 12000, 44.0, 6600, false, null],
      ['TEST-010',  9500, 0,    0,    false, null],
      ['TEST-011',  8500, 0,    0,    false, null],  // inactive — final run
      // emp12 — PAYROLL VARIANCE: contract rate discrepancy
      ['TEST-012',  7000, 0, 0, true,  'Contract rate revised mid-period; billed rate vs approved PO differs by JD 350'],
    ];
    for (const [empNum, base, otH, otP, hasEx, exNote] of runDefs) {
      const eid = empByNum[empNum]?.id;
      if (!eid) continue;
      const gross    = base + otP;
      const deduct   = base * 0.07;  // simplified 7% GOSI
      const net      = gross - deduct;
      await q(`
        INSERT INTO payroll_runs
          (payroll_period_id, employee_id, base_salary, gross_salary,
           total_earnings, total_deductions, net_salary,
           overtime_hours, overtime_pay, deducted_leave_days, leave_deduction_amount,
           working_days, present_days, absent_days,
           currency, has_exception, exception_note, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,0,22,22,0,'SAR',$10,$11,'finalised')
        ON CONFLICT DO NOTHING`,
        [periodId, eid, base, gross, gross, deduct, net, otH, otP, hasEx, exNote]);
    }
    console.log(`  payroll period ${periodId} with ${runDefs.length} runs`);
  }

  // ── 8. ENTERPRISE DOCUMENTS ──────────────────────────────────────────────────
  console.log('📄 Policy documents…');
  const docs = [
    {
      num: 'TEST-POL-001',
      scope: 'organization',
      titleEn: '[TEST DATA] Annual Leave Policy 2026',
      titleAr: '[بيانات اختبار] سياسة الإجازة السنوية 2026',
      descEn: `This policy establishes the annual leave entitlement, accrual rules, and approval process for all employees.
All permanent full-time employees are entitled to 21 working days of annual leave per calendar year.
Leave must be approved at least 5 working days in advance. Carry-forward is limited to 30 days.
Leave exceeding the carry-forward limit will be forfeited at year-end. Emergency leave requests require manager approval within 24 hours.`,
      classification: 'internal',
    },
    {
      num: 'TEST-POL-002',
      scope: 'organization',
      titleEn: '[TEST DATA] Attendance and Punctuality Policy',
      titleAr: '[بيانات اختبار] سياسة الحضور والانضباط',
      descEn: `Employees are expected to arrive on time and maintain consistent attendance.
The standard working hours are 08:00–17:00, Sunday through Thursday.
Lateness of more than 15 minutes constitutes a late arrival and must be recorded.
Three or more unexcused absences in a 30-day period triggers a formal performance review.
Repeated lateness (8 or more occurrences per month) may result in disciplinary action.`,
      classification: 'internal',
    },
    {
      num: 'TEST-POL-003',
      scope: 'organization',
      titleEn: '[TEST DATA] Overtime Compensation Policy',
      titleAr: '[بيانات اختبار] سياسة تعويض العمل الإضافي',
      descEn: `Overtime work must be pre-approved by the department manager and HR.
Overtime pay is calculated at 1.5x the employee's base hourly rate for hours beyond 48 per week.
Overtime in excess of 60 hours per month requires VP approval.
Sprint-related overtime in Engineering is subject to monthly departmental review.
All overtime hours must be logged in the HR system within 24 hours of occurrence.`,
      classification: 'internal',
    },
    {
      num: 'TEST-POL-004',
      scope: 'organization',
      titleEn: '[TEST DATA] Remote Work and Flexible Hours Policy',
      titleAr: '[بيانات اختبار] سياسة العمل عن بُعد والمرونة في الأوقات',
      descEn: `Employees may work remotely up to 2 days per week subject to manager approval and role eligibility.
Remote work requires a stable internet connection, a secure workspace, and adherence to data privacy protocols.
Flexible hours are available from 07:00–19:00 with a mandatory core period of 10:00–15:00.
Attendance tracking applies equally to remote and office-based days.
Employees on performance improvement plans are not eligible for remote work privileges.`,
      classification: 'internal',
    },
    {
      num: 'TEST-POL-005',
      scope: 'organization',
      titleEn: '[TEST DATA] Payroll Corrections and Adjustments Procedure',
      titleAr: '[بيانات اختبار] إجراءات تصحيح وتعديل الرواتب',
      descEn: `Payroll corrections must be submitted by the employee's line manager to HR within 5 business days of payroll closure.
All correction requests require documentary evidence and a statement of the variance amount.
Corrections exceeding 5% of net salary require dual approval from HR and Finance.
Retroactive adjustments beyond 3 months require VP Finance sign-off.
Approved corrections are applied in the following payroll cycle; emergency out-of-cycle payments require CFO approval.`,
      classification: 'internal',
    },
    {
      num: 'TEST-POL-006',
      scope: 'organization',
      titleEn: '[TEST DATA] Employee Data Privacy Policy',
      titleAr: '[بيانات اختبار] سياسة خصوصية بيانات الموظفين',
      descEn: `Employee personal data is collected, stored, and processed in accordance with applicable data protection regulations.
HR data is accessible only to authorized personnel on a need-to-know basis.
Biometric and attendance data is stored encrypted and retained for no more than 7 years.
Employees have the right to access, correct, and request deletion of their personal records.
AI-generated analysis is based on anonymised aggregate metrics; no personal identifiers are transmitted to third-party AI services.`,
      classification: 'confidential',
    },
    {
      num: 'TEST-POL-007',
      scope: 'organization',
      titleEn: '[TEST DATA] Code of Conduct and Professional Standards',
      titleAr: '[بيانات اختبار] مدونة السلوك والمعايير المهنية',
      descEn: `All employees are expected to maintain the highest standards of professional conduct.
Harassment, discrimination, or bullying of any kind will not be tolerated and may result in immediate termination.
Conflicts of interest must be disclosed to HR and the employee's manager promptly.
Company assets, including IT systems, may not be used for personal gain or unauthorized purposes.
Violations of this code should be reported confidentially through the HR ethics hotline.`,
      classification: 'public',
    },
    {
      num: 'TEST-POL-008',
      scope: 'organization',
      titleEn: '[TEST DATA] Performance Review and Appraisal Policy',
      titleAr: '[بيانات اختبار] سياسة تقييم الأداء',
      descEn: `Annual performance reviews are conducted between January and February for the prior calendar year.
Ratings are: Exceptional (5), Exceeds Expectations (4), Meets Expectations (3), Needs Improvement (2), Unsatisfactory (1).
Employees rated below 3 for two consecutive years are placed on a Performance Improvement Plan.
Salary increases and promotions are tied to performance ratings and departmental budget approval.
Mid-year check-ins are mandatory for all employees and must be documented in the HR system by June 30.`,
      classification: 'internal',
    },
  ];

  // Ensure a test document category exists
  await q(`
    INSERT INTO document_categories
      (code, name_en, name_ar, description_en, category_type, default_classification,
       retention_years, retention_action, allow_download, allow_print,
       requires_acknowledgement, watermark_on_download, requires_expiry_date,
       upload_roles, view_roles, is_active, sort_order, organization_type)
    VALUES
      ('TEST-HR-POL','HR Policy Documents (Test)','وثائق سياسات الموارد البشرية (اختبار)',
       '🧪 TEST DATA — synthetic policy docs for AI acceptance testing',
       'policy','internal',7,'archive',true,true,false,false,false,
       '[]','[]',true,99,'commercial')
    ON CONFLICT (code) DO NOTHING`);

  const [catRow] = await q(`SELECT id FROM document_categories WHERE code='TEST-HR-POL'`);
  const catId = catRow?.id;

  for (const doc of docs) {
    await q(`
      INSERT INTO enterprise_documents
        (document_number, category_id, scope, title_en, title_ar, description_en,
         classification_level, status, issued_at, tags_json, uploaded_by_user_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'active','2026-01-01',
              '["hr-policy","test-data","ai-acceptance"]',$8)
      ON CONFLICT (document_number) DO NOTHING`,
      [doc.num, catId, doc.scope, doc.titleEn, doc.titleAr, doc.descEn,
       doc.classification, ADMIN_ID]);
  }
  console.log(`  inserted ${docs.length} policy documents`);

  // ── SUMMARY ──────────────────────────────────────────────────────────────────
  const empCount   = (await q(`SELECT COUNT(*) n FROM employees WHERE employee_number LIKE 'TEST-%' AND org_id=$1`, [ORG_ID]))[0].n;
  const userCount  = (await q(`SELECT COUNT(*) n FROM system_users WHERE username LIKE 'test.%' AND org_id=$1`, [ORG_ID]))[0].n;
  const attCount   = (await q(`SELECT COUNT(*) n FROM attendance_records WHERE org_id=$1 AND notes LIKE '%TEST DATA%'`, [ORG_ID]))[0].n;
  const lbCount    = (await q(`SELECT COUNT(*) n FROM leave_balances WHERE org_id=$1`, [ORG_ID]))[0].n;
  const prCount    = (await q(`SELECT COUNT(*) n FROM payroll_runs pr JOIN payroll_periods pp ON pp.id=pr.payroll_period_id WHERE pp.org_id=$1 AND pp.period_code LIKE 'TEST-%'`, [ORG_ID]))[0].n;
  const docCount   = (await q(`SELECT COUNT(*) n FROM enterprise_documents WHERE tags_json LIKE '%test-data%' AND uploaded_by_user_id=$1`, [ADMIN_ID]))[0].n;

  console.log('\n✅ Seed complete:');
  console.log(`   Departments   : 6  (T-EXEC, T-HR, T-FIN, T-ENG, T-OPS, T-SAL)`);
  console.log(`   Leave types   : 3  (TEST-AL, TEST-SL, TEST-UL)`);
  console.log(`   Employees     : ${empCount}  (12 fictional, org_id=${ORG_ID})`);
  console.log(`   System users  : ${userCount}  (pw: TestPass@2026)`);
  console.log(`   Attendance    : ${attCount}  records (${dates60.length} working days)`);
  console.log(`   Leave balances: ${lbCount}`);
  console.log(`   Payroll runs  : ${prCount}`);
  console.log(`   Policy docs   : ${docCount}`);
  console.log('\n   Anomaly scenarios seeded:');
  console.log('   — TEST-006 Ahmed Nasser   : 3 absences + 8 late arrivals (last 30 days)');
  console.log('   — TEST-003/004/009 Eng    : overtime spike (~240 min/day, every other day)');
  console.log('   — TEST-009 Nadia          : 56 days accrued leave (35 carried + 21 new)');
  console.log('   — TEST-010 Yusuf          : 48 days accrued leave (30 carried + 18 remaining)');
  console.log('   — TEST-006 Ahmed          : payroll variance (attendance deduction mismatch)');
  console.log('   — TEST-012 Wei Zhang      : payroll variance (contract rate discrepancy)');
}

// ─── main ──────────────────────────────────────────────────────────────────────
(async () => {
  try {
    if (CLEAN) {
      await clean();
    } else {
      await seed();
    }
  } catch (err) {
    console.error('❌ Seed error:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
