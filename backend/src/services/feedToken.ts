import { createHmac } from "crypto";

/**
 * Deterministisches Feed-Token aus PM_PASSWORD ableiten. Wenn der User
 * sein Passwort ändert, invalidiert das alle existierenden Feed-URLs
 * (erwünscht). Kein DB-Eintrag nötig.
 */

function secret(): string {
  return process.env.PM_PASSWORD || "changeme";
}

export function feedToken(): string {
  return createHmac("sha256", secret())
    .update("pm-feed:v1")
    .digest("base64url")
    .slice(0, 24);
}

export function verifyFeedToken(token: string): boolean {
  if (!token) return false;
  const expected = feedToken();
  // Constant-time-ish compare
  if (token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  }
  return diff === 0;
}
