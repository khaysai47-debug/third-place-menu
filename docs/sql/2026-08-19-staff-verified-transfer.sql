-- ============================================================================
-- Staff-verified QR / bank-transfer payment — mark_order_paid_transfer
-- (ATLAS-005, 2026-08-19)
-- ============================================================================
-- REVIEW-FIRST MIGRATION: paste into the Supabase SQL Editor and run manually,
-- SECTION BY SECTION. Never executed by any tool in this repo.
--
-- ⛔ ONE EXCEPTION TO "section by section": § 1 is a SINGLE TRANSACTION and must
--    be run whole, `begin;` through `commit;`. Splitting it would briefly commit
--    a payment-transition function carrying PostgreSQL's default PUBLIC EXECUTE
--    grant, which in Supabase means anon and authenticated can call it without
--    the STAFF_WRITE_SECRET route. Run § 1 as one unit; § 3 verifies the result.
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  ⛔ NOT APPLIED. This file is PREPARED ONLY.                              ║
-- ║     Creating a function is a Tier 3 `database_schema_change` and needs a  ║
-- ║     named human approval before it runs against any Supabase project.    ║
-- ║     Until it is applied, POST /api/staff/mark-paid with                   ║
-- ║     paymentMethod "Transfer" fails safe: PostgREST answers 404 for the    ║
-- ║     unknown function and the route returns 502 "Payment update failed."   ║
-- ║     Nothing existing breaks, and Cash is completely unaffected.           ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- WHY THIS FUNCTION EXISTS
--   docs/sql/2026-07-27-payment-proof-review.sql § 6A gives Cash the only
--   manual paid path (mark_order_paid_cash), and § 6B makes an approved
--   customer slip the only way an order becomes payment_method = 'Transfer'.
--   A DINE-IN customer, however, scans the counter QR and staff watch the
--   transfer land in their own banking app — there is no slip to file, no
--   Messenger conversation, and nothing to review. Before this function there
--   was no write path for that, and staff were recording those payments as
--   Cash, which misreports real money.
--
--   The alternative — PATCHing orders.payment_status/payment_method/paid_at
--   from the route — was rejected. It would bypass the § 6A row lock, the
--   cancelled-order refusal and the exactly-once paid_at semantics that the
--   § 5 orders_paid_at_immutable trigger backs. So this mirrors § 6A exactly
--   and changes only the method written, plus a dine-in guard.
--
-- WHAT THIS DOES NOT DO
--   - It does NOT touch public.payment_proofs. A staff-verified transfer
--     creates NO proof row: there is no slip, and fabricating one would put an
--     unreviewed record into the audit trail.
--   - It does NOT change review_payment_proof, mark_order_paid_cash, the
--     paid_at trigger, the status CHECKs or the one-pending-proof index.
--   - It does NOT relax the pickup/delivery money path. Those still become
--     Paid only through review_payment_proof on an approved slip.
--
-- ⚠️ DEPLOYMENT ORDER: run this file BEFORE deploying the app code that calls
--    it (same rule as the 2026-07-27 migration). Running ahead breaks nothing.
-- ⚠️ ROLLBACK ORDER IS THE REVERSE: revert/redeploy the app FIRST, then § 4.


-- ════════════════════════════════════════════════════════════════════════════
-- § 0. PRE-CHECK — READ-ONLY. Run every query, review before continuing.
-- ════════════════════════════════════════════════════════════════════════════

-- 0a. The 2026-07-27 migration MUST already be applied — this function is
--     modelled on it and relies on the same guarantees. Expect one row for
--     mark_order_paid_cash and one for review_payment_proof, both
--     prosecdef = false (SECURITY INVOKER):
select proname, prosecdef as is_security_definer, proconfig from pg_proc
  where pronamespace = 'public'::regnamespace
    and proname in ('mark_order_paid_cash', 'review_payment_proof');

-- 0b. The paid_at immutability trigger must be present (exactly-once paid_at
--     is the guarantee this function inherits rather than re-implements):
select tgname from pg_trigger where tgrelid = 'public.orders'::regclass
  and tgname = 'orders_paid_at_immutable';

-- 0c. This function must NOT already exist (0 rows expected). If it does,
--     read the existing definition before replacing it:
select proname, pg_get_functiondef(oid) from pg_proc
  where pronamespace = 'public'::regnamespace
    and proname = 'mark_order_paid_transfer';

-- 0d. orders.order_type vocabulary. Frozen set: dine_in, pickup, delivery.
--     The dine-in guard below compares against 'dine_in' exactly — anything
--     else here is a BLOCKER, classify it first:
select order_type, count(*) from public.orders group by order_type
  order by order_type;

-- ⛔ STOP. Only continue once 0a/0b show the prerequisites and 0d shows no
--    unclassified order_type. Everything from § 1 MUTATES.


-- ════════════════════════════════════════════════════════════════════════════
-- § 1. mark_order_paid_transfer — CREATE AND LOCK DOWN  ◀── first mutation
-- ════════════════════════════════════════════════════════════════════════════
-- ⛔ RUN THIS ENTIRE SECTION AS ONE UNIT, from `begin;` to `commit;`. Do NOT
--    execute the CREATE on its own and leave the grants for later.
--
--    PostgreSQL grants EXECUTE on a NEW function to PUBLIC by default, and in
--    Supabase both anon and authenticated inherit PUBLIC. A committed function
--    with default privileges is therefore callable by any API caller, without
--    the STAFF_WRITE_SECRET-protected route — a payment transition reachable
--    by an anonymous request. That window must never exist, not even briefly.
--
--    DDL is transactional in PostgreSQL, so wrapping CREATE + REVOKE + GRANT in
--    one transaction closes it completely: no other session sees the function
--    at all until COMMIT, and by then EXECUTE is service_role-only. The
--    restriction is not a later step that could be forgotten, interrupted or
--    lost to a dropped SQL Editor connection — it is part of the same atom.
--
-- A LINE-BY-LINE TWIN of § 6A mark_order_paid_cash, with two differences:
--   1. it writes payment_method = 'Transfer' instead of 'Cash';
--   2. it refuses any order that is not dine_in.
-- Everything else is deliberately identical: FOR UPDATE row lock, cancelled
-- refusal, idempotent on already-paid (paid_at never re-stamped), paid_at set
-- solely on the unpaid → paid transition, same jsonb result shape.
begin;

create or replace function public.mark_order_paid_transfer(
  p_order_number text
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where order_number = p_order_number for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'ORDER_CANCELLED';
  end if;

  -- DINE-IN ONLY, enforced HERE rather than in the route: the check runs under
  -- the same FOR UPDATE lock as the write, so it cannot be raced, and no
  -- caller (route, psql, a future worker) can skip it. A pickup/delivery
  -- transfer is evidenced by the customer's slip and stays on
  -- review_payment_proof — staff never see that money arrive at a counter.
  if v_order.order_type is distinct from 'dine_in' then
    raise exception 'ORDER_NOT_DINE_IN';
  end if;

  -- Idempotent replay, and the Cash-first case: an order already paid keeps
  -- its recorded method and its original paid_at. Never re-stamped, never
  -- rewritten from 'Cash' to 'Transfer' — a completed payment is a fact.
  if lower(coalesce(v_order.payment_status, '')) = 'paid' then
    return jsonb_build_object(
      'order_number', v_order.order_number, 'payment_status', v_order.payment_status,
      'payment_method', v_order.payment_method, 'paid_at', v_order.paid_at,
      'changed', false, 'already_paid', true);
  end if;

  update public.orders
    set payment_status = 'Paid', payment_method = 'Transfer', paid_at = now()
    where id = v_order.id;

  select * into v_order from public.orders where id = v_order.id;
  return jsonb_build_object(
    'order_number', v_order.order_number, 'payment_status', v_order.payment_status,
    'payment_method', v_order.payment_method, 'paid_at', v_order.paid_at,
    'changed', true, 'already_paid', false);
end;
$$;


-- ── Lock down, IN THE SAME TRANSACTION as the CREATE above ──────────────────
-- Revoking from PUBLIC is what actually removes the default EXECUTE grant that
-- CREATE FUNCTION hands out; anon and authenticated are named explicitly too so
-- an inherited or previously-granted privilege cannot survive a re-run. Same
-- rule as § 7 of 2026-07-27: service_role is the only caller.
revoke execute on function public.mark_order_paid_transfer(text)
  from public, anon, authenticated;
grant  execute on function public.mark_order_paid_transfer(text) to service_role;

commit;
-- ▲ Nothing above is visible to any other session until this COMMIT, and by
--   then EXECUTE is service_role-only. The function is never committed with
--   default PUBLIC privileges.


-- ════════════════════════════════════════════════════════════════════════════
-- § 2. Reload the PostgREST schema cache
-- ════════════════════════════════════════════════════════════════════════════
-- Permissions were set atomically in § 1 — there is deliberately no separate
-- grant step here that could be skipped. This only makes the function visible
-- to PostgREST, so /rest/v1/rpc/mark_order_paid_transfer stops answering 404.
notify pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════════════
-- § 3. Verification (run after; read-only)
-- ════════════════════════════════════════════════════════════════════════════
-- a) SECURITY INVOKER + pinned search_path:
select proname, prosecdef as is_security_definer, proconfig from pg_proc
  where pronamespace = 'public'::regnamespace
    and proname = 'mark_order_paid_transfer';
-- b) THE CHECK THAT MATTERS: no PUBLIC/anon/authenticated EXECUTE survived.
--    information_schema records a PUBLIC grant with grantee 'PUBLIC' in UPPER
--    case, so this compares case-insensitively — a lower-case-only IN list
--    silently misses the exact default grant § 1 exists to prevent. -- 0 rows
select routine_name, grantee from information_schema.routine_privileges
  where routine_schema = 'public'
    and upper(grantee) in ('PUBLIC', 'ANON', 'AUTHENTICATED')
    and routine_name = 'mark_order_paid_transfer';
--    Belt and braces, straight from the catalog (proacl null means DEFAULT
--    privileges, i.e. PUBLIC EXECUTE — that is a FAILURE here, not a pass):
select proname, proacl from pg_proc
  where pronamespace = 'public'::regnamespace
    and proname = 'mark_order_paid_transfer';
--    Expect proacl to list service_role=X only, and NOT to be null.
-- c) The Messenger proof path is untouched — this must still be the ONLY
--    function whose body writes an approved proof review:
select proname, pg_get_functiondef(oid) like '%payment_proofs%' as touches_proofs
  from pg_proc where pronamespace = 'public'::regnamespace
    and proname in ('mark_order_paid_cash', 'mark_order_paid_transfer',
                    'review_payment_proof');
--    Expect: review_payment_proof true; BOTH mark_order_paid_* false.


-- ════════════════════════════════════════════════════════════════════════════
-- § 4. FUNCTIONAL TESTS — ⚠️ STAGING ONLY. Never run against Production.
-- ════════════════════════════════════════════════════════════════════════════
-- Creates real rows; every statement is scoped by a test key, and the block
-- ends with cleanup. Replace 'A01' with a real available item_code.
--
-- T1. Seed an unpaid DINE-IN order:
--   select public.create_order_with_items(
--     'customer','sql-staff-transfer-0001','dine_in','7','Transfer Test',null,null,
--     'transfer dry run — delete me','[{"item_code":"A01","quantity":1}]'::jsonb);
--
-- T2. First call flips the order to Paid/Transfer and stamps paid_at:
--   select public.mark_order_paid_transfer('<order_number>');   -- changed true
--   select payment_status, payment_method, paid_at from public.orders
--     where order_number = '<order_number>';                    -- Paid, Transfer
--
-- T3. Replay is idempotent — paid_at NOT re-stamped, method unchanged:
--   select public.mark_order_paid_transfer('<order_number>');   -- changed false,
--                                                               -- already_paid true
--
-- T4. NO proof row was created (this is the point of the feature):    -- 0 rows
--   select * from public.payment_proofs where order_id =
--     (select id from public.orders where order_number = '<order_number>');
--
-- T5. A PICKUP order is refused, and nothing is written. Seed an unpaid pickup
--     order, then:
--   select public.mark_order_paid_transfer('<pickup_order_number>');
--     → ERROR ORDER_NOT_DINE_IN
--   select payment_status, payment_method, paid_at from public.orders
--     where order_number = '<pickup_order_number>';   -- unchanged, paid_at null
--   (same for a delivery order)
--
-- T6. A CANCELLED dine-in order can never be paid:
--   update public.orders set status='cancelled', cancelled_at=now()
--     where order_number='<n3>';
--   select public.mark_order_paid_transfer('<n3>');   -- ERROR ORDER_CANCELLED
--
-- T7. A missing order:
--   select public.mark_order_paid_transfer('TP-DOES-NOT-EXIST');
--     → ERROR ORDER_NOT_FOUND
--
-- T8. Cash first WINS — a staff transfer never rewrites a recorded Cash
--     payment. Seed an unpaid dine-in order, then:
--   select public.mark_order_paid_cash('<n4>');       -- Paid, Cash
--   select public.mark_order_paid_transfer('<n4>');   -- changed false,
--                                                     -- already_paid true
--   select payment_method, paid_at from public.orders where order_number='<n4>';
--     → still 'Cash', same paid_at
--
-- T9. paid_at stays immutable through this path too (§ 5 trigger, unchanged):
--   update public.orders set paid_at = now() - interval '1 day'
--     where order_number = '<order_number>';   -- ERROR ORDER_PAID_AT_IMMUTABLE
--
-- T10. The Messenger flow is unchanged. A dine-in order paid by this function
--      still refuses a later proof approval, exactly as it does after Cash:
--   -- (order paid above, with a pending proof filed by n8n)
--   select public.review_payment_proof('<pending_proof>', 'approve', 'sql');
--     → ERROR ORDER_ALREADY_PAID   (staff reject the redundant slip)
--
-- ── § 4 CLEANUP ──
-- delete from public.payment_proofs where order_id in
--   (select id from public.orders where client_request_id like 'sql-staff-transfer-%');
-- delete from public.orders where client_request_id like 'sql-staff-transfer-%';


-- ════════════════════════════════════════════════════════════════════════════
-- § 5. ROLLBACK (commented out — copy lines out to use)
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ APP FIRST. Revert/redeploy the app commit BEFORE running this, otherwise
--    the Paid by QR / Transfer button starts answering 502.
--
-- drop function if exists public.mark_order_paid_transfer(text);
-- notify pgrst, 'reload schema';
--
-- Dropping this function restores the previous contract exactly: Cash via
-- mark_order_paid_cash, Transfer only via an approved payment proof. Orders
-- already marked Paid/Transfer by it keep their row — payment_method is a
-- value the app already understands, and paid_at stays immutable.
