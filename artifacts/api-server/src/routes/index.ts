import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dashboardRouter from "./dashboard";
import employeesRouter from "./employees";
import departmentsRouter from "./departments";
import rolesRouter from "./roles";
import documentsRouter from "./documents";
import approvalsRouter from "./approvals";
import auditRouter from "./audit";
import attendanceRouter from "./attendance";
import devicesRouter from "./devices";
import alertsRouter from "./alerts";
import usersRouter from "./users";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dashboardRouter);
router.use(employeesRouter);
router.use(departmentsRouter);
router.use(rolesRouter);
router.use(documentsRouter);
router.use(approvalsRouter);
router.use(auditRouter);
router.use(attendanceRouter);
router.use(devicesRouter);
router.use(alertsRouter);
router.use(usersRouter);

export default router;
