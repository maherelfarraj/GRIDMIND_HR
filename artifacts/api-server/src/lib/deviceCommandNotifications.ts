import { inArray, lt, and, isNull, isNotNull } from "drizzle-orm";
import { db, attendanceDevicesTable, deviceCommandsTable, notificationsTable } from "@workspace/db";
import { logger } from "./logger.js";

/**
 * Device-command outcome notifications.
 *
 * Restart feedback used to exist only while the operator kept the device
 * detail panel open (the page polls GET /devices/:id/commands). If they
 * navigated away they never learned whether the reboot succeeded or the
 * command expired. Every terminal transition (ACKNOWLEDGED | FAILED |
 * EXPIRED) now also delivers an in-app notification to the user who
 * requested the command, carrying the device name and the outcome.
 *
 * Notification failures are logged, never thrown — an ack/heartbeat/sweep
 * must not fail because a notification could not be written.
 */

export const DEVICE_COMMAND_OUTCOME_TYPE = "device_command_outcome";

/** A queued command not delivered/acked within this window is expired. */
export const DEVICE_COMMAND_TTL_MS = 15 * 60 * 1000;

type TerminalStatus = "ACKNOWLEDGED" | "FAILED" | "EXPIRED";

export interface CommandOutcomeRow {
  id: number;
  /** Null for gateway-level commands (RECONCILE) that target no device. */
  deviceId: number | null;
  command: string;
  status: string;
  requestedByUserId: number | null;
  resultMessage: string | null;
}

const OUTCOME_COPY: Record<TerminalStatus, {
  severity: string;
  titleEn: (device: string) => string;
  titleAr: (device: string) => string;
  bodyEn: (device: string, detail: string) => string;
  bodyAr: (device: string) => string;
}> = {
  ACKNOWLEDGED: {
    severity: "success",
    titleEn: (d) => `Restart completed: ${d}`,
    titleAr: (d) => `اكتملت إعادة التشغيل: ${d}`,
    bodyEn: (d, detail) => `The restart command for device "${d}" was acknowledged by its gateway — the device rebooted successfully.${detail}`,
    bodyAr: (d) => `تم تأكيد أمر إعادة تشغيل الجهاز "${d}" من قبل البوابة — تمت إعادة تشغيل الجهاز بنجاح.`,
  },
  FAILED: {
    severity: "error",
    titleEn: (d) => `Restart failed: ${d}`,
    titleAr: (d) => `فشلت إعادة التشغيل: ${d}`,
    bodyEn: (d, detail) => `The restart command for device "${d}" failed at the gateway.${detail || " No further detail was reported."}`,
    bodyAr: (d) => `فشل أمر إعادة تشغيل الجهاز "${d}" عند البوابة.`,
  },
  EXPIRED: {
    severity: "warning",
    titleEn: (d) => `Restart expired: ${d}`,
    titleAr: (d) => `انتهت صلاحية إعادة التشغيل: ${d}`,
    bodyEn: (d, detail) => `The restart command for device "${d}" was not delivered or acknowledged within the delivery window and has expired. The device was NOT restarted.${detail}`,
    bodyAr: (d) => `لم يتم تسليم أو تأكيد أمر إعادة تشغيل الجهاز "${d}" خلال المهلة المحددة وانتهت صلاحيته. لم تتم إعادة تشغيل الجهاز.`,
  },
};

/** Copy for gateway-level RECONCILE commands (no target device). */
const RECONCILE_COPY: Record<TerminalStatus, {
  severity: string;
  titleEn: string;
  titleAr: string;
  bodyEn: (detail: string) => string;
  bodyAr: string;
}> = {
  ACKNOWLEDGED: {
    severity: "success",
    titleEn: "Gateway reconcile completed",
    titleAr: "اكتملت مطابقة البوابة",
    bodyEn: (detail) => `The gateway ran the batch reconcile you requested.${detail || " No further detail was reported."}`,
    bodyAr: "نفّذت البوابة مطابقة الدفعات التي طلبتها.",
  },
  FAILED: {
    severity: "error",
    titleEn: "Gateway reconcile failed",
    titleAr: "فشلت مطابقة البوابة",
    bodyEn: (detail) => `The reconcile command failed at the gateway.${detail || " No further detail was reported."}`,
    bodyAr: "فشل أمر المطابقة عند البوابة.",
  },
  EXPIRED: {
    severity: "warning",
    titleEn: "Gateway reconcile expired",
    titleAr: "انتهت صلاحية مطابقة البوابة",
    bodyEn: (detail) => `The reconcile command was not delivered or acknowledged within the delivery window and has expired. The gateway may be offline.${detail}`,
    bodyAr: "لم يتم تسليم أو تأكيد أمر المطابقة خلال المهلة المحددة وانتهت صلاحيته. قد تكون البوابة غير متصلة.",
  },
};

/**
 * Notify the requesting users that their device commands reached a terminal
 * state. Commands without a requester (e.g. seeded rows) are skipped.
 */
export async function notifyCommandOutcomes(commands: CommandOutcomeRow[]): Promise<void> {
  try {
    const notifiable = commands.filter(
      (c): c is CommandOutcomeRow & { requestedByUserId: number; status: TerminalStatus } =>
        c.requestedByUserId != null && (c.status === "ACKNOWLEDGED" || c.status === "FAILED" || c.status === "EXPIRED"),
    );
    if (!notifiable.length) return;
    const deviceIds = [...new Set(notifiable.map((c) => c.deviceId).filter((id): id is number => id !== null))];
    const devices = deviceIds.length
      ? await db
          .select({ id: attendanceDevicesTable.id, name: attendanceDevicesTable.name })
          .from(attendanceDevicesTable)
          .where(inArray(attendanceDevicesTable.id, deviceIds))
      : [];
    const deviceById = new Map(devices.map((d) => [d.id, d]));
    // Exactly-once across concurrent writers (deferred request-path write vs
    // backfill sweep) and across restarts: atomically claim each command by
    // setting outcome_notified_at from NULL, and insert notifications only
    // for the rows this writer claimed — inside one transaction, so a failed
    // insert releases the claim and the backfill sweep retries later.
    await db.transaction(async (tx) => {
      const claimed = await tx
        .update(deviceCommandsTable)
        .set({ outcomeNotifiedAt: new Date() })
        .where(and(
          inArray(deviceCommandsTable.id, notifiable.map((c) => c.id)),
          isNull(deviceCommandsTable.outcomeNotifiedAt),
        ))
        .returning({ id: deviceCommandsTable.id });
      const claimedIds = new Set(claimed.map((r) => r.id));
      const toInsert = notifiable.filter((c) => claimedIds.has(c.id));
      if (!toInsert.length) return;
      await tx.insert(notificationsTable).values(
        toInsert.map((c) => {
        const detail = c.resultMessage ? ` Gateway reported: ${c.resultMessage.slice(0, 300)}` : "";
        if (c.command === "RECONCILE") {
          const copy = RECONCILE_COPY[c.status];
          return {
            recipientUserId: c.requestedByUserId,
            notificationType: DEVICE_COMMAND_OUTCOME_TYPE,
            titleEn: copy.titleEn,
            titleAr: copy.titleAr,
            bodyEn: copy.bodyEn(detail),
            bodyAr: copy.bodyAr,
            severity: copy.severity,
            actionUrl: "/attendance-gateway",
            actionLabelEn: "View gateway",
            entityType: "device_command",
            entityId: c.id,
          };
        }
        const device = c.deviceId !== null ? deviceById.get(c.deviceId) : undefined;
        const nameEn = device?.name ?? `#${c.deviceId ?? "?"}`;
        const nameAr = nameEn;
        const copy = OUTCOME_COPY[c.status];
        return {
          recipientUserId: c.requestedByUserId,
          notificationType: DEVICE_COMMAND_OUTCOME_TYPE,
          titleEn: copy.titleEn(nameEn),
          titleAr: copy.titleAr(nameAr),
          bodyEn: copy.bodyEn(nameEn, detail),
          bodyAr: copy.bodyAr(nameAr),
          severity: copy.severity,
          actionUrl: "/attendance-devices",
          actionLabelEn: "View device",
          entityType: "device_command",
          entityId: c.id,
        };
        }),
      );
    });
  } catch (e) {
    logger.error({ err: e, commandIds: commands.map((c) => c.id) }, "Failed to notify device command outcomes");
  }
}

// In-flight deferred notification writes, so tests (and graceful shutdown)
// can await them via flushDeferredCommandNotifications().
const pendingDeferred = new Set<Promise<void>>();

/**
 * Deferred variant for latency-sensitive signed machine endpoints
 * (heartbeat/ack): schedules the notification insert on the next event-loop
 * turn so a slow notifications write can never add latency to the response.
 * Errors are already swallowed and logged inside notifyCommandOutcomes.
 */
export function notifyCommandOutcomesDeferred(commands: CommandOutcomeRow[]): void {
  if (!commands.length) return;
  const p = new Promise<void>((resolve) => {
    setImmediate(() => {
      notifyCommandOutcomes(commands).then(resolve, resolve);
    });
  });
  pendingDeferred.add(p);
  void p.finally(() => pendingDeferred.delete(p));
}

/** Await all deferred notification writes (test/shutdown helper). */
export async function flushDeferredCommandNotifications(): Promise<void> {
  while (pendingDeferred.size > 0) {
    await Promise.all([...pendingDeferred]);
  }
}

/** Number of deferred notification writes still in flight (shutdown logging). */
export function pendingDeferredCommandNotificationCount(): number {
  return pendingDeferred.size;
}

/**
 * Graceful-shutdown flush: await pending deferred notification writes, but
 * never hold up process exit longer than `timeoutMs`. Returns true when the
 * flush completed, false when the timeout elapsed first (the backfill sweep
 * recovers any writes abandoned here on the next boot).
 */
export async function flushDeferredCommandNotificationsWithTimeout(timeoutMs: number): Promise<boolean> {
  if (pendingDeferred.size === 0) return true;
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
    // Don't let the flush timer itself keep the process alive.
    timer.unref?.();
  });
  try {
    return await Promise.race([
      flushDeferredCommandNotifications().then(() => true),
      timedOut,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Server-side expiry sweep: expire every stale PENDING/DELIVERED command
 * across ALL devices and notify the requesters. Read-path expiry (the device
 * commands endpoint) only runs while someone is looking; this runs from the
 * gateway silence monitor so an operator who left the page still hears that
 * their restart expired.
 */
export async function expireStaleDeviceCommandsOnce(ttlMs: number = DEVICE_COMMAND_TTL_MS, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - ttlMs);
  const expired = await db
    .update(deviceCommandsTable)
    .set({ status: "EXPIRED", resultMessage: "Not delivered or acknowledged within the delivery window", updatedAt: new Date() })
    .where(and(
      inArray(deviceCommandsTable.status, ["PENDING", "DELIVERED"]),
      lt(deviceCommandsTable.createdAt, cutoff),
    ))
    .returning({
      id: deviceCommandsTable.id,
      deviceId: deviceCommandsTable.deviceId,
      command: deviceCommandsTable.command,
      status: deviceCommandsTable.status,
      requestedByUserId: deviceCommandsTable.requestedByUserId,
      resultMessage: deviceCommandsTable.resultMessage,
    });
  if (expired.length) {
    await notifyCommandOutcomes(expired);
  }
  return expired.length;
}

/**
 * Backfill sweep: notify terminal commands whose outcome notification was
 * lost — e.g. the server restarted in the window between responding to a
 * heartbeat/ack and the deferred notification insert. The command row itself
 * always holds the outcome, so any terminal command with a requester and no
 * notification claim (outcome_notified_at IS NULL) is re-notified here.
 * Duplicate-safe: notifyCommandOutcomes claims rows atomically, so a
 * concurrent deferred write and this sweep can never both insert. Runs at
 * startup and from the gateway silence monitor's periodic sweep.
 */
export async function backfillMissedCommandOutcomeNotifications(): Promise<number> {
  const missed = await db
    .select({
      id: deviceCommandsTable.id,
      deviceId: deviceCommandsTable.deviceId,
      command: deviceCommandsTable.command,
      status: deviceCommandsTable.status,
      requestedByUserId: deviceCommandsTable.requestedByUserId,
      resultMessage: deviceCommandsTable.resultMessage,
    })
    .from(deviceCommandsTable)
    .where(and(
      inArray(deviceCommandsTable.status, ["ACKNOWLEDGED", "FAILED", "EXPIRED"]),
      isNotNull(deviceCommandsTable.requestedByUserId),
      isNull(deviceCommandsTable.outcomeNotifiedAt),
    ));
  if (missed.length) {
    await notifyCommandOutcomes(missed);
  }
  return missed.length;
}
