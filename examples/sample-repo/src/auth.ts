// Authentication helpers: hashing passwords and verifying login credentials.
import { createHash } from "node:crypto";

export function hashPassword(password: string, salt: string): string {
  return createHash("sha256").update(salt + password).digest("hex");
}

export function verifyLogin(stored: string, attempt: string, salt: string): boolean {
  return stored === hashPassword(attempt, salt);
}
