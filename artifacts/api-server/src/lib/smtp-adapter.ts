import nodemailer from "nodemailer";
import type { AdapterResult } from "./ldap-adapter.js";

/**
 * Real SMTP connection test. Reads connection details from environment
 * variables (vault-ref pattern):
 *   SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASS
 * Verifies the connection and sends a test message to `testRecipient`
 * (falls back to SMTP_TEST_RECIPIENT env var, then SMTP_USER).
 */
export async function testSmtpConnection(testRecipient?: string, timeoutMs = 8000): Promise<AdapterResult> {
  const start = Date.now();
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT ?? "587");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  const missing = [
    !host && "SMTP_HOST",
    !user && "SMTP_USER",
    !pass && "SMTP_PASS",
  ].filter(Boolean);
  if (missing.length) {
    return {
      success: false,
      message: `Missing environment variables: ${missing.join(", ")}`,
      latencyMs: Date.now() - start,
      simulated: false,
    };
  }

  const recipient = testRecipient || process.env.SMTP_TEST_RECIPIENT || user!;
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user: user!, pass: pass! },
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
  });

  try {
    await transporter.verify();
    const info = await transporter.sendMail({
      from: user!,
      to: recipient,
      subject: "HRMS integration connection test",
      text: `This is an automated connection test from the HRMS integration governance module, sent at ${new Date().toISOString()}.`,
    });
    return {
      success: true,
      message: `SMTP test message sent to ${recipient} via ${host}:${port} (id: ${info.messageId})`,
      latencyMs: Date.now() - start,
      simulated: false,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `SMTP test failed against ${host}:${port}: ${err?.message ?? String(err)}`,
      latencyMs: Date.now() - start,
      simulated: false,
    };
  } finally {
    transporter.close();
  }
}
