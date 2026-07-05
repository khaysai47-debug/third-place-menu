// ADAPTER behavior contract for the app's data boundary (Phase 2B prep).
//
// orderContract.ts / expenseContract.ts say what the DATA must look like.
// This file says how an ADAPTER must BEHAVE. The runtime interfaces already
// exist in src/lib/data/adapters/types.ts (OrderRepository, ExpenseRepository)
// and are re-exported here so contract consumers have one import point.
//
// ── BEHAVIOR RULES every adapter must satisfy ────────────────────────────────
//
// 1. READS THROW, WRITES NEVER DO.
//    - listOrders() / listExpenses(): throw on any network/HTTP/shape failure.
//      The screens have error states with retry buttons and rely on the throw.
//      Never swallow a failure into an empty array — an empty board that is
//      actually an outage loses orders silently.
//    - updateOrderStatus / cancelOrder / updateOrderPayment / submitOrder /
//      addExpense: NEVER throw. Return { success: true } or
//      { success: false, error } — the UIs use this for optimistic revert and
//      inline error banners. An adapter that throws from a write breaks the
//      staff board's revert logic.
//
// 2. NORMALIZE AT THE BOUNDARY. Whatever the backend returns (Airtable-shaped
//    JSON via n8n, snake_case Supabase rows), the adapter's output is the
//    normalized contract shape. Use the shared helpers in
//    src/lib/data/mappers/normalize.ts so both adapters translate identically.
//
// 3. SORT AT THE BOUNDARY. Newest-first by createdAt (string compare, missing
//    timestamps last). Screens do not re-sort.
//
// 4. KEY WRITES BY ROW KEY. The `orderKey` parameter is the backend row id
//    (StaffOrder.airtableRecordId today), never the human "TP-…" orderId.
//
// 5. STATUS VOCABULARY TRANSLATION IS THE ADAPTER'S JOB. If the backend
//    stores "completed", the adapter translates it to "done" on read and back
//    on write. No screen ever sees a backend-only spelling.
//
// 6. NO CROSS-ADAPTER IMPORTS. n8n adapters must not import Supabase modules
//    and vice versa; both sides depend only on contracts + mappers. The switch
//    lives exclusively in src/lib/data/dataSource.ts.
//
// 7. UNIMPLEMENTED METHODS FAIL LOUDLY. Stub methods throw
//    AdapterNotImplementedError — never return fake/empty data. A premature
//    source flip must be an obvious error, not a quietly empty dashboard.
//
// 8. PARITY BEFORE FLIP. A new adapter is only eligible to become active
//    after its read output is compared against the live adapter on the same
//    data — see src/lib/data/dev/adapterParity.ts and
//    docs/adapter-parity-testing.md.

export type {
  OrderRepository,
  ExpenseRepository,
} from "@/lib/data/adapters/types";
export { AdapterNotImplementedError } from "@/lib/data/adapters/types";

export type {
  NormalizedOrder,
  NormalizedOrderItem,
  NormalizedOrderStatus,
  NormalizedOrderType,
  NormalizedPaymentMethod,
  NormalizedPaymentStatus,
} from "./orderContract";
export type { NormalizedExpense } from "./expenseContract";
