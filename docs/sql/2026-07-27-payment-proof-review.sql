-- ============================================================================
-- Tuesday (CORRECTED) — payment-proof review, status freeze, and paid-once
-- guarantees (2026-07-27)
-- ============================================================================
-- REVIEW-FIRST MIGRATION: paste into the Supabase SQL Editor and run manually,
-- SECTION BY SECTION. Never executed by any tool in this repo.
--
-- WHAT THIS DELIVERS (all the database halves of the corrected Tuesday scope):
--   § 1  payment_proofs review columns (reviewed_at/by, rejection_reason)
--   § 2  legacy proof-status reconciliation ('proof_received'/'received' →
--        'pending'), default → 'pending', RERUNNABLE status CHECK
--   § 3  partial unique index — one pending proof per order
--   § 4  RERUNNABLE orders.status CHECK pinned to the 8 frozen values
--   § 5  orders.paid_at immutability trigger (documented admin escape hatch)
--   § 6  RPCs: mark_order_paid_cash and the CORRECTED review_payment_proof
--        (exactly-once, cancelled-safe, already-paid-safe)
--
-- THERE IS NO CUSTOMER PAYMENT CAPABILITY AND NO SECOND PAYMENT LINK. Payment
-- slips arrive in the Instagram/Messenger chat and are filed by n8n through
-- POST /api/automation/payment-proof, which inserts a 'pending' row here. The
-- ordering link creates exactly one order and can never carry proof.
--
-- ⛔ THE LEGACY n8n "Add Payment Proof" WORKFLOW MUST STAY DISABLED. It inserts
-- the old 'received' status (rejected by the § 2 CHECK), writes no
-- proof_file_path, and satisfies none of the trusted-intake contract.
--
-- ⚠️ DEPLOYMENT ORDER: run this file BEFORE deploying the corrected app code.
-- The intake/Cash/review paths fail safe (500) until their objects exist;
-- nothing existing is broken by running ahead.
--
-- ⚠️ ROLLBACK ORDER IS THE REVERSE: revert/redeploy the app FIRST, then § 9.
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  ⛔ RUN § 0 (READ-ONLY PRE-CHECK) FIRST AND REVIEW EVERY RESULT.          ║
-- ║     SELECT-only, safe against Production. Do not run § 1+ until § 0 shows ║
-- ║     no unclassified legacy status values. Everything from § 1 MUTATES.    ║
-- ║                                                                          ║
-- ║  ⚠️ The § 8b FUNCTIONAL tests create real rows and are STAGING-ONLY.      ║
-- ║     Never run § 8b against Production. There is no destructive test here. ║
-- ╚══════════════════════════════════════════════════════════════════════════╝


-- ════════════════════════════════════════════════════════════════════════════
-- § 0. PRE-CHECK — READ-ONLY. Run every query, review before continuing.
-- ════════════════════════════════════════════════════════════════════════════

-- 0a. payment_proofs columns + current default (the live default is
--     'proof_received'; § 2 changes it to 'pending'):
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
  where table_schema = 'public' and table_name = 'payment_proofs'
  order by ordinal_position;

-- 0b. Existing constraints + indexes on payment_proofs (detect a pre-existing
--     status CHECK / pending index / duplicate object names — § 2/§ 3 are
--     written to be rerunnable, but review before re-adding):
select conname, pg_get_constraintdef(oid) from pg_constraint
  where conrelid = 'public.payment_proofs'::regclass order by conname;
select indexname, indexdef from pg_indexes
  where schemaname = 'public' and tablename = 'payment_proofs' order by indexname;

-- 0c. Distinct proof status values. Frozen set: pending|approved|rejected.
--     KNOWN legacy values § 2 reconciles: 'proof_received' AND 'received'
--     (both mean "uploaded, not yet reviewed" = pending). ANY OTHER value is a
--     BLOCKER — classify + reconcile it in its own step before § 2:
select status, count(*) from public.payment_proofs group by status order by status;

-- 0d. Distinct orders.status values. Frozen set: new, accepted, preparing,
--     ready_for_pickup, out_for_delivery, delivered, completed, cancelled.
--     KNOWN legacy aliases § 4 reconciles: 'ready'→'ready_for_pickup',
--     'done'→'completed'. Anything else is a BLOCKER:
select status, count(*) from public.orders group by status order by status;

-- 0e. Distinct orders.payment_status values (the RPCs treat lower(status)='paid'
--     as already-paid and write the canonical 'Paid'):
select payment_status, count(*) from public.orders
  group by payment_status order by payment_status;

-- 0f. Conflicting data:
--     (i) orders with >1 pending-like proof (would break the § 3 one-pending
--         index — reconcile to a single pending first). Covers BOTH legacy
--         spellings AND the new 'pending':
select order_id, count(*) as pending_like from public.payment_proofs
  where status in ('pending', 'received', 'proof_received')
  group by order_id having count(*) > 1;
--     (ii) already-paid orders still carrying a pending-like proof (informational
--          — the review RPC + upload route refuse to change a paid order):
select p.order_id, o.order_number, o.payment_status
  from public.payment_proofs p join public.orders o on o.id = p.order_id
  where p.status in ('pending', 'received', 'proof_received')
    and lower(o.payment_status) = 'paid';

-- 0g. Existing CHECK constraints on orders (baseline: none on status):
select conname, pg_get_constraintdef(oid) from pg_constraint
  where conrelid = 'public.orders'::regclass and contype = 'c';

-- ⛔ STOP. Only continue once 0c and 0d show no unclassified values.


-- ════════════════════════════════════════════════════════════════════════════
-- § 1. payment_proofs review fields   ◀── first mutating statement is `begin;`
-- ════════════════════════════════════════════════════════════════════════════
begin;

alter table public.payment_proofs
  add column if not exists reviewed_at      timestamptz,
  add column if not exists reviewed_by      text,
  add column if not exists rejection_reason text;

commit;


-- ════════════════════════════════════════════════════════════════════════════
-- § 2. Reconcile legacy proof status, set default, freeze vocabulary
-- ════════════════════════════════════════════════════════════════════════════
-- The LIVE default is 'proof_received' (verified). Both 'proof_received' and
-- 'received' mean "uploaded, awaiting review" = the new 'pending'. Reconcile
-- ONLY those two; § 0c must have shown nothing else. The CHECK is dropped and
-- re-added by NAME so this section is safely rerunnable.
begin;

update public.payment_proofs set status = 'pending'
  where status in ('received', 'proof_received');

-- Fail LOUDLY (never silently) if any non-frozen value survived.
do $$
declare v_bad int;
begin
  select count(*) into v_bad from public.payment_proofs
    where status is null or status not in ('pending', 'approved', 'rejected');
  if v_bad > 0 then
    raise exception 'PAYMENT_PROOF_STATUS_UNRECONCILED: % row(s) hold a status outside {pending,approved,rejected}. Classify them (see § 0c) before running § 2.', v_bad;
  end if;
end $$;

-- New rows default to 'pending' (was 'proof_received').
alter table public.payment_proofs alter column status set default 'pending';

-- Rerunnable CHECK (drop-by-name then add).
alter table public.payment_proofs drop constraint if exists payment_proofs_status_check;
alter table public.payment_proofs
  add constraint payment_proofs_status_check
  check (status in ('pending', 'approved', 'rejected'));

commit;


-- ════════════════════════════════════════════════════════════════════════════
-- § 3. Partial unique index — ONE pending proof per order
-- ════════════════════════════════════════════════════════════════════════════
begin;
create unique index if not exists payment_proofs_one_pending_per_order
  on public.payment_proofs (order_id) where status = 'pending';
commit;


-- ════════════════════════════════════════════════════════════════════════════
-- § 4. Reconcile + freeze orders.status (RERUNNABLE)
-- ════════════════════════════════════════════════════════════════════════════
begin;

update public.orders set status = 'ready_for_pickup' where status = 'ready';
update public.orders set status = 'completed'        where status = 'done';

do $$
declare v_bad int;
begin
  select count(*) into v_bad from public.orders
    where status is null or status not in
      ('new','accepted','preparing','ready_for_pickup',
       'out_for_delivery','delivered','completed','cancelled');
  if v_bad > 0 then
    raise exception 'ORDER_STATUS_UNRECONCILED: % row(s) hold a status outside the frozen set. Classify them (see § 0d) before running § 4.', v_bad;
  end if;
end $$;

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders
  add constraint orders_status_check
  check (status in
    ('new','accepted','preparing','ready_for_pickup',
     'out_for_delivery','delivered','completed','cancelled'));

commit;


-- ════════════════════════════════════════════════════════════════════════════
-- § 5. orders.paid_at immutability (system-wide guarantee)
-- ════════════════════════════════════════════════════════════════════════════
-- Once paid_at is set it may not be rewritten by ANY path. The RPCs below only
-- set paid_at on the unpaid→paid transition (OLD.paid_at null), so they are
-- unaffected. DOCUMENTED ADMIN ESCAPE for a legitimate repair/rollback:
--   begin;
--   set local atlas.allow_paid_at_change = 'on';
--   update public.orders set paid_at = ... where ...;   -- your controlled fix
--   commit;
begin;

create or replace function public.enforce_paid_at_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and old.paid_at is not null
     and new.paid_at is distinct from old.paid_at
     and coalesce(current_setting('atlas.allow_paid_at_change', true), 'off') <> 'on' then
    raise exception 'ORDER_PAID_AT_IMMUTABLE: paid_at cannot be changed once set (use the documented admin escape for repairs)';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_paid_at_immutable on public.orders;
create trigger orders_paid_at_immutable
  before update on public.orders
  for each row execute function public.enforce_paid_at_immutable();

commit;


-- ════════════════════════════════════════════════════════════════════════════
-- § 6. RPCs (service_role only). All SECURITY INVOKER + pinned search_path.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 6A. mark_order_paid_cash ────────────────────────────────────────────────
-- The ONLY manual paid path — Cash exclusively. Locks the order, refuses
-- cancelled, is idempotent on already-paid (paid_at never re-stamped), and sets
-- paid_at solely on the unpaid→paid transition. Transfer NEVER reaches here.
create or replace function public.mark_order_paid_cash(
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

  if lower(coalesce(v_order.payment_status, '')) = 'paid' then
    return jsonb_build_object(
      'order_number', v_order.order_number, 'payment_status', v_order.payment_status,
      'payment_method', v_order.payment_method, 'paid_at', v_order.paid_at,
      'changed', false, 'already_paid', true);
  end if;

  update public.orders
    set payment_status = 'Paid', payment_method = 'Cash', paid_at = now()
    where id = v_order.id;

  select * into v_order from public.orders where id = v_order.id;
  return jsonb_build_object(
    'order_number', v_order.order_number, 'payment_status', v_order.payment_status,
    'payment_method', v_order.payment_method, 'paid_at', v_order.paid_at,
    'changed', true, 'already_paid', false);
end;
$$;

-- ── 6B. review_payment_proof (CORRECTED) ────────────────────────────────────
-- Exactly-once approve; cancelled-safe; already-paid-safe. Transfer is written
-- ONLY here — no manual route can set it. Rejecting keeps the order unpaid and
-- (with § 3's partial index applying only to 'pending') leaves the customer
-- free to send another slip in the chat, which n8n files as a NEW pending row.
create or replace function public.review_payment_proof(
  p_proof_id  uuid,
  p_decision  text,          -- 'approve' | 'reject'
  p_reviewer  text,
  p_reason    text default null
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_proof public.payment_proofs%rowtype;
  v_order public.orders%rowtype;
  v_changed boolean := false;
  v_already_paid boolean;
begin
  if p_decision is null or p_decision not in ('approve', 'reject') then
    raise exception 'PROOF_BAD_DECISION';
  end if;

  select * into v_proof from public.payment_proofs where id = p_proof_id for update;
  if not found then
    raise exception 'PROOF_NOT_FOUND';
  end if;

  select * into v_order from public.orders where id = v_proof.order_id for update;
  if not found then
    raise exception 'PROOF_ORDER_MISSING';
  end if;

  -- A cancelled order can never be approved OR rejected into a payment change;
  -- it is simply not reviewable. Never mark a cancelled order paid.
  if v_order.status = 'cancelled' then
    raise exception 'PROOF_ORDER_CANCELLED';
  end if;

  -- A COMPLETED order is closed for review the same way: the food is out and
  -- the money question was settled at the counter. Both decisions are refused
  -- BEFORE any write, so the proof stays exactly as it was (pending stays
  -- pending) and payment_status/paid_at cannot move. A slip that arrives after
  -- completion is handled off-system, never by fabricating a review here.
  if v_order.status = 'completed' then
    raise exception 'PROOF_ORDER_COMPLETED';
  end if;

  v_already_paid := lower(coalesce(v_order.payment_status, '')) = 'paid';

  if p_decision = 'approve' then
    if v_proof.status = 'rejected' then
      raise exception 'PROOF_ALREADY_REJECTED';
    end if;
    -- Already-paid (e.g. Cash at pickup): do NOT fabricate an approved proof.
    -- Refuse with a stable code; staff should reject the redundant slip.
    if v_already_paid and v_proof.status = 'pending' then
      raise exception 'ORDER_ALREADY_PAID';
    end if;

    if v_proof.status = 'pending' then
      update public.payment_proofs
        set status = 'approved', reviewed_at = now(), reviewed_by = p_reviewer,
            rejection_reason = null
        where id = v_proof.id;
      -- EXACTLY ONCE: the order was unpaid (checked above), so this is the sole
      -- transition; paid_at is stamped here and never again.
      --
      -- payment_method is set to 'Transfer' UNCONDITIONALLY, not coalesced. A
      -- non-null value on an UNPAID order is stale (a staff mis-tap, an import,
      -- an earlier intent) and describes no completed payment — this proof IS
      -- the payment, and it is a transfer. Letting a stale 'Cash' survive would
      -- report the wrong method for real money. Replays never reach here (the
      -- order is paid by then), so a genuine Cash payment is never overwritten.
      update public.orders
        set payment_status = 'Paid',
            payment_method = 'Transfer',
            paid_at = now()
        where id = v_order.id;
      v_changed := true;
    end if;
    -- proof already 'approved' → idempotent replay, fall through.

  else  -- reject
    if v_proof.status = 'approved' then
      raise exception 'PROOF_ALREADY_APPROVED';
    end if;
    if p_reason is null or btrim(p_reason) = '' then
      raise exception 'PROOF_REASON_REQUIRED';
    end if;
    if v_proof.status = 'pending' then
      update public.payment_proofs
        set status = 'rejected', reviewed_at = now(), reviewed_by = p_reviewer,
            rejection_reason = btrim(p_reason)
        where id = v_proof.id;
      v_changed := true;   -- order unchanged; a new slip may arrive in the chat
    end if;
  end if;

  select * into v_proof from public.payment_proofs where id = v_proof.id;
  select * into v_order from public.orders where id = v_order.id;
  return jsonb_build_object(
    'proof_id', v_proof.id, 'proof_status', v_proof.status,
    'order_number', v_order.order_number, 'payment_status', v_order.payment_status,
    'paid_at', v_order.paid_at, 'changed', v_changed);
end;
$$;


-- ════════════════════════════════════════════════════════════════════════════
-- § 7. Function permissions — service_role ONLY
-- ════════════════════════════════════════════════════════════════════════════
revoke execute on function public.mark_order_paid_cash(text)
  from public, anon, authenticated;
grant  execute on function public.mark_order_paid_cash(text) to service_role;

revoke execute on function public.review_payment_proof(uuid, text, text, text)
  from public, anon, authenticated;
grant  execute on function public.review_payment_proof(uuid, text, text, text) to service_role;

notify pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════════════
-- § 8. Verification (run after; read-only)
-- ════════════════════════════════════════════════════════════════════════════
-- a) Review columns + default:
select column_name, column_default from information_schema.columns
  where table_schema = 'public' and table_name = 'payment_proofs'
    and column_name in ('status', 'reviewed_at', 'reviewed_by', 'rejection_reason')
  order by column_name;
-- b) Constraints/indexes:
select conname from pg_constraint where conrelid = 'public.payment_proofs'::regclass
  and conname = 'payment_proofs_status_check';
select indexdef from pg_indexes where indexname = 'payment_proofs_one_pending_per_order';
select pg_get_constraintdef(oid) from pg_constraint
  where conrelid = 'public.orders'::regclass and conname = 'orders_status_check';
-- c) No customer capability table exists (this migration creates none):
select to_regclass('public.payment_proof_sessions') as must_be_null;
-- payment_proofs stays server-only (service_role); no anon/authenticated grants:
select grantee, privilege_type from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'payment_proofs'
    and grantee in ('anon', 'authenticated');                            -- 0 rows
-- d) paid_at trigger present:
select tgname from pg_trigger where tgrelid = 'public.orders'::regclass
  and tgname = 'orders_paid_at_immutable';
-- e) All RPCs SECURITY INVOKER, service_role EXECUTE only:
select proname, prosecdef as is_security_definer, proconfig from pg_proc
  where pronamespace = 'public'::regnamespace and proname in
    ('mark_order_paid_cash','review_payment_proof');
select routine_name, grantee from information_schema.routine_privileges
  where routine_schema = 'public' and grantee in ('anon','authenticated','public')
    and routine_name in ('mark_order_paid_cash','review_payment_proof');  -- 0 rows


-- ════════════════════════════════════════════════════════════════════════════
-- § 8b. FUNCTIONAL TESTS — ⚠️ STAGING ONLY. Never run against Production.
-- ════════════════════════════════════════════════════════════════════════════
-- Creates real rows; each block ends with cleanup. There is deliberately NO
-- destructive/global test here — every statement is scoped by a test key.
-- Replace 'A01' with a real available item_code.
--
-- T1. Seed a test order + a pending proof (the shape trusted intake writes —
--     private proof_file_path, status 'pending', source 'bot_instagram'):
--   with o as (select (public.create_order_with_items(
--     'customer','sql-pay-proof-0001','pickup',null,'Proof Test','0800000000',null,
--     'proof dry run — delete me','[{"item_code":"A01","quantity":1}]'::jsonb)->>'order_id')::uuid id)
--   insert into public.payment_proofs (order_id, proof_file_path, source, status, received_at)
--     select id, id || '/00000000-0000-4000-8000-000000000001.jpg', 'bot_instagram', 'pending', now()
--     from o returning id, order_id;
--
-- T2. Default + CHECK: an insert with no status lands as 'pending'; an insert
--     with status 'received' (the LEGACY n8n workflow's value) must ERROR:
--   insert into public.payment_proofs (order_id, proof_file_path, status)
--     values ('<order_id>', 'x/y.jpg', 'received');   -- ERROR payment_proofs_status_check
--
-- T3. mark_order_paid_cash idempotency (paid_at immutable):
--   select public.mark_order_paid_cash('<order_number>');        -- changed true
--   select public.mark_order_paid_cash('<order_number>');        -- changed false, same paid_at
--
-- T4. paid_at immutability trigger (must ERROR without the escape):
--   update public.orders set paid_at = now() - interval '1 day' where order_number = '<n>';
--     → ERROR ORDER_PAID_AT_IMMUTABLE
--   -- documented escape works:
--   begin; set local atlas.allow_paid_at_change='on';
--   update public.orders set paid_at = paid_at where order_number='<n>'; commit;   -- ok (no-op)
--
-- T5. Review (approve exactly once):
--   select public.review_payment_proof('<proof>', 'approve', 'sql'); -- Paid+Transfer once
--   select public.review_payment_proof('<proof>', 'approve', 'sql'); -- changed false, paid_at unchanged
--
-- T5b. Reject requires a reason, and a REJECTED proof frees the one-pending
--      slot so the customer's next chat slip files cleanly:
--   select public.review_payment_proof('<proof_r>', 'reject', 'sql');            -- ERROR PROOF_REASON_REQUIRED
--   select public.review_payment_proof('<proof_r>', 'reject', 'sql', 'blurry');  -- rejected, order still unpaid
--   insert into public.payment_proofs (order_id, proof_file_path, source, status)
--     values ('<same_order_id>', '<same_order_id>/…-0002.jpg', 'bot_instagram', 'pending');  -- ok
--   -- both rows remain: the rejected one is retained for audit.
--
-- T6. Cancelled order cannot be reviewed:
--   update public.orders set status='cancelled', cancelled_at=now() where order_number='<n2>';
--   select public.review_payment_proof('<pending_proof_2>', 'approve', 'sql');  -- ERROR PROOF_ORDER_CANCELLED
--
-- T7. Already-paid (Cash) refuses approving a Transfer proof:
--   -- order paid via mark_order_paid_cash, with a still-pending proof:
--   select public.review_payment_proof('<pending_proof_3>', 'approve', 'sql');  -- ERROR ORDER_ALREADY_PAID
--
-- T7b. COMPLETED order refuses BOTH decisions and changes NOTHING. Seed a
--      fresh unpaid order + pending proof, complete the order, then:
--   update public.orders set status='completed' where order_number='<n4>';
--   -- record the before-state:
--   select payment_status, payment_method, paid_at from public.orders where order_number='<n4>';
--   select status, reviewed_at, reviewed_by, rejection_reason
--     from public.payment_proofs where id='<pending_proof_4>';
--   select public.review_payment_proof('<pending_proof_4>','approve','sql');
--     → ERROR PROOF_ORDER_COMPLETED
--   select public.review_payment_proof('<pending_proof_4>','reject','sql','wrong slip');
--     → ERROR PROOF_ORDER_COMPLETED
--   -- re-run BOTH selects above and diff against the before-state:
--   --   orders.payment_status unchanged (still unpaid), payment_method unchanged,
--   --   paid_at still null; proof still 'pending' with reviewed_at/reviewed_by/
--   --   rejection_reason all still null.
--
-- T7c. STALE payment_method is overwritten on the proof-approved transition,
--      and a replay rewrites nothing. Seed an UNPAID order carrying a stale
--      method plus a pending proof:
--   update public.orders set payment_method='Cash'
--     where order_number='<n5>' and lower(coalesce(payment_status,'')) <> 'paid';
--   select public.review_payment_proof('<pending_proof_5>','approve','sql');
--   select payment_status, payment_method, paid_at from public.orders where order_number='<n5>';
--     → 'Paid', 'Transfer' (NOT 'Cash'), paid_at set
--   -- replay: idempotent, rewrites neither field:
--   select public.review_payment_proof('<pending_proof_5>','approve','sql');  -- changed false
--   select payment_status, payment_method, paid_at from public.orders where order_number='<n5>';
--     → identical row, same paid_at, still 'Transfer'
--
-- T8. One-pending guard: a 2nd pending proof for one order → unique violation
--     on payment_proofs_one_pending_per_order (SQLSTATE 23505). That exact
--     constraint name + code is what the intake route matches to answer
--     PENDING_PROOF_EXISTS; any other 23505 is reported as INSERT_FAILED.
--
-- ── § 8b CLEANUP (proofs first, then the orders; the paid_at trigger does not
--    block DELETE). Storage objects, if any, are removed by hand. ──
-- delete from public.payment_proofs where order_id in
--   (select id from public.orders where client_request_id like 'sql-pay-proof-%');
-- delete from public.orders where client_request_id like 'sql-pay-proof-%';


-- ════════════════════════════════════════════════════════════════════════════
-- § 9. ROLLBACK (commented out — copy lines out to use)
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ APP FIRST. Revert/redeploy the app commit BEFORE running any of this.
--
-- 9.1 Drop the RPCs:
-- drop function if exists public.review_payment_proof(uuid, text, text, text);
-- drop function if exists public.mark_order_paid_cash(text);
--
-- 9.2 Drop the paid_at trigger (restores mutability):
-- drop trigger if exists orders_paid_at_immutable on public.orders;
-- drop function if exists public.enforce_paid_at_immutable();
--
-- 9.3 Proof review constraints/columns + default (data-lossy for review fields).
--      ⚠️ Dropping the status CHECK re-permits the legacy 'received' value —
--      only do this if the legacy n8n Add Payment Proof workflow is coming back:
-- drop index if exists public.payment_proofs_one_pending_per_order;
-- alter table public.payment_proofs drop constraint if exists payment_proofs_status_check;
-- alter table public.payment_proofs alter column status set default 'proof_received';  -- prior live default
-- alter table public.payment_proofs
--   drop column if exists reviewed_at, drop column if exists reviewed_by,
--   drop column if exists rejection_reason;
--
-- 9.4 orders.status CHECK (REQUIRED to drop if reverting to the old vocabulary):
-- alter table public.orders drop constraint if exists orders_status_check;
-- -- (this does NOT rewrite 'ready_for_pickup' back to 'ready'; if the old app
-- --  must read those rows: update public.orders set status='ready' where status='ready_for_pickup';)
--
-- notify pgrst, 'reload schema';
