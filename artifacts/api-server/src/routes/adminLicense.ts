import { Router } from "express";
import { getActorAdminStatus } from "../lib/adminAuth.js";
import { db, licenseRecordsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createHash } from "crypto";

const router = Router();

// GET /admin/license
router.get("/admin/license", async (req, res): Promise<void> => {
  const [license] = await db
    .select()
    .from(licenseRecordsTable)
    .where(eq(licenseRecordsTable.isActive, true));

  if (!license) {
    res.status(404).json({ error: "No active license found" });
    return;
  }

  let daysUntilExpiry: number | null = null;
  if (license.validUntil) {
    daysUntilExpiry = Math.ceil(
      (new Date(license.validUntil + "T00:00:00").getTime() - Date.now()) / 86400000
    );
  }

  const features = license.featuresJson ? JSON.parse(license.featuresJson) : [];

  res.json({ ...license, daysUntilExpiry, features });
});

// POST /admin/license
router.post("/admin/license", async (req, res): Promise<void> => {
  const { isAdmin } = await getActorAdminStatus(req);
  if (!isAdmin) {
    res.status(403).json({ error: "Insufficient privileges to manage licenses" });
    return;
  }
  const { licenseKey, issuedTo, validationMethod, ...rest } = req.body;

  if (!licenseKey) {
    res.status(400).json({ error: "licenseKey is required" });
    return;
  }

  const licenseKeyHash = createHash("sha256").update(licenseKey).digest("hex");

  // Deactivate existing active licenses
  await db
    .update(licenseRecordsTable)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(licenseRecordsTable.isActive, true));

  // Build today's date string YYYY-MM-DD
  const now = new Date();
  const validFrom =
    now.getFullYear() +
    "-" +
    String(now.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(now.getDate()).padStart(2, "0");

  const [row] = await db
    .insert(licenseRecordsTable)
    .values({
      licenseKeyHash,
      issuedTo: issuedTo ?? null,
      validationMethod: validationMethod ?? "offline",
      isActive: true,
      activatedAt: new Date(),
      lastValidatedAt: new Date(),
      validFrom,
      edition: rest.edition ?? "enterprise",
      ...rest,
    })
    .returning();

  res.status(201).json(row);
});

export default router;
