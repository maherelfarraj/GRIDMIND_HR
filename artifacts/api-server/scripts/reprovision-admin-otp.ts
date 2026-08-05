/**
 * Operator script: re-provision the admin account with a fresh OTP handoff file.
 *
 * All protocol logic lives in src/lib/adminOtpProvision.ts (typechecked under
 * tsconfig). This file is a thin entry point only — run it from the workspace
 * root so process.cwd() resolves to the same .credentials/ directory the API
 * server uses:
 *
 *   /home/runner/workspace/artifacts/api-server/node_modules/.bin/tsx \
 *     artifacts/api-server/scripts/reprovision-admin-otp.ts
 */
import { provisionAdminOtp } from "../src/lib/adminOtpProvision.js";

provisionAdminOtp()
  .then(({ filePath, revokedSessions }) => {
    console.log("Admin password reset complete.");
    console.log(`Handoff file: ${filePath}`);
    console.log(`Revoked sessions: ${revokedSessions}`);
    console.log(
      "Retrieve the one-time password from the handoff file, deliver out-of-band, then delete the file.",
    );
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error("Fatal error during admin re-provisioning:", err);
    process.exit(1);
  });
