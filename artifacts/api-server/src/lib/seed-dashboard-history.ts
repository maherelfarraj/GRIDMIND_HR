/**
 * Backfills attendance_records for the last 30 days so the executive
 * dashboard's trend/heat-map/OT analytics have realistic history.
 * Idempotent: skips any date that already has attendance records.
 * Run: npx tsx artifacts/api-server/src/lib/seed-dashboard-history.ts
 */
import { db, employeesTable, attendanceRecordsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { getWeekendDays } from "./weekend";

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const weekendDays = await getWeekendDays();
  const employees = await db.select().from(employeesTable).where(eq(employeesTable.status, "active"));
  const today = new Date();
  const dates: string[] = [];
  for (let i = 30; i >= 1; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }

  const existing = await db
    .select({ date: attendanceRecordsTable.date })
    .from(attendanceRecordsTable)
    .where(inArray(attendanceRecordsTable.date, dates));
  const existingDates = new Set(existing.map((r) => r.date));

  const rows: (typeof attendanceRecordsTable.$inferInsert)[] = [];
  for (const date of dates) {
    if (existingDates.has(date)) continue;
    const dow = new Date(date + "T00:00:00").getDay();
    if (weekendDays.includes(dow)) continue; // configured weekend (default Fri/Sat)
    const rand = mulberry32(Number(date.replace(/-/g, "")));
    for (const emp of employees) {
      const r = rand();
      let status = "present";
      let lateMinutes: number | null = null;
      let overtimeMinutes: number | null = null;
      let checkInTime: string | null = "07:58";
      let checkOutTime: string | null = "16:02";
      let workingHours: number | null = 8;
      if (r < 0.05) {
        status = "absent"; checkInTime = null; checkOutTime = null; workingHours = null;
      } else if (r < 0.11) {
        status = "on_leave"; checkInTime = null; checkOutTime = null; workingHours = null;
      } else if (r < 0.25) {
        status = "late";
        lateMinutes = Math.floor(rand() * 45) + 5;
        checkInTime = `0${8 + Math.floor(lateMinutes / 60)}:${String(lateMinutes % 60).padStart(2, "0")}`;
        workingHours = 8 - lateMinutes / 60;
      }
      if ((status === "present" || status === "late") && rand() < 0.2) {
        overtimeMinutes = (Math.floor(rand() * 4) + 1) * 30;
        checkOutTime = "18:00";
        workingHours = (workingHours ?? 8) + overtimeMinutes / 60;
      }
      rows.push({
        employeeId: emp.id,
        departmentId: emp.departmentId,
        date, status, lateMinutes, overtimeMinutes,
        checkInTime, checkOutTime,
        workingHours: workingHours != null ? Math.round(workingHours * 100) / 100 : null,
        deviceId: null,
        notes: "historical backfill",
      });
    }
  }

  if (rows.length) {
    for (let i = 0; i < rows.length; i += 200) {
      await db.insert(attendanceRecordsTable).values(rows.slice(i, i + 200));
    }
  }
  console.log(`Inserted ${rows.length} historical attendance records.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
