/**
 * Privileged-session recording & review — break-glass activation must open a
 * recorded elevated-access session, revocation must close it, and only
 * security officers / administrators can list the queue and mark sessions
 * reviewed. Reviewer identity is derived from the session, never the body.
 *
 * Without a session the API's demo actor is userId=1 (Super Administrator).
 * Demo mode (PILOT_AUTH=false) accepts any password on login, so role-scoped
 * agents log in as the seeded users: aisha.otaibi (Security Officer),
 * auditor1 (Read-Only Auditor), hassan.qahtani (HR Clerk).
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { inArray, eq, and } from "drizzle-orm";
import { db, breakGlassAccessTable, privilegedSessionsTable, auditLogsTable } from "@workspace/db";
import app from "../app";
import { sweepExpiredSessions } from "../routes/privilegedSessions";

const createdGrantIds: number[] = [];
const createdSessionIds: number[] = [];

afterAll(async () => {
  if (createdSessionIds.length) {
    await db.delete(auditLogsTable).where(and(
      eq(auditLogsTable.entityType, "privileged_session"),
      inArray(auditLogsTable.entityId, createdSessionIds),
    ));
    await db.delete(privilegedSessionsTable).where(inArray(privilegedSessionsTable.id, createdSessionIds));
  }
  if (createdGrantIds.length) {
    await db.delete(auditLogsTable).where(and(
      eq(auditLogsTable.entityType, "break_glass_access"),
      inArray(auditLogsTable.entityId, createdGrantIds),
    ));
    await db.delete(breakGlassAccessTable).where(inArray(breakGlassAccessTable.id, createdGrantIds));
  }
});

async function loginAs(username: string) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").send({ username, password: "x" });
  expect(res.status).toBe(200);
  return agent;
}

async function activateBreakGlass() {
  const res = await request(app).post("/api/break-glass").send({
    userId: 1,
    resourceType: "employee_record",
    justification: "TEST — privileged session integration test",
    ttlMinutes: 30,
  });
  expect(res.status).toBe(201);
  createdGrantIds.push(res.body.id);
  const [session] = await db.select().from(privilegedSessionsTable)
    .where(eq(privilegedSessionsTable.breakGlassAccessId, res.body.id));
  if (session) createdSessionIds.push(session.id);
  return { grant: res.body, session };
}

describe("privileged session recording", () => {
  it("break-glass activation opens a recorded privileged session", async () => {
    const { grant, session } = await activateBreakGlass();

    expect(session).toBeDefined();
    expect(session.userId).toBe(1);
    expect(session.breakGlassAccessId).toBe(grant.id);
    expect(session.startedAt).toBeTruthy();
    expect(session.endedAt).toBeNull();
    expect(session.reviewedAt).toBeNull();
    // scheduled end mirrors the grant expiry
    expect(new Date(session.scheduledEndAt).getTime())
      .toBe(new Date(grant.expiresAt).getTime());

    // audit trail
    const audits = await db.select().from(auditLogsTable).where(and(
      eq(auditLogsTable.action, "privileged_session.opened"),
      eq(auditLogsTable.entityId, session.id),
    ));
    expect(audits.length).toBe(1);
  });

  it("revoking the grant closes the session with an end reason", async () => {
    const { grant, session } = await activateBreakGlass();

    const rev = await request(app).post(`/api/break-glass/${grant.id}/revoke`)
      .send({ reason: "TEST — done", revokedByUserId: 2 });
    expect(rev.status).toBe(200);

    const [closed] = await db.select().from(privilegedSessionsTable)
      .where(eq(privilegedSessionsTable.id, session.id));
    expect(closed.endedAt).not.toBeNull();
    expect(closed.endReason).toBe("revoked");

    const audits = await db.select().from(auditLogsTable).where(and(
      eq(auditLogsTable.action, "privileged_session.closed"),
      eq(auditLogsTable.entityId, session.id),
    ));
    expect(audits.length).toBe(1);
  });
});

describe("privileged session authorization", () => {
  it("PILOT_AUTH: unauthenticated requests get 401, no data and no admin fallback", async () => {
    const prev = process.env.PILOT_AUTH;
    process.env.PILOT_AUTH = "true";
    try {
      const list = await request(app).get("/api/privileged-sessions");
      expect(list.status).toBe(401);
      expect(Array.isArray(list.body)).toBe(false);

      const review = await request(app).post("/api/privileged-sessions/1/review")
        .send({ outcome: "justified" });
      expect(review.status).toBe(401);
    } finally {
      if (prev === undefined) delete process.env.PILOT_AUTH;
      else process.env.PILOT_AUTH = prev;
    }
  });

  it("rejects list and review for a non-security role (HR Clerk)", async () => {
    const { session } = await activateBreakGlass();
    const clerk = await loginAs("hassan.qahtani");

    const list = await clerk.get("/api/privileged-sessions");
    expect(list.status).toBe(403);

    const review = await clerk.post(`/api/privileged-sessions/${session.id}/review`)
      .send({ outcome: "justified" });
    expect(review.status).toBe(403);
  });

  it("read-only auditor can list but cannot decide outcomes", async () => {
    const { session } = await activateBreakGlass();
    const auditor = await loginAs("auditor1");

    const list = await auditor.get("/api/privileged-sessions");
    expect(list.status).toBe(200);

    const review = await auditor.post(`/api/privileged-sessions/${session.id}/review`)
      .send({ outcome: "justified" });
    expect(review.status).toBe(403);
  });

  it("reviewer identity comes from the session — body spoofing is ignored", async () => {
    const { session } = await activateBreakGlass();
    const officer = await loginAs("aisha.otaibi"); // Security Officer, userId=4

    const ok = await officer.post(`/api/privileged-sessions/${session.id}/review`)
      .send({ outcome: "justified", notes: "TEST review", reviewedByUserId: 999 });
    expect(ok.status).toBe(200);
    expect(ok.body.reviewedByUserId).toBe(4); // session user, not the spoofed body value

    const audits = await db.select().from(auditLogsTable).where(and(
      eq(auditLogsTable.action, "privileged_session.reviewed"),
      eq(auditLogsTable.entityId, session.id),
    ));
    expect(audits.length).toBe(1);
    expect(audits[0].actorUserId).toBe(4);
  });
});

describe("privileged session review", () => {
  it("lists sessions and filters by reviewed status", async () => {
    const { session } = await activateBreakGlass();
    const officer = await loginAs("aisha.otaibi");

    const unreviewed = await officer.get("/api/privileged-sessions?reviewed=false");
    expect(unreviewed.status).toBe(200);
    expect(unreviewed.body.some((s: any) => s.id === session.id)).toBe(true);
    // enriched with the user's name
    const mine = unreviewed.body.find((s: any) => s.id === session.id);
    expect(mine).toHaveProperty("userName");

    const reviewed = await officer.get("/api/privileged-sessions?reviewed=true");
    expect(reviewed.body.some((s: any) => s.id === session.id)).toBe(false);
  });

  it("marks a session reviewed exactly once, with a valid outcome", async () => {
    const { session } = await activateBreakGlass();
    const officer = await loginAs("aisha.otaibi");

    // outcome required + validated
    const missing = await officer.post(`/api/privileged-sessions/${session.id}/review`).send({});
    expect(missing.status).toBe(400);
    const bad = await officer.post(`/api/privileged-sessions/${session.id}/review`)
      .send({ outcome: "nonsense" });
    expect(bad.status).toBe(400);

    const ok = await officer.post(`/api/privileged-sessions/${session.id}/review`)
      .send({ outcome: "justified", notes: "TEST review" });
    expect(ok.status).toBe(200);
    expect(ok.body.reviewOutcome).toBe("justified");
    expect(ok.body.reviewedAt).toBeTruthy();

    // double review rejected
    const again = await officer.post(`/api/privileged-sessions/${session.id}/review`)
      .send({ outcome: "unjustified" });
    expect(again.status).toBe(409);

    // now appears in the reviewed list
    const reviewed = await officer.get("/api/privileged-sessions?reviewed=true");
    expect(reviewed.body.some((s: any) => s.id === session.id)).toBe(true);

    // audit trail
    const audits = await db.select().from(auditLogsTable).where(and(
      eq(auditLogsTable.action, "privileged_session.reviewed"),
      eq(auditLogsTable.entityId, session.id),
    ));
    expect(audits.length).toBe(1);
  });

  it("concurrent reviews: exactly one succeeds, the other gets 409", async () => {
    const { session } = await activateBreakGlass();
    const officer = await loginAs("aisha.otaibi");

    const [a, b] = await Promise.all([
      officer.post(`/api/privileged-sessions/${session.id}/review`).send({ outcome: "justified" }),
      officer.post(`/api/privileged-sessions/${session.id}/review`).send({ outcome: "unjustified" }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    // exactly one review audit entry
    const audits = await db.select().from(auditLogsTable).where(and(
      eq(auditLogsTable.action, "privileged_session.reviewed"),
      eq(auditLogsTable.entityId, session.id),
    ));
    expect(audits.length).toBe(1);
  });

  it("activity endpoint returns the holder's audit actions inside the window only", async () => {
    const { session } = await activateBreakGlass();
    const officer = await loginAs("aisha.otaibi");

    const started = new Date(session.startedAt);
    const inserted = await db.insert(auditLogsTable).values([
      { // inside window, by the session holder
        actorUserId: session.userId, action: "TEST.activity.inside", entityType: "employee",
        entityId: 42, entityLabel: "TEST inside", createdAt: new Date(started.getTime() + 60_000),
      },
      { // before the window started
        actorUserId: session.userId, action: "TEST.activity.before", entityType: "employee",
        entityId: 43, createdAt: new Date(started.getTime() - 60_000),
      },
      { // inside window but different actor
        actorUserId: 2, action: "TEST.activity.other-actor", entityType: "employee",
        entityId: 44, createdAt: new Date(started.getTime() + 60_000),
      },
    ]).returning();

    try {
      const res = await officer.get(`/api/privileged-sessions/${session.id}/activity`);
      expect(res.status).toBe(200);
      const actions = res.body.map((a: any) => a.action);
      expect(actions).toContain("TEST.activity.inside");
      expect(actions).not.toContain("TEST.activity.before");
      expect(actions).not.toContain("TEST.activity.other-actor");
    } finally {
      await db.delete(auditLogsTable).where(inArray(auditLogsTable.id, inserted.map(r => r.id)));
    }
  });

  it("audit writes made while the holder's session is open are tagged with the session id", async () => {
    const { session } = await activateBreakGlass();

    // No explicit privilegedSessionId — the DB trigger must fill it in.
    const [row] = await db.insert(auditLogsTable).values({
      actorUserId: session.userId, action: "TEST.activity.tagged-write", entityType: "employee",
      entityId: 45, entityLabel: "TEST tagged",
    }).returning();

    try {
      expect(row.privilegedSessionId).toBe(session.id);
    } finally {
      await db.delete(auditLogsTable).where(eq(auditLogsTable.id, row.id));
    }
  });

  it("activity prefers tagged entries and excludes untagged in-window rows when tags exist", async () => {
    const { session } = await activateBreakGlass();
    const officer = await loginAs("aisha.otaibi");

    const started = new Date(session.startedAt);
    const inserted = await db.insert(auditLogsTable).values([
      { // in-window write by the holder — trigger tags it with this session
        actorUserId: session.userId, action: "TEST.activity.tagged", entityType: "employee",
        entityId: 46, createdAt: new Date(started.getTime() + 30_000),
      },
      { // in-window write by the holder that we untag below (legacy/routine row)
        actorUserId: session.userId, action: "TEST.activity.untagged", entityType: "employee",
        entityId: 47, createdAt: new Date(started.getTime() + 30_000),
      },
    ]).returning();
    const untaggedId = inserted.find((r) => r.action === "TEST.activity.untagged")!.id;
    await db.update(auditLogsTable).set({ privilegedSessionId: null })
      .where(eq(auditLogsTable.id, untaggedId));

    try {
      const res = await officer.get(`/api/privileged-sessions/${session.id}/activity`);
      expect(res.status).toBe(200);
      const actions = res.body.map((a: any) => a.action);
      expect(actions).toContain("TEST.activity.tagged");
      expect(actions).not.toContain("TEST.activity.untagged");
    } finally {
      await db.delete(auditLogsTable).where(inArray(auditLogsTable.id, inserted.map(r => r.id)));
    }
  });

  it("falls back to time-window correlation when a session has no tagged entries (older data)", async () => {
    const { session } = await activateBreakGlass();
    const officer = await loginAs("aisha.otaibi");

    const started = new Date(session.startedAt);
    const inserted = await db.insert(auditLogsTable).values({
      actorUserId: session.userId, action: "TEST.activity.legacy", entityType: "employee",
      entityId: 48, createdAt: new Date(started.getTime() + 30_000),
    }).returning();
    // Simulate pre-tagging data: strip every tag pointing at this session,
    // including the automatic ones written when the grant was activated.
    await db.update(auditLogsTable).set({ privilegedSessionId: null })
      .where(eq(auditLogsTable.privilegedSessionId, session.id));

    try {
      const res = await officer.get(`/api/privileged-sessions/${session.id}/activity`);
      expect(res.status).toBe(200);
      const actions = res.body.map((a: any) => a.action);
      expect(actions).toContain("TEST.activity.legacy");
    } finally {
      await db.delete(auditLogsTable).where(inArray(auditLogsTable.id, inserted.map(r => r.id)));
    }
  });

  it("activity endpoint is role-guarded and 404s for unknown sessions", async () => {
    const { session } = await activateBreakGlass();

    const clerk = await loginAs("hassan.qahtani");
    const forbidden = await clerk.get(`/api/privileged-sessions/${session.id}/activity`);
    expect(forbidden.status).toBe(403);

    const auditor = await loginAs("auditor1");
    const ok = await auditor.get(`/api/privileged-sessions/${session.id}/activity`);
    expect(ok.status).toBe(200);

    const missing = await auditor.get("/api/privileged-sessions/999999999/activity");
    expect(missing.status).toBe(404);
  });

  it("404s when reviewing a session that does not exist", async () => {
    const officer = await loginAs("aisha.otaibi");
    const res = await officer.post("/api/privileged-sessions/999999999/review")
      .send({ outcome: "justified" });
    expect(res.status).toBe(404);
  });
});

describe("expired session sweep", () => {
  it("listing the review queue auto-closes sessions past their scheduled end", async () => {
    const { session } = await activateBreakGlass();

    // Backdate the scheduled end so the session is expired but still open.
    const past = new Date(Date.now() - 60_000);
    await db.update(privilegedSessionsTable)
      .set({ scheduledEndAt: past })
      .where(eq(privilegedSessionsTable.id, session.id));

    const officer = await loginAs("aisha.otaibi");
    const list = await officer.get("/api/privileged-sessions");
    expect(list.status).toBe(200);

    const [closed] = await db.select().from(privilegedSessionsTable)
      .where(eq(privilegedSessionsTable.id, session.id));
    expect(closed.endedAt).not.toBeNull();
    expect(closed.endReason).toBe("expired");
    // endedAt is backdated to the scheduled lapse, not the sweep time
    expect(new Date(closed.endedAt!).getTime()).toBe(past.getTime());

    // atomic audit entry for the closure
    const audits = await db.select().from(auditLogsTable).where(and(
      eq(auditLogsTable.action, "privileged_session.closed"),
      eq(auditLogsTable.entityId, session.id),
    ));
    expect(audits.length).toBe(1);
  });

  it("does not touch open sessions still inside their window", async () => {
    const { session } = await activateBreakGlass();

    const officer = await loginAs("aisha.otaibi");
    const list = await officer.get("/api/privileged-sessions");
    expect(list.status).toBe(200);

    const [row] = await db.select().from(privilegedSessionsTable)
      .where(eq(privilegedSessionsTable.id, session.id));
    expect(row.endedAt).toBeNull();
    expect(row.endReason).toBeNull();
  });

  it("sweep is idempotent when run repeatedly (as the background sweeper does)", async () => {
    const { session } = await activateBreakGlass();

    const past = new Date(Date.now() - 60_000);
    await db.update(privilegedSessionsTable)
      .set({ scheduledEndAt: past })
      .where(eq(privilegedSessionsTable.id, session.id));

    // Run the exact function the periodic server-side sweeper invokes,
    // multiple times — no list request involved.
    await sweepExpiredSessions();
    await sweepExpiredSessions();
    await sweepExpiredSessions();

    const [closed] = await db.select().from(privilegedSessionsTable)
      .where(eq(privilegedSessionsTable.id, session.id));
    expect(closed.endedAt).not.toBeNull();
    expect(closed.endReason).toBe("expired");
    expect(new Date(closed.endedAt!).getTime()).toBe(past.getTime());

    // Exactly one audit entry despite repeated sweeps.
    const audits = await db.select().from(auditLogsTable).where(and(
      eq(auditLogsTable.action, "privileged_session.closed"),
      eq(auditLogsTable.entityId, session.id),
    ));
    expect(audits.length).toBe(1);
  });
});
