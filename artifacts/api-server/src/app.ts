import express, { type Express } from "express";
import cors from "cors";
import session from "express-session";
import connectPg from "connect-pg-simple";
import cookieSignature from "cookie-signature";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { pool as pgPool } from "@workspace/db";
import { assertAuthModeSafe, isAuthEnforced } from "./lib/authMode";
import { UnauthenticatedActorError } from "./middleware/requireAuth";
import { InvalidOrgContextError, orgContextValidator } from "./lib/orgContext.js";

// Refuses to start in production with auth disabled; loud warning elsewhere.
assertAuthModeSafe();

const app: Express = express();

// Replit serves the app behind a TLS-terminating proxy. Without trusting it,
// express-session sees the connection as plain HTTP and silently refuses to
// set the `secure` session cookie in production, so logins never persist.
app.set("trust proxy", 1);

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

const sessionSecret = (() => {
  const s = process.env.SESSION_SECRET;
  if (!s) {
    if (isAuthEnforced() || process.env.NODE_ENV === "production") {
      throw new Error("SESSION_SECRET must be set when auth is enforced or in production mode");
    }
    return "dev-only-insecure-secret";
  }
  return s;
})();

// Bearer-token session transport for non-browser clients (mobile).
// The token issued at login is the raw session id; when a request carries
// `Authorization: Bearer <sid>` and no session cookie, synthesize the signed
// cookie so express-session resolves the exact same server-side session.
// Security is equivalent to the cookie: the sid is a high-entropy random
// value known only to the session owner, and signing here adds nothing an
// attacker could exploit (an invalid/expired sid simply loads no session).
app.use((req, _res, next) => {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ") && !req.headers.cookie?.includes("connect.sid=")) {
    const sid = auth.slice("Bearer ".length).trim();
    // Session ids are URL-safe base64; ignore anything else (e.g. device API
    // keys on gateway endpoints use their own auth and never reach here with
    // cookies expected).
    if (/^[A-Za-z0-9_-]{10,128}$/.test(sid)) {
      const signed = `s:${cookieSignature.sign(sid, sessionSecret)}`;
      const synthesized = `connect.sid=${encodeURIComponent(signed)}`;
      req.headers.cookie = req.headers.cookie
        ? `${req.headers.cookie}; ${synthesized}`
        : synthesized;
    }
  }
  next();
});

app.use(session({
  // Table is provisioned via schema push; createTableIfMissing reads table.sql
  // from disk at runtime, which is not included in the esbuild bundle.
  store: new PgSession({ pool: pgPool, createTableIfMissing: false }),
  secret: sessionSecret,
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

// Validate any X-Org-Id tenant-context header before routing.
app.use(orgContextValidator());

app.use("/api", router);

// Global error handler: map unauthenticated-actor errors to 401, others to 500.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof UnauthenticatedActorError) {
    res.status(401).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof InvalidOrgContextError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  console.error("Unhandled error:", err);
  if (!res.headersSent) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default app;
