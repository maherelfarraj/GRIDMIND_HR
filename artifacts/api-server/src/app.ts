import express, { type Express } from "express";
import cors from "cors";
import session from "express-session";
import connectPg from "connect-pg-simple";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { pool as pgPool } from "@workspace/db";
import { assertAuthModeSafe, isAuthEnforced } from "./lib/authMode";

// Refuses to start in production with auth disabled; loud warning elsewhere.
assertAuthModeSafe();

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// CORS: credentialed requests only for trusted origins (Replit dev domain,
// localhost dev ports, same-origin/no-origin requests like curl and the proxy).
const allowedOrigins = new Set<string>(
  [
    process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : null,
    ...(process.env.REPLIT_DOMAINS?.split(",").map((d) => `https://${d.trim()}`) ?? []),
    "http://localhost:80",
    "http://localhost:5000",
    "http://127.0.0.1:80",
  ].filter((o): o is string => Boolean(o)),
);
app.use(cors({
  origin: (origin, cb) => {
    // No Origin header = same-origin, curl, or server-to-server — allow.
    if (!origin || allowedOrigins.has(origin)) { cb(null, true); return; }
    cb(null, false); // disallowed origin: no CORS headers, browser blocks
  },
  credentials: true,
}));

const PgSession = connectPg(session);

app.use(session({
  // Table is provisioned via schema push; createTableIfMissing reads table.sql
  // from disk at runtime, which is not included in the esbuild bundle.
  store: new PgSession({ pool: pgPool, createTableIfMissing: false }),
  secret: (() => {
    const s = process.env.SESSION_SECRET;
    if (!s) {
      if (isAuthEnforced() || process.env.NODE_ENV === "production") {
        throw new Error("SESSION_SECRET must be set when auth is enforced or in production mode");
      }
      return "dev-only-insecure-secret";
    }
    return s;
  })(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
    sameSite: "lax",
  },
}));

// 10mb limit to allow base64-encoded medical certificate attachments
app.use(express.json({
  limit: "10mb",
  // Keep the exact raw request bytes so HMAC-signed machine endpoints
  // (attendance gateway) can verify signatures over the wire payload.
  verify: (req, _res, buf) => { (req as { rawBody?: Buffer }).rawBody = buf; },
}));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
