// Menu availability domain: types and data access.
// Reads and writes menu availability through the n8n APIs (which talk to
// Airtable — Airtable credentials live in n8n, never here).

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
  /** Airtable "Availability Status" — the source of truth. */
  availability: MenuAvailabilityStatus;
}

export type UpdateMenuAvailabilityResult = { success: true } | { success: false; error: string };

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

const asString = (v: unknown): string => (typeof v === "string" ? v : "");
const asNumber = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

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

/**
 * Fetch menu availability from the n8n Menu Availability API.
 * Throws on network/HTTP/shape errors — the UI shows an error state with retry.
 */
export async function getMenuAvailability(): Promise<MenuAvailabilityItem[]> {
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

/**
 * Persist an availability change for one menu item via the n8n Update Menu
 * Availability API, which writes to the Airtable Availability Status field.
 * Updates are keyed by menuItemId (e.g. "B01"), never recordId.
 */
export async function updateMenuAvailability(
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
