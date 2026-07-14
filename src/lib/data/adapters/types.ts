// Repository contracts for the app's data boundary (backend separation Phase 1).
//
// A repository is the app-facing surface for one domain (orders, expenses).
// Screens depend on these interfaces via src/lib/data/*Repository.ts — never on
// a concrete transport. Today the only working implementation is the n8n
// bridge; the Supabase implementations are stubs until Phase 2.
//
// The interfaces reuse the existing domain types 1:1 (StaffOrder, Expense,
// OrderPayload…) so adopting the repository layer required zero UI changes.
// See docs/backend-separation-map.md → "Phase 1 Data Shape Findings".

import type {
  StaffOrder,
  StaffOrderStatus,
  StaffPaymentMethod,
  UpdateStaffOrderResult,
} from "@/lib/staffOrders";
import type { OrderPayload, SubmitResult } from "@/lib/orders";
import type { AddExpensePayload, AddExpenseResult, Expense } from "@/lib/expenses";

/**
 * `orderKey` is the backend row key for one order. Today that is the Airtable
 * record id (StaffOrder.airtableRecordId); after separation it becomes the
 * Supabase row id. It is never the human-readable orderId (TP-...).
 */
export interface OrderRepository {
  /** Full order board, newest first. Throws on failure (UI shows retry). */
  listOrders(): Promise<StaffOrder[]>;
  /** Advance/set an order's status. Never throws — returns a result object. */
  updateOrderStatus(orderKey: string, status: StaffOrderStatus): Promise<UpdateStaffOrderResult>;
  /** Cancel with a required human reason. Never throws. */
  cancelOrder(orderKey: string, reason: string): Promise<UpdateStaffOrderResult>;
  /** Record payment (method chosen by staff). Never throws. */
  updateOrderPayment(
    orderKey: string,
    paymentMethod: StaffPaymentMethod,
  ): Promise<UpdateStaffOrderResult>;
  /**
   * Customer/manual order intake. Defined here for completeness but UNUSED:
   * the checkout and manual order form call submitOrder() in src/lib/orders.ts
   * directly, which switches on ORDER_INTAKE_SOURCE (Phase 2G-I — secure
   * server routes on "supabase", the original webhook on "n8n").
   */
  submitOrder(payload: OrderPayload): Promise<SubmitResult>;
}

export interface ExpenseRepository {
  /** Expense log, newest first. Throws on failure (UI shows retry). */
  listExpenses(): Promise<Expense[]>;
  /** Log one expense. Never throws — returns a result object. */
  addExpense(payload: AddExpensePayload): Promise<AddExpenseResult>;
}

/** Thrown by adapter methods that are not implemented yet (Supabase stubs). */
export class AdapterNotImplementedError extends Error {
  constructor(adapter: string, method: string) {
    super(
      `${adapter}.${method} is not implemented yet — this adapter is a Phase 2 target. ` +
        `The active data source is selected in src/lib/data/dataSource.ts.`,
    );
    this.name = "AdapterNotImplementedError";
  }
}
