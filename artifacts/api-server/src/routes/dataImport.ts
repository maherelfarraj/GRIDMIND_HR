import { Router } from "express";
import {
  db,
  dataImportJobsTable,
  dataImportRowsTable,
  importMappingTemplatesTable,
  employeesTable,
  auditLogsTable,
} from "@workspace/db";
import { eq, and, desc, inArray, sql } from "drizzle-orm";

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Helper: validate rows
// ─────────────────────────────────────────────────────────────────────────────

async function validateRows(
  importType: string,
  rowsJson: any[]
): Promise<{ validated: any[]; valid: number; errors: number; duplicates: number }> {
  const employeeNumbers = importType === "employees"
    ? (await db.select({ employeeNumber: employeesTable.employeeNumber }).from(employeesTable)).map((e) => e.employeeNumber)
    : [];

  const requiredFields: Record<string, string[]> = {
    employees: ["employeeNumber", "firstNameEn", "lastNameEn"],
  };

  let valid = 0;
  let errors = 0;
  let duplicates = 0;

  const validated = rowsJson.map((raw, idx) => {
    const rowErrors: { field: string; message: string }[] = [];
    const required = requiredFields[importType] ?? [];

    // Check required fields
    for (const field of required) {
      if (!raw[field] || String(raw[field]).trim() === "") {
        rowErrors.push({ field, message: `${field} is required` });
      }
    }

    // For non-employee types: require at least 1 field
    if (!requiredFields[importType]) {
      const fieldCount = Object.keys(raw).filter((k) => raw[k] !== null && raw[k] !== undefined && raw[k] !== "").length;
      if (fieldCount === 0) {
        rowErrors.push({ field: "_row", message: "Row has no data" });
      }
    }

    let isDuplicate = false;
    let status = "valid";

    if (rowErrors.length > 0) {
      status = "error";
      errors++;
    } else if (importType === "employees" && raw.employeeNumber && employeeNumbers.includes(raw.employeeNumber)) {
      isDuplicate = true;
      status = "duplicate";
      duplicates++;
    } else {
      valid++;
    }

    return {
      rowNumber: idx + 1,
      status,
      rawDataJson: JSON.stringify(raw),
      mappedDataJson: JSON.stringify(raw),
      errorsJson: rowErrors.length > 0 ? JSON.stringify(rowErrors) : null,
      isDuplicate,
    };
  });

  return { validated, valid, errors, duplicates };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /imports?type=X — list import jobs
// ─────────────────────────────────────────────────────────────────────────────
router.get("/imports", async (req, res): Promise<void> => {
  try {
    const { type } = req.query as Record<string, string>;
    const rows = type
      ? await db.select().from(dataImportJobsTable).where(eq(dataImportJobsTable.importType, type)).orderBy(desc(dataImportJobsTable.createdAt))
      : await db.select().from(dataImportJobsTable).orderBy(desc(dataImportJobsTable.createdAt));
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /imports — create job and run validation
// ─────────────────────────────────────────────────────────────────────────────
router.post("/imports", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const { importType, fileFormat, rowsJson, columnMappingJson, originalFilename } = req.body;

    if (!importType) return void res.status(400).json({ error: "importType is required" });
    if (!Array.isArray(rowsJson) || rowsJson.length === 0) return void res.status(400).json({ error: "rowsJson must be a non-empty array" });

    // Create job in validating state
    const [job] = await db
      .insert(dataImportJobsTable)
      .values({
        importType,
        fileFormat: fileFormat ?? "json",
        originalFilename: originalFilename ?? null,
        columnMappingJson: columnMappingJson ? JSON.stringify(columnMappingJson) : null,
        totalRows: rowsJson.length,
        status: "validating",
        importedByUserId: actorUserId,
        startedAt: new Date(),
      })
      .returning();

    // Validate rows
    const { validated, valid, errors, duplicates } = await validateRows(importType, rowsJson);

    // Insert row records
    if (validated.length > 0) {
      await db.insert(dataImportRowsTable).values(
        validated.map((v) => ({ ...v, importJobId: job.id }))
      );
    }

    // Update job counts + move to preview state
    const [updated] = await db
      .update(dataImportJobsTable)
      .set({
        status: "preview",
        validRows: valid,
        errorRows: errors,
        duplicateRows: duplicates,
      })
      .where(eq(dataImportJobsTable.id, job.id))
      .returning();

    await db.insert(auditLogsTable).values({
      action: "create",
      entityType: "data_import_job",
      entityId: job.id,
      entityLabel: `Import: ${importType} (${rowsJson.length} rows)`,
      actorUserId,
      changesJson: JSON.stringify({ importType, totalRows: rowsJson.length, valid, errors, duplicates }),
    });

    res.status(201).json({
      ...updated,
      validatedRows: validated,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /imports/:id — get job with stats
// ─────────────────────────────────────────────────────────────────────────────
router.get("/imports/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    const [job] = await db.select().from(dataImportJobsTable).where(eq(dataImportJobsTable.id, id));
    if (!job) return void res.status(404).json({ error: "Import job not found" });

    const rowStats = await db
      .select({
        status: dataImportRowsTable.status,
        count: sql<number>`count(*)::int`,
      })
      .from(dataImportRowsTable)
      .where(eq(dataImportRowsTable.importJobId, id))
      .groupBy(dataImportRowsTable.status);

    res.json({ ...job, rowStats });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /imports/:id/rows?status=X&page=1&pageSize=50
// ─────────────────────────────────────────────────────────────────────────────
router.get("/imports/:id/rows", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    const status = req.query.status as string | undefined;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, parseInt(req.query.pageSize as string) || 50);
    const offset = (page - 1) * pageSize;

    const conditions = [eq(dataImportRowsTable.importJobId, id)];
    if (status) conditions.push(eq(dataImportRowsTable.status, status));

    const rows = await db
      .select()
      .from(dataImportRowsTable)
      .where(and(...conditions))
      .orderBy(dataImportRowsTable.rowNumber)
      .limit(pageSize)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(dataImportRowsTable)
      .where(and(...conditions));

    res.json({ page, pageSize, total, rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /imports/:id/confirm-preview — set previewConfirmed=true
// ─────────────────────────────────────────────────────────────────────────────
router.post("/imports/:id/confirm-preview", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const id = parseInt(req.params.id, 10);

    const [job] = await db.select().from(dataImportJobsTable).where(eq(dataImportJobsTable.id, id));
    if (!job) return void res.status(404).json({ error: "Import job not found" });

    const [updated] = await db
      .update(dataImportJobsTable)
      .set({ previewConfirmed: true, previewConfirmedAt: new Date() })
      .where(eq(dataImportJobsTable.id, id))
      .returning();

    await db.insert(auditLogsTable).values({
      action: "confirm_preview",
      entityType: "data_import_job",
      entityId: id,
      entityLabel: `Import preview confirmed: ${job.importType}`,
      actorUserId,
      changesJson: JSON.stringify({ previewConfirmed: true }),
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /imports/:id/execute — run import for confirmed jobs
// ─────────────────────────────────────────────────────────────────────────────
router.post("/imports/:id/execute", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const id = parseInt(req.params.id, 10);

    const [job] = await db.select().from(dataImportJobsTable).where(eq(dataImportJobsTable.id, id));
    if (!job) return void res.status(404).json({ error: "Import job not found" });
    if (!job.previewConfirmed) return void res.status(400).json({ error: "Preview must be confirmed before executing" });
    if (job.status === "complete") return void res.status(400).json({ error: "Import already complete" });

    // Set to importing
    await db.update(dataImportJobsTable).set({ status: "importing" }).where(eq(dataImportJobsTable.id, id));

    // Get valid rows (capped at 100)
    const validRows = await db
      .select()
      .from(dataImportRowsTable)
      .where(and(eq(dataImportRowsTable.importJobId, id), eq(dataImportRowsTable.status, "valid")))
      .limit(100);

    let imported = 0;
    for (const row of validRows) {
      try {
        let createdEntityId: number | null = null;
        let createdEntityType: string | null = null;

        if (job.importType === "employees") {
          const rawData = JSON.parse(row.rawDataJson ?? "{}");
          // Insert minimal employee record
          const [emp] = await db
            .insert(employeesTable)
            .values({
              employeeNumber: rawData.employeeNumber,
              firstNameEn: rawData.firstNameEn,
              lastNameEn: rawData.lastNameEn,
              firstNameAr: rawData.firstNameAr ?? rawData.firstNameEn,
              lastNameAr: rawData.lastNameAr ?? rawData.lastNameEn,
              nationalId: rawData.nationalId ?? `IMP-${Date.now()}-${row.rowNumber}`,
              jobTitleEn: rawData.jobTitleEn ?? "Imported Employee",
              jobTitleAr: rawData.jobTitleAr ?? "موظف مستورد",
              departmentId: rawData.departmentId ? parseInt(rawData.departmentId) : 1,
              roleId: rawData.roleId ? parseInt(rawData.roleId) : 1,
              email: rawData.email ?? `import_${rawData.employeeNumber}@example.com`,
              hireDate: rawData.hireDate ?? new Date().toISOString().slice(0, 10),
              nationality: rawData.nationality ?? "SA",
              organizationType: rawData.organizationType ?? "commercial",
            })
            .returning();
          createdEntityId = emp.id;
          createdEntityType = "employee";
        }

        await db
          .update(dataImportRowsTable)
          .set({
            status: "imported",
            createdEntityId,
            createdEntityType,
          })
          .where(eq(dataImportRowsTable.id, row.id));

        imported++;
      } catch {
        await db
          .update(dataImportRowsTable)
          .set({ status: "error", errorsJson: JSON.stringify([{ field: "_row", message: "Failed to create entity" }]) })
          .where(eq(dataImportRowsTable.id, row.id));
      }
    }

    const [updated] = await db
      .update(dataImportJobsTable)
      .set({
        status: "complete",
        importedRows: imported,
        completedAt: new Date(),
        isRollbackable: imported > 0,
      })
      .where(eq(dataImportJobsTable.id, id))
      .returning();

    await db.insert(auditLogsTable).values({
      action: "execute",
      entityType: "data_import_job",
      entityId: id,
      entityLabel: `Import executed: ${job.importType} (${imported} rows)`,
      actorUserId,
      changesJson: JSON.stringify({ imported, total: validRows.length }),
    });

    res.json({ ...updated, imported });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /imports/:id/rollback — reverse execute
// ─────────────────────────────────────────────────────────────────────────────
router.post("/imports/:id/rollback", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const id = parseInt(req.params.id, 10);

    const [job] = await db.select().from(dataImportJobsTable).where(eq(dataImportJobsTable.id, id));
    if (!job) return void res.status(404).json({ error: "Import job not found" });
    if (!job.isRollbackable) return void res.status(400).json({ error: "Import is not rollbackable" });

    // Get imported rows
    const importedRows = await db
      .select()
      .from(dataImportRowsTable)
      .where(and(eq(dataImportRowsTable.importJobId, id), eq(dataImportRowsTable.status, "imported")));

    let rolledBack = 0;
    for (const row of importedRows) {
      if (row.createdEntityId && row.createdEntityType === "employee") {
        try {
          await db.delete(employeesTable).where(eq(employeesTable.id, row.createdEntityId));
        } catch {
          // entity may already be deleted
        }
      }
      await db
        .update(dataImportRowsTable)
        .set({ status: "rolled_back" })
        .where(eq(dataImportRowsTable.id, row.id));
      rolledBack++;
    }

    const [updated] = await db
      .update(dataImportJobsTable)
      .set({
        status: "rolled_back",
        rolledBackRows: rolledBack,
        rolledBackAt: new Date(),
        rolledBackByUserId: actorUserId,
        isRollbackable: false,
      })
      .where(eq(dataImportJobsTable.id, id))
      .returning();

    await db.insert(auditLogsTable).values({
      action: "rollback",
      entityType: "data_import_job",
      entityId: id,
      entityLabel: `Import rolled back: ${job.importType}`,
      actorUserId,
      changesJson: JSON.stringify({ rolledBack }),
    });

    res.json({ ...updated, rolledBack });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /imports/:id
// ─────────────────────────────────────────────────────────────────────────────
router.delete("/imports/:id", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const id = parseInt(req.params.id, 10);

    const [job] = await db.select().from(dataImportJobsTable).where(eq(dataImportJobsTable.id, id));
    if (!job) return void res.status(404).json({ error: "Import job not found" });

    await db.delete(dataImportRowsTable).where(eq(dataImportRowsTable.importJobId, id));
    await db.delete(dataImportJobsTable).where(eq(dataImportJobsTable.id, id));

    await db.insert(auditLogsTable).values({
      action: "delete",
      entityType: "data_import_job",
      entityId: id,
      entityLabel: `Import deleted: ${job.importType}`,
      actorUserId,
      changesJson: JSON.stringify({ deleted: true }),
    });

    res.json({ deleted: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /import-mapping-templates?type=X
// ─────────────────────────────────────────────────────────────────────────────
router.get("/import-mapping-templates", async (req, res): Promise<void> => {
  try {
    const { type } = req.query as Record<string, string>;
    const rows = type
      ? await db.select().from(importMappingTemplatesTable).where(eq(importMappingTemplatesTable.importType, type)).orderBy(desc(importMappingTemplatesTable.usageCount))
      : await db.select().from(importMappingTemplatesTable).orderBy(desc(importMappingTemplatesTable.usageCount));
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /import-mapping-templates — save template
// ─────────────────────────────────────────────────────────────────────────────
router.post("/import-mapping-templates", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const { name, importType, columnMappingJson, isDefault } = req.body;

    if (!name) return void res.status(400).json({ error: "name is required" });
    if (!importType) return void res.status(400).json({ error: "importType is required" });
    if (!columnMappingJson) return void res.status(400).json({ error: "columnMappingJson is required" });

    const [row] = await db
      .insert(importMappingTemplatesTable)
      .values({
        name,
        importType,
        columnMappingJson: typeof columnMappingJson === "string" ? columnMappingJson : JSON.stringify(columnMappingJson),
        isDefault: isDefault ?? false,
        createdByUserId: actorUserId,
      })
      .returning();

    await db.insert(auditLogsTable).values({
      action: "create",
      entityType: "import_mapping_template",
      entityId: row.id,
      entityLabel: `Template: ${name} (${importType})`,
      actorUserId,
      changesJson: JSON.stringify({ name, importType }),
    });

    res.status(201).json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /import-mapping-templates/:id/use — record that a template was applied
// ─────────────────────────────────────────────────────────────────────────────
router.post("/import-mapping-templates/:id/use", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    const now = new Date();
    const [row] = await db
      .update(importMappingTemplatesTable)
      .set({
        usageCount: sql`${importMappingTemplatesTable.usageCount} + 1`,
        lastUsedAt: now,
        updatedAt: now,
      })
      .where(eq(importMappingTemplatesTable.id, id))
      .returning();
    if (!row) return void res.status(404).json({ error: "Template not found" });
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /import-mapping-templates/:id
// ─────────────────────────────────────────────────────────────────────────────
router.delete("/import-mapping-templates/:id", async (req, res): Promise<void> => {
  try {
    const actorUserId: number = (req as any).session?.userId ?? 1;
    const id = parseInt(req.params.id, 10);

    const [tmpl] = await db.select().from(importMappingTemplatesTable).where(eq(importMappingTemplatesTable.id, id));
    if (!tmpl) return void res.status(404).json({ error: "Template not found" });

    await db.delete(importMappingTemplatesTable).where(eq(importMappingTemplatesTable.id, id));

    await db.insert(auditLogsTable).values({
      action: "delete",
      entityType: "import_mapping_template",
      entityId: id,
      entityLabel: `Template deleted: ${tmpl.name}`,
      actorUserId,
      changesJson: JSON.stringify({ deleted: true }),
    });

    res.json({ deleted: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
