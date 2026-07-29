/**
 * Phase 2 seed — Shifts, Rosters, Overtime Rules, Punch Events
 * Run via: tsx src/lib/seed-phase2.ts
 */
import { db, shiftsTable, rostersTable, overtimeRulesTable, punchEventsTable,
         employeesTable, attendanceDevicesTable, attendanceRecordsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

async function main() {
  console.log("🌱 Seeding Phase 2 data…");

  // ── 1. Shifts ──────────────────────────────────────────────────────────────
  const shiftsData = [
    { nameEn: "Morning Shift",     nameAr: "الوردية الصباحية",   shiftCode: "AM",   shiftType: "day",      startTime: "06:00", endTime: "14:00", breakMinutes: 30,  gracePeriodMinutes: 10, maxOvertimeMinutes: 120, color: "#3B82F6" },
    { nameEn: "Day Shift",         nameAr: "الوردية النهارية",    shiftCode: "DS",   shiftType: "day",      startTime: "08:00", endTime: "16:00", breakMinutes: 60,  gracePeriodMinutes: 15, maxOvertimeMinutes: 120, color: "#10B981" },
    { nameEn: "Evening Shift",     nameAr: "وردية المساء",        shiftCode: "PM",   shiftType: "day",      startTime: "14:00", endTime: "22:00", breakMinutes: 30,  gracePeriodMinutes: 10, maxOvertimeMinutes: 120, color: "#F59E0B" },
    { nameEn: "Night Shift",       nameAr: "الوردية الليلية",     shiftCode: "NS",   shiftType: "night",    startTime: "22:00", endTime: "06:00", breakMinutes: 30,  gracePeriodMinutes: 10, maxOvertimeMinutes: 180, color: "#6366F1" },
    { nameEn: "Extended Ops",      nameAr: "العمليات الممتدة",    shiftCode: "XOP",  shiftType: "split",    startTime: "07:00", endTime: "19:00", breakMinutes: 90,  gracePeriodMinutes: 15, maxOvertimeMinutes: 240, color: "#EF4444" },
    { nameEn: "Administrative",    nameAr: "الوردية الإدارية",    shiftCode: "ADM",  shiftType: "day",      startTime: "07:30", endTime: "15:30", breakMinutes: 60,  gracePeriodMinutes: 20, maxOvertimeMinutes: 60,  color: "#8B5CF6" },
    { nameEn: "Flexible Hours",    nameAr: "الدوام المرن",        shiftCode: "FLX",  shiftType: "flexible", startTime: "08:00", endTime: "17:00", breakMinutes: 60,  gracePeriodMinutes: 30, maxOvertimeMinutes: 120, color: "#06B6D4" },
    { nameEn: "On-Call",           nameAr: "الاستعداد",           shiftCode: "ONC",  shiftType: "flexible", startTime: "00:00", endTime: "23:59", breakMinutes: 0,   gracePeriodMinutes: 60, maxOvertimeMinutes: 480, color: "#D97706" },
  ];

  const insertedShifts = await db.insert(shiftsTable).values(shiftsData).returning();
  console.log(`  ✓ Inserted ${insertedShifts.length} shifts`);

  // ── 2. Overtime Rules ──────────────────────────────────────────────────────
  const overtimeData = [
    {
      nameEn: "Standard Overtime Policy",
      nameAr: "سياسة الوقت الإضافي القياسية",
      departmentId: null,
      maxDailyMinutes: 120, maxWeeklyMinutes: 600,
      multiplierWeekday: "1.50", multiplierWeekend: "2.00", multiplierHoliday: "2.50",
      requiresApproval: true, effectiveFrom: "2024-01-01", effectiveTo: null,
      notes: "Applies to all employees unless department override exists",
    },
    {
      nameEn: "Operations OT Policy",
      nameAr: "سياسة الوقت الإضافي للعمليات",
      departmentId: 2, // Operations
      maxDailyMinutes: 180, maxWeeklyMinutes: 900,
      multiplierWeekday: "1.75", multiplierWeekend: "2.25", multiplierHoliday: "3.00",
      requiresApproval: true, effectiveFrom: "2024-01-01", effectiveTo: null,
      notes: "Enhanced multipliers for 24/7 operations department",
    },
    {
      nameEn: "Medical Staff OT",
      nameAr: "وقت إضافي للكادر الطبي",
      departmentId: 7, // Medical
      maxDailyMinutes: 240, maxWeeklyMinutes: 1200,
      multiplierWeekday: "1.50", multiplierWeekend: "2.00", multiplierHoliday: "2.50",
      requiresApproval: false, effectiveFrom: "2024-01-01", effectiveTo: null,
      notes: "Medical emergencies exempt from approval requirement",
    },
  ];

  const insertedOT = await db.insert(overtimeRulesTable).values(overtimeData as any).returning();
  console.log(`  ✓ Inserted ${insertedOT.length} overtime rules`);

  // ── 3. Roster (7 days × 15 employees) ─────────────────────────────────────
  const employees = await db.select().from(employeesTable);
  const shiftMap: Record<string, number> = {};
  insertedShifts.forEach((s) => { shiftMap[s.shiftCode] = s.id; });

  // Assign shifts to employees based on dept/role
  const empShiftMap: Record<number, string> = {
    1:  "DS",  2:  "ADM", 3:  "DS",  4:  "ADM", 5:  "AM",
    6:  "PM",  7:  "NS",  8:  "DS",  9:  "ADM", 10: "DS",
    11: "AM",  12: "DS",  13: "FLX", 14: "ADM", 15: "DS",
  };

  const today = new Date("2026-07-29");
  const rosterEntries: any[] = [];
  for (let d = -6; d <= 6; d++) {
    const dt = new Date(today);
    dt.setDate(dt.getDate() + d);
    const dateStr = dt.toISOString().split("T")[0];
    const dow = dt.getDay(); // 0=Sun, 5=Fri, 6=Sat
    const isWeekend = dow === 5 || dow === 6;

    for (const emp of employees) {
      const shiftCode = empShiftMap[emp.id] ?? "DS";
      const shiftId = shiftMap[shiftCode];
      const isOffDay = isWeekend && emp.id % 3 !== 0; // ~2/3 have weekend off
      const status = d < 0
        ? (isOffDay ? "holiday" : Math.random() < 0.88 ? "worked" : Math.random() < 0.5 ? "absent" : "late")
        : "scheduled";
      rosterEntries.push({
        employeeId: emp.id, shiftId, date: dateStr,
        isOffDay, isPublicHoliday: false, status,
      });
    }
  }
  const insertedRosters = await db.insert(rostersTable).values(rosterEntries).returning();
  console.log(`  ✓ Inserted ${insertedRosters.length} roster entries`);

  // ── 4. Punch Events ────────────────────────────────────────────────────────
  const devices = await db.select().from(attendanceDevicesTable);
  const records = await db.select().from(attendanceRecordsTable);

  const punchEntries: any[] = [];
  const sources = ["BIOMETRIC", "BIOMETRIC", "BIOMETRIC", "MANUAL", "CORRECTION"];
  const eventTypes = ["CLOCK_IN", "CLOCK_OUT", "BREAK_START", "BREAK_END"];

  // Generate punch events for each attendance record
  for (const rec of records) {
    const device = devices[rec.id % devices.length];
    const baseDate = new Date(`${rec.date}T${rec.checkInTime ?? "07:58"}:00`);

    // Clock In
    punchEntries.push({
      employeeId: rec.employeeId, deviceId: device?.id ?? null,
      attendanceRecordId: rec.id,
      eventTime: baseDate,
      eventType: "CLOCK_IN",
      source: sources[rec.id % sources.length],
      isVerified: true, isMissing: false,
    });

    // Break Start (~4h after clock in)
    const breakStart = new Date(baseDate.getTime() + 4 * 3600000);
    punchEntries.push({
      employeeId: rec.employeeId, deviceId: device?.id ?? null,
      attendanceRecordId: rec.id,
      eventTime: breakStart, eventType: "BREAK_START",
      source: "BIOMETRIC", isVerified: true, isMissing: false,
    });

    // Break End (~1h later)
    const breakEnd = new Date(breakStart.getTime() + 3600000);
    punchEntries.push({
      employeeId: rec.employeeId, deviceId: device?.id ?? null,
      attendanceRecordId: rec.id,
      eventTime: breakEnd, eventType: "BREAK_END",
      source: "BIOMETRIC", isVerified: true, isMissing: false,
    });

    if (rec.checkOutTime) {
      const outTime = new Date(`${rec.date}T${rec.checkOutTime}:00`);
      punchEntries.push({
        employeeId: rec.employeeId, deviceId: device?.id ?? null,
        attendanceRecordId: rec.id,
        eventTime: outTime, eventType: "CLOCK_OUT",
        source: sources[rec.id % sources.length],
        isVerified: true, isMissing: false,
      });
    } else {
      // Missing clock-out — flagged
      punchEntries.push({
        employeeId: rec.employeeId, deviceId: null,
        attendanceRecordId: rec.id,
        eventTime: new Date(`${rec.date}T16:00:00`),
        eventType: "CLOCK_OUT",
        source: "MANUAL", isVerified: false, isMissing: true,
        notes: "Clock-out not recorded. Auto-flagged by system.",
      });
    }
  }

  // Add a few overtime events
  const overtimeEmps = employees.slice(0, 4);
  for (const emp of overtimeEmps) {
    punchEntries.push({
      employeeId: emp.id, deviceId: devices[0]?.id ?? null,
      eventTime: new Date("2026-07-28T16:05:00"),
      eventType: "OVERTIME_START",
      source: "BIOMETRIC", isVerified: true, isMissing: false,
    });
    punchEntries.push({
      employeeId: emp.id, deviceId: devices[0]?.id ?? null,
      eventTime: new Date("2026-07-28T18:10:00"),
      eventType: "OVERTIME_END",
      source: "BIOMETRIC", isVerified: true, isMissing: false,
    });
  }

  const insertedPunches = await db.insert(punchEventsTable).values(punchEntries).returning();
  console.log(`  ✓ Inserted ${insertedPunches.length} punch events`);

  console.log("✅ Phase 2 seed complete!");
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
