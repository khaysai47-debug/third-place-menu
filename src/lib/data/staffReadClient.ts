// Client-side helper for the protected dashboard READ routes
// (/api/staff/orders, /api/staff/expenses — Pre-Pilot Security Hardening).
// Counterpart of staffWriteClient.ts: same localStorage-backed x-staff-secret,
// but reads THROW on failure (repository read contract — the screens own the
// retry/error UI), and auth problems throw the typed StaffAccessError so the
// staff/owner pages can show the access gate instead of a generic error.

import { getStaffWriteSecret } from "@/lib/staffWriteSecret";

/** Thrown when the device has no secret or the server rejected it (401). */
export class StaffAccessError extends Error {
  readonly reason: "missing" | "denied";

  constructor(reason: "missing" | "denied") {
    super(
      reason === "missing"
        ? "未設定員工密碼 · Staff access key not set."
        : "密碼錯誤 · Staff access key rejected.",
    );
    this.name = "StaffAccessError";
    this.reason = reason;
  }
}

/** GETs one protected /api/staff/* read with the device's secret. */
export async function staffRead<T>(path: string): Promise<T> {
  const secret = getStaffWriteSecret();
  if (!secret) throw new StaffAccessError("missing");

  const response = await fetch(path, {
    headers: { "x-staff-secret": secret },
    cache: "no-store",
  });
  if (response.status === 401) throw new StaffAccessError("denied");
  if (!response.ok) {
    throw new Error(`Dashboard read failed: ${path} responded ${response.status}`);
  }
  const body = (await response.json().catch(() => null)) as { ok?: boolean; data?: T } | null;
  if (body?.ok !== true || body.data === undefined) {
    throw new Error(`Dashboard read returned an unexpected shape for ${path}`);
  }
  return body.data;
}
