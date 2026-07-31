import { sql } from "drizzle-orm";
import { db, attendanceRecordsTable, employeesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Materialize a punch event into the daily attendance_records row so
 * /api/attendance and the daily summary reflect ingested punches.
 *
 * Rules:
 *  - CLOCK_IN: keep the EARLIEST in-time of the day.
 *  - CLOCK_OUT: keep the LATEST out-time of the day.
 *  - Row is upserted per (employeeId, date) via a single atomic
 *    INSERT ... ON CONFLICT statement (backed by the unique index
 *    uq_attendance_employee_date), so concurrent ingestion cannot create
 *    duplicate daily rows.
 *  - workingHours recomputed whenever both times exist.
 * Other event types (breaks, overtime markers) do not touch the record —
 * payroll reads them straight from punch_events.
 */
export async function materializePunch(opts: {
  employeeId: number;
  eventTime: Date;
  eventType: string;
  deviceId?: number | null;
}): Promise<number | null> {
  const { employeeId, eventTime, eventType, deviceId } = opts;
  if (eventType !== "CLOCK_IN" && eventType !== "CLOCK_OUT") return null;

  const date = eventTime.toISOString().slice(0, 10);
  const hhmm = eventTime.toISOString().slice(11, 16); // "HH:MM" — lexicographic order == time order

  const [emp] = await db
    .select({ departmentId: employeesTable.departmentId })
    .from(employeesTable)
    .where(eq(employeesTable.id, employeeId));
  if (!emp) return null;

  const isIn = eventType === "CLOCK_IN";
  const [row] = await db
    .insert(attendanceRecordsTable)
    .values({
      employeeId,
      departmentId: emp.departmentId ?? 0,
      date,
      checkInTime: isIn ? hhmm : null,
      checkOutTime: isIn ? null : hhmm,
      status: "present",
      deviceId: deviceId ?? null,
    })
    .onConflictDoUpdate({
      target: [attendanceRecordsTable.employeeId, attendanceRecordsTable.date],
      set: {
        // LEAST/GREATEST over "HH:MM" strings preserve earliest-IN / latest-OUT
        // even under concurrent upserts.
        checkInTime: sql`CASE WHEN ${sql.raw("excluded.check_in_time")} IS NULL THEN ${attendanceRecordsTable.checkInTime}
          ELSE LEAST(COALESCE(${attendanceRecordsTable.checkInTime}, ${sql.raw("excluded.check_in_time")}), ${sql.raw("excluded.check_in_time")}) END`,
        checkOutTime: sql`CASE WHEN ${sql.raw("excluded.check_out_time")} IS NULL THEN ${attendanceRecordsTable.checkOutTime}
          ELSE GREATEST(COALESCE(${attendanceRecordsTable.checkOutTime}, ${sql.raw("excluded.check_out_time")}), ${sql.raw("excluded.check_out_time")}) END`,
        status: sql`CASE WHEN ${attendanceRecordsTable.status} = 'absent' THEN 'present' ELSE ${attendanceRecordsTable.status} END`,
        deviceId: sql`COALESCE(${attendanceRecordsTable.deviceId}, ${sql.raw("excluded.device_id")})`,
      },
    })
    .returning({
      id: attendanceRecordsTable.id,
      checkInTime: attendanceRecordsTable.checkInTime,
      checkOutTime: attendanceRecordsTable.checkOutTime,
    });

  // Recompute derived working hours from the post-upsert authoritative times.
  if (row.checkInTime && row.checkOutTime) {
    await db
      .update(attendanceRecordsTable)
      .set({
        workingHours: sql`ROUND(GREATEST(0,
          (split_part(${attendanceRecordsTable.checkOutTime}, ':', 1)::int * 60 + split_part(${attendanceRecordsTable.checkOutTime}, ':', 2)::int)
          - (split_part(${attendanceRecordsTable.checkInTime}, ':', 1)::int * 60 + split_part(${attendanceRecordsTable.checkInTime}, ':', 2)::int)
        )::numeric / 60, 2)::real`,
      })
      .where(eq(attendanceRecordsTable.id, row.id));
  }
  return row.id;
}
