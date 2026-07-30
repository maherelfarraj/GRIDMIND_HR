import { z as zod } from "zod";

/**
 * Shared strong-password policy, used by every endpoint/form that sets a
 * password (POST /auth/change-password, POST /users/:id/password, and the
 * HRMS client forms).
 *
 * Rules:
 *  - at least 8 characters
 *  - at most 128 characters
 *  - at least 3 of 4 character classes: lowercase, uppercase, digit, symbol
 *  - not on the common-password denylist (case-insensitive)
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_MIN_CLASSES = 3;

/** Common weak passwords rejected outright (compared lowercased). */
export const COMMON_PASSWORD_DENYLIST: ReadonlySet<string> = new Set([
  "password", "password1", "password123", "passw0rd", "p@ssw0rd", "p@ssword",
  "12345678", "123456789", "1234567890", "87654321", "11111111", "00000000",
  "qwertyui", "qwerty123", "1q2w3e4r", "1qaz2wsx", "asdfghjk", "abcd1234",
  "abc12345", "letmein1", "welcome1", "iloveyou", "sunshine", "princess",
  "admin123", "admin@123", "root1234", "changeme", "change123", "temp1234",
  "aaaaaaaa", "hrms1234", "hrms@123", "demo1234", "demo@123", "test1234",
]);

export type PasswordIssueCode =
  | "too_short"
  | "too_long"
  | "not_enough_classes"
  | "common_password";

export interface PasswordIssue {
  code: PasswordIssueCode;
  messageEn: string;
  messageAr: string;
}

export function countCharacterClasses(password: string): number {
  let classes = 0;
  if (/[a-z]/.test(password)) classes++;
  if (/[A-Z]/.test(password)) classes++;
  if (/[0-9]/.test(password)) classes++;
  if (/[^a-zA-Z0-9]/.test(password)) classes++;
  return classes;
}

/**
 * Validate a candidate password against the shared policy.
 * Returns the list of issues; an empty list means the password is acceptable.
 */
export function getPasswordIssues(password: string): PasswordIssue[] {
  const issues: PasswordIssue[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) {
    issues.push({
      code: "too_short",
      messageEn: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
      messageAr: `يجب أن تتكون كلمة المرور من ${PASSWORD_MIN_LENGTH} أحرف على الأقل`,
    });
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    issues.push({
      code: "too_long",
      messageEn: `Password must be at most ${PASSWORD_MAX_LENGTH} characters`,
      messageAr: `يجب ألا تتجاوز كلمة المرور ${PASSWORD_MAX_LENGTH} حرفًا`,
    });
  }
  if (countCharacterClasses(password) < PASSWORD_MIN_CLASSES) {
    issues.push({
      code: "not_enough_classes",
      messageEn:
        "Password must include at least 3 of: lowercase letters, uppercase letters, numbers, symbols",
      messageAr:
        "يجب أن تتضمن كلمة المرور 3 أنواع على الأقل من: أحرف صغيرة، أحرف كبيرة، أرقام، رموز",
    });
  }
  if (COMMON_PASSWORD_DENYLIST.has(password.toLowerCase())) {
    issues.push({
      code: "common_password",
      messageEn: "This password is too common — choose a less predictable one",
      messageAr: "كلمة المرور هذه شائعة جدًا — اختر كلمة أقل قابلية للتخمين",
    });
  }
  return issues;
}

export function isStrongPassword(password: string): boolean {
  return getPasswordIssues(password).length === 0;
}

/** English requirements hint (for forms / API error payloads). */
export const PASSWORD_REQUIREMENTS_EN =
  `At least ${PASSWORD_MIN_LENGTH} characters, including at least 3 of: lowercase letters, uppercase letters, numbers, symbols. Common passwords are not allowed.`;

/** Arabic requirements hint (for forms / API error payloads). */
export const PASSWORD_REQUIREMENTS_AR =
  `${PASSWORD_MIN_LENGTH} أحرف على الأقل، تتضمن 3 أنواع على الأقل من: أحرف صغيرة، أحرف كبيرة، أرقام، رموز. كلمات المرور الشائعة غير مسموح بها.`;

/** Zod schema enforcing the shared strong-password policy. */
export const StrongPassword = zod
  .string()
  .superRefine((value, ctx) => {
    for (const issue of getPasswordIssues(value)) {
      ctx.addIssue({ code: zod.ZodIssueCode.custom, message: issue.messageEn });
    }
  });
