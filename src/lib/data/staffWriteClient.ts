// Client-side helper for calling the app's /api/staff/* server routes.
// Shared by supabaseOrdersAdapter and supabaseExpensesAdapter (Phase 2G-F/G).
//
// Never throws — mirrors the n8n adapters' { success, error? } contract and
// bilingual error copy so the staff UI behaves identically on both sources.
// The staff secret comes from localStorage (⚿ button on the staff page),
// never from env or the bundle.

import { getStaffWriteSecret } from "@/lib/staffWriteSecret";

export type StaffWriteResult = { success: true } | { success: false; error: string };

/** POSTs one staff write to an /api/staff/* route with the device's secret. */
export async function staffWrite(
  path: string,
  body: Record<string, unknown>,
): Promise<StaffWriteResult> {
  const secret = getStaffWriteSecret();
  if (!secret) {
    return {
      success: false,
      error: "未設定員工密碼 · Staff secret not set — tap the key button in the header.",
    };
  }
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-staff-secret": secret },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
    } | null;
    if (!response.ok || data?.ok !== true) {
      return { success: false, error: data?.error ?? "更新失敗 · Update failed. Try again." };
    }
    return { success: true };
  } catch {
    return { success: false, error: "無法連接伺服器 · Can't reach order server." };
  }
}
