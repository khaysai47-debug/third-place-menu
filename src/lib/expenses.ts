// Expense / Purchase Log domain: types and data access.
// Reads and writes expenses through the n8n APIs (which talk to Airtable —
// Airtable credentials live in n8n, never here).
//
// GET response shape: { success: true, data: ApiExpense[] }
// POST body shape:    { item_name, amount, paid_from, category, note?, created_by? }
// POST response:      { success: true } | { success: false }
//
// Business rule: expense totals are never subtracted from revenue here.
// Gross sales (summarizeToday) and expenses are always separate concerns.
//
// TODO(separation): replace the n8n bridge with a Supabase/backend API
// implementation — keep getExpenses/addExpense signatures and Expense types
// identical so the staff form and owner dashboard don't change.

import { n8nWebhook } from "./n8n";

const ADD_EXPENSE_URL = n8nWebhook("third-place-add-expense");
const GET_EXPENSES_URL = n8nWebhook("third-place-get-expenses");

export type ExpensePaidFrom = "Cash" | "Transfer" | "Owner Paid" | "Other";
export type ExpenseCategory =
  | "Drinks"
  | "Ingredient"
  | "Stock Refill"
  | "Utility"
  | "Delivery"
  | "Other";

export const EXPENSE_PAID_FROM_OPTIONS: ExpensePaidFrom[] = [
  "Cash",
  "Transfer",
  "Owner Paid",
  "Other",
];
export const EXPENSE_CATEGORY_OPTIONS: ExpenseCategory[] = [
  "Drinks",
  "Ingredient",
  "Stock Refill",
  "Utility",
  "Delivery",
  "Other",
];

export interface Expense {
  /** Airtable record id (rec...) — internal key. */
  id: string;
  /** Human-readable id set by the backend (EXP-...). */
  expenseId: string;
  itemName: string;
  amount: number;
  paidFrom: ExpensePaidFrom;
  category: ExpenseCategory;
  note: string | null;
  /** ISO 8601 timestamp — used for display and sorting. */
  createdAt: string;
  createdBy: string | null;
  reviewStatus: string;
}

export interface AddExpensePayload {
  item_name: string;
  amount: number;
  paid_from: ExpensePaidFrom;
  category: ExpenseCategory;
  note?: string;
  created_by?: string;
}

export type AddExpenseResult = { success: true } | { success: false; error: string };

/** Raw shape returned by the n8n Get Expenses API — all fields unknown. */
interface ApiExpense {
  id?: unknown;
  expense_id?: unknown;
  item_name?: unknown;
  amount?: unknown;
  paid_from?: unknown;
  category?: unknown;
  note?: unknown;
  created_at?: unknown;
  created_by?: unknown;
  review_status?: unknown;
}

const asString = (v: unknown): string => (typeof v === "string" ? v : "");
const asNumber = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

function mapApiExpense(raw: ApiExpense): Expense {
  const rawPaidFrom = asString(raw.paid_from) as ExpensePaidFrom;
  const rawCategory = asString(raw.category) as ExpenseCategory;
  return {
    id: asString(raw.id),
    expenseId: asString(raw.expense_id),
    itemName: asString(raw.item_name),
    amount: asNumber(raw.amount),
    paidFrom: EXPENSE_PAID_FROM_OPTIONS.includes(rawPaidFrom) ? rawPaidFrom : "Other",
    category: EXPENSE_CATEGORY_OPTIONS.includes(rawCategory) ? rawCategory : "Other",
    note: asString(raw.note) || null,
    createdAt: asString(raw.created_at),
    createdBy: asString(raw.created_by) || null,
    reviewStatus: asString(raw.review_status) || "Pending",
  };
}

/**
 * Fetch today's expenses from the n8n Get Expenses API.
 * Response is wrapped: { success: true, data: [...] }.
 * Throws on network/HTTP/shape errors — component shows error state with retry.
 */
export async function getExpenses(): Promise<Expense[]> {
  const response = await fetch(GET_EXPENSES_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Expenses API responded ${response.status}`);
  }
  const body: unknown = await response.json();
  if (
    !body ||
    typeof body !== "object" ||
    !Array.isArray((body as Record<string, unknown>).data)
  ) {
    throw new Error("Expenses API returned an unexpected shape");
  }
  const rows = (body as { data: ApiExpense[] }).data;
  return rows
    .map(mapApiExpense)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Log a new expense via the n8n Add Expense API.
 * Returns { success: true } or { success: false; error } — never throws.
 * created_by is set by the caller (defaults to "Staff iPad" in the form).
 */
export async function addExpense(payload: AddExpensePayload): Promise<AddExpenseResult> {
  try {
    const response = await fetch(ADD_EXPENSE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await response.json().catch(() => null)) as
      | { success?: boolean }
      | null;
    if (!response.ok || data?.success !== true) {
      return { success: false, error: "Failed to log expense. Try again." };
    }
    return { success: true };
  } catch {
    return { success: false, error: "Cannot reach expense server. Check connection." };
  }
}
