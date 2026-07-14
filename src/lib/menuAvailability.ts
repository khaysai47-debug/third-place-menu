// Menu availability domain: types and data access.
//
// SPLIT SOURCE (Phase 2G-H): getMenuAvailability/updateMenuAvailability keep
// their signatures but follow MENU_AVAILABILITY_SOURCE (dataSource.ts):
// - "supabase": read menu_items with the anon key — restricted by a
//   column-limited GRANT to exactly the public menu columns (it IS the
//   menu; nothing else is readable); write via the
//   /api/staff/update-menu-availability server route (x-staff-secret,
//   service-role key server-side only).
// - "n8n": the original webhook bridge, kept UNTOUCHED as the rollback path
//   (n8n talks to the same Supabase menu_items via its own credentials).

import { MENU_AVAILABILITY_SOURCE } from "./data/dataSource";
import { staffWrite } from "./data/staffWriteClient";
import { supabaseSelect } from "./data/supabase";
import { n8nWebhook } from "./n8n";

const MENU_AVAILABILITY_API_URL = n8nWebhook("third-place-menu-availability");
const UPDATE_AVAILABILITY_API_URL = n8nWebhook("third-place-update-menu-availability");

export type MenuAvailabilityStatus = "Available" | "Sold Out" | "Hidden";

export const AVAILABILITY_STATUSES: MenuAvailabilityStatus[] = ["Available", "Sold Out", "Hidden"];

export interface MenuAvailabilityItem {
  /** Menu item id (e.g. "B01") — the key used for updates, never recordId. */
  menuItemId: string;
  name: string;
  category: string;
  price: number;
  /** 3-state availability — DB availability_status since 2G-H. */
  availability: MenuAvailabilityStatus;
}

export type UpdateMenuAvailabilityResult = { success: true } | { success: false; error: string };

const asString = (v: unknown): string => (typeof v === "string" ? v : "");
const asNumber = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/* ── Supabase source (Phase 2G-H) ───────────────────────────────────────── */

/** menu_items row (schema notes § Menu items; availability_status per 2G-H). */
interface SupabaseMenuItemRow {
  item_code?: unknown;
  name_en?: unknown;
  category?: unknown;
  price?: unknown;
  is_available?: unknown;
  availability_status?: unknown;
}

// The PUBLIC menu columns — exactly the columns the anon role is granted
// (SQL file § 2, column-limited GRANT). NEVER select=*: any future private
// column (costs, supplier notes, audit fields) must not leak through the
// public read, and PostgREST rejects * under a column-limited grant anyway.
// sort_order is granted for the ORDER BY but not selected.
const PUBLIC_MENU_COLUMNS = "item_code,name_en,category,price,is_available,availability_status";
// Pre-migration column list (availability_status not yet added).
const PRE_MIGRATION_MENU_COLUMNS = "item_code,name_en,category,price,is_available";
const MENU_ORDER = "order=sort_order.asc,item_code.asc";

const DB_STATUS_TO_APP: Record<string, MenuAvailabilityStatus> = {
  available: "Available",
  sold_out: "Sold Out",
  hidden: "Hidden",
};

function mapSupabaseRow(row: SupabaseMenuItemRow): MenuAvailabilityItem {
  // TRANSITIONAL read: prefer the 3-state availability_status; fall back to
  // the legacy boolean when the column is missing/null/unrecognized
  // (true→Available, false→Sold Out — the boolean can NEVER mean Hidden, so
  // hidden is never invented before the migration lands).
  const fromStatus =
    typeof row.availability_status === "string"
      ? DB_STATUS_TO_APP[row.availability_status]
      : undefined;
  return {
    menuItemId: asString(row.item_code),
    name: asString(row.name_en),
    category: asString(row.category) || "Other",
    price: asNumber(row.price),
    availability: fromStatus ?? (row.is_available === true ? "Available" : "Sold Out"),
  };
}

// Returns ALL rows incl. Hidden: the customer menu drops Hidden itself
// (index.tsx) and staff views need to see/restore hidden items.
async function getMenuAvailabilityFromSupabase(): Promise<MenuAvailabilityItem[]> {
  let rows: SupabaseMenuItemRow[];
  try {
    rows = await supabaseSelect<SupabaseMenuItemRow>(
      "menu_items",
      `select=${PUBLIC_MENU_COLUMNS}&${MENU_ORDER}`,
    );
  } catch {
    // Transitional safety: before the 2G-H migration, selecting the
    // not-yet-created availability_status column 400s. Retry once with the
    // pre-migration list → boolean mapping (never invents Hidden). A real
    // outage fails here too and throws to the caller as before.
    rows = await supabaseSelect<SupabaseMenuItemRow>(
      "menu_items",
      `select=${PRE_MIGRATION_MENU_COLUMNS}&${MENU_ORDER}`,
    );
  }
  return rows.map(mapSupabaseRow).filter((item) => item.menuItemId);
}

/* ── n8n source (original bridge — rollback path, do not modify) ────────── */

/** Shape of one item as returned by the n8n Menu Availability API. */
interface ApiMenuItem {
  recordId?: unknown;
  menuItemId?: unknown;
  name?: unknown;
  category?: unknown;
  price?: unknown;
  available?: unknown;
  availability?: unknown;
}

function mapApiMenuItem(raw: ApiMenuItem): MenuAvailabilityItem {
  const availability = asString(raw.availability) as MenuAvailabilityStatus;
  return {
    menuItemId: asString(raw.menuItemId),
    name: asString(raw.name),
    category: asString(raw.category) || "Other",
    price: asNumber(raw.price),
    availability: AVAILABILITY_STATUSES.includes(availability) ? availability : "Hidden",
  };
}

async function getMenuAvailabilityFromN8n(): Promise<MenuAvailabilityItem[]> {
  const response = await fetch(MENU_AVAILABILITY_API_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Menu availability API responded ${response.status}`);
  }
  const data: unknown = await response.json();
  if (!Array.isArray(data)) {
    throw new Error("Menu availability API returned an unexpected shape");
  }
  return (data as ApiMenuItem[]).map(mapApiMenuItem).filter((item) => item.menuItemId);
}

async function updateMenuAvailabilityViaN8n(
  menuItemId: string,
  availabilityStatus: MenuAvailabilityStatus,
): Promise<UpdateMenuAvailabilityResult> {
  try {
    const response = await fetch(UPDATE_AVAILABILITY_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ menuItemId, availabilityStatus }),
    });
    const data = (await response.json().catch(() => null)) as { success?: boolean } | null;
    if (!response.ok || data?.success !== true) {
      return { success: false, error: "更新失敗 · Update failed. Try again." };
    }
    return { success: true };
  } catch {
    return { success: false, error: "無法連接伺服器 · Can't reach menu server." };
  }
}

/* ── Public API (signatures unchanged) ──────────────────────────────────── */

/**
 * Fetch menu availability from the active source.
 * Throws on network/HTTP/shape errors — the UI shows an error state with
 * retry (staff) or fails open to local menu data (customer menu).
 */
export async function getMenuAvailability(): Promise<MenuAvailabilityItem[]> {
  return MENU_AVAILABILITY_SOURCE === "supabase"
    ? getMenuAvailabilityFromSupabase()
    : getMenuAvailabilityFromN8n();
}

/**
 * Persist an availability change for one menu item. Keyed by menuItemId
 * (e.g. "B01"), never recordId. On the Supabase source this is a staff
 * action: staffWrite sends the device's x-staff-secret (⚿ on the staff page)
 * to /api/staff/update-menu-availability, which dual-writes
 * availability_status + is_available. Never throws — { success, error? }.
 */
export async function updateMenuAvailability(
  menuItemId: string,
  availabilityStatus: MenuAvailabilityStatus,
): Promise<UpdateMenuAvailabilityResult> {
  return MENU_AVAILABILITY_SOURCE === "supabase"
    ? staffWrite("/api/staff/update-menu-availability", { menuItemId, availabilityStatus })
    : updateMenuAvailabilityViaN8n(menuItemId, availabilityStatus);
}
