-- ============================================================================
-- Phase 2G-I — secure server-side order intake (2026-07-14)
-- ============================================================================
-- REVIEW-FIRST MIGRATION: paste into the Supabase SQL Editor and run manually.
-- Never executed by any tool in this repo. Non-destructive: adds one column,
-- one unique index, and one function. Nothing existing is altered or dropped.
--
-- WHY: customer checkout and Staff Add Order move off the n8n intake webhook
-- onto the app's own server routes. The browser is no longer trusted for
-- prices, names, totals, fees, availability, or the order number — this
-- function recomputes everything from menu_items and inserts orders +
-- order_items in ONE transaction (n8n did two sequential inserts; a failure
-- between them could leave an empty order — this cannot).
--
-- DEPLOYMENT ORDER: run this file BEFORE deploying the 2G-I app code. Until
-- it runs, the new routes fail with a safe 500 and no data is touched (the
-- RPC doesn't exist). The old n8n path keeps working throughout.

-- ── 1. Idempotency column (duplicate-submit protection) ─────────────────────
-- The frontend generates ONE requestId per intended order (crypto.randomUUID)
-- and reuses it on retries. A retry of the same id returns the ORIGINAL order
-- instead of inserting a duplicate. Partial unique index: existing rows (all
-- NULL) are unaffected.

begin;

alter table public.orders
  add column client_request_id text;

create unique index orders_client_request_id_key
  on public.orders (client_request_id)
  where client_request_id is not null;

commit;

-- ── 2. Transaction-safe order creation function ──────────────────────────────
-- Called ONLY by the app's server routes via PostgREST RPC with the
-- service_role key. SECURITY INVOKER (no DEFINER needed: service_role already
-- has full access and bypasses RLS); search_path pinned anyway as belt and
-- braces. EXECUTE is revoked from public/anon/authenticated in § 3 — the
-- browser can never call this directly.
--
-- Money rule: p_items carries ONLY item_code + quantity. Unit price and the
-- item-name snapshot come from menu_items; line totals, subtotal, delivery
-- fee and total are computed HERE. Client-sent money never reaches this
-- function at all.
--
-- Delivery fee: fixed 30 THB for delivery, 0 otherwise. The delivery_zones
-- table holds placeholder/demo rows — deliberately NOT consulted until real
-- zones are configured (then: pass a zone id and read the fee here).
--
-- Errors are raised with machine-readable messages (ORDER_*) + the offending
-- item_code in DETAIL; the server route maps them to safe user messages.

create or replace function public.create_order_with_items(
  p_channel text,            -- 'customer' | 'staff' — set by the server route, never the browser
  p_client_request_id text,
  p_order_type text,         -- 'dine_in' | 'pickup' | 'delivery'
  p_table_number text,
  p_customer_name text,
  p_customer_phone text,
  p_customer_address text,
  p_customer_note text,
  p_items jsonb              -- [{"item_code": "A01", "quantity": 2}, ...]
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_prefix text;
  v_source text;
  v_existing public.orders%rowtype;
  v_line record;
  v_menu public.menu_items%rowtype;
  v_status text;
  v_subtotal numeric := 0;
  v_delivery_fee numeric;
  v_resolved jsonb := '[]'::jsonb;
  v_base text;
  v_order_number text;
  v_order_id uuid;
  v_attempt int;
  v_constraint text;
begin
  -- Channel decides prefix + source — the browser can never choose either.
  if p_channel = 'customer' then
    v_prefix := 'TP-';   v_source := 'customer_menu';
  elsif p_channel = 'staff' then
    v_prefix := 'TP-S-'; v_source := 'staff_manual';
  else
    raise exception 'ORDER_BAD_CHANNEL';
  end if;

  if p_order_type not in ('dine_in', 'pickup', 'delivery') then
    raise exception 'ORDER_BAD_TYPE';
  end if;

  if p_client_request_id is null or length(p_client_request_id) < 8
     or length(p_client_request_id) > 64 then
    raise exception 'ORDER_BAD_REQUEST_ID';
  end if;

  -- Idempotency fast path: same request id → return the original order.
  select * into v_existing
    from public.orders where client_request_id = p_client_request_id;
  if found then
    return jsonb_build_object(
      'order_number', v_existing.order_number,
      'subtotal', v_existing.subtotal,
      'delivery_fee', v_existing.delivery_fee,
      'total', v_existing.total,
      'duplicate', true);
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'ORDER_EMPTY';
  end if;
  if jsonb_array_length(p_items) > 30 then
    raise exception 'ORDER_TOO_MANY_LINES';
  end if;

  -- Resolve every line against menu_items — the ONLY source of prices/names.
  for v_line in
    select e->>'item_code' as item_code, (e->>'quantity')::int as quantity
      from jsonb_array_elements(p_items) e
  loop
    if v_line.item_code is null or v_line.quantity is null
       or v_line.quantity < 1 or v_line.quantity > 99 then
      raise exception 'ORDER_BAD_QUANTITY' using detail = coalesce(v_line.item_code, '?');
    end if;

    select * into v_menu from public.menu_items
      where item_code = v_line.item_code;
    if not found then
      raise exception 'ORDER_ITEM_UNKNOWN' using detail = v_line.item_code;
    end if;

    -- 3-state availability (2G-H); boolean fallback if status is ever null.
    v_status := coalesce(v_menu.availability_status,
                         case when v_menu.is_available then 'available' else 'sold_out' end);
    if v_status <> 'available' then
      raise exception 'ORDER_ITEM_UNAVAILABLE' using detail = v_line.item_code;
    end if;
    if v_menu.price is null or v_menu.price <= 0 then
      raise exception 'ORDER_ITEM_UNPRICED' using detail = v_line.item_code;
    end if;

    v_subtotal := v_subtotal + v_menu.price * v_line.quantity;
    v_resolved := v_resolved || jsonb_build_object(
      'menu_item_id', v_menu.id,
      'item_code', v_menu.item_code,
      'item_name', v_menu.name_en,
      'quantity', v_line.quantity,
      'unit_price', v_menu.price,
      'line_total', v_menu.price * v_line.quantity);
  end loop;

  v_delivery_fee := case when p_order_type = 'delivery' then 30 else 0 end;

  -- Server-generated order number, familiar Bangkok-time format
  -- (TP-YYYYMMDD-HHMMSS / TP-S-…). Same-second collisions retry with a -2…-6
  -- suffix against the orders_order_number unique constraint.
  v_base := v_prefix || to_char(now() at time zone 'Asia/Bangkok', 'YYYYMMDD-HH24MISS');
  for v_attempt in 1..6 loop
    v_order_number := v_base || case when v_attempt = 1 then '' else '-' || v_attempt end;
    begin
      insert into public.orders
        (order_number, order_type, status, table_number,
         customer_name, customer_phone, customer_address, customer_note,
         source, subtotal, delivery_fee, total,
         payment_method, payment_status, client_request_id)
      values
        (v_order_number, p_order_type, 'new',
         case when p_order_type = 'dine_in' then p_table_number else null end,
         -- dine_in never stores leftover customer/delivery data:
         case when p_order_type = 'dine_in' then null else p_customer_name end,
         case when p_order_type = 'dine_in' then null else p_customer_phone end,
         case when p_order_type = 'delivery' then p_customer_address else null end,
         p_customer_note,
         v_source, v_subtotal, v_delivery_fee, v_subtotal + v_delivery_fee,
         null, 'unpaid', p_client_request_id)
      returning id into v_order_id;
      exit;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'orders_client_request_id_key' then
        -- Concurrent duplicate submit won the race — return its order.
        select * into v_existing
          from public.orders where client_request_id = p_client_request_id;
        return jsonb_build_object(
          'order_number', v_existing.order_number,
          'subtotal', v_existing.subtotal,
          'delivery_fee', v_existing.delivery_fee,
          'total', v_existing.total,
          'duplicate', true);
      end if;
      if v_attempt = 6 then
        raise exception 'ORDER_NUMBER_EXHAUSTED';
      end if;
    end;
  end loop;

  insert into public.order_items
    (order_id, menu_item_id, item_code, item_name, quantity, unit_price, line_total, note)
  select v_order_id, (e->>'menu_item_id')::uuid, e->>'item_code', e->>'item_name',
         (e->>'quantity')::int, (e->>'unit_price')::numeric, (e->>'line_total')::numeric, null
    from jsonb_array_elements(v_resolved) e;

  -- Any failure anywhere above aborts the WHOLE function transaction —
  -- an order can never exist without its items.

  return jsonb_build_object(
    'order_number', v_order_number,
    'subtotal', v_subtotal,
    'delivery_fee', v_delivery_fee,
    'total', v_subtotal + v_delivery_fee,
    'duplicate', false);
end;
$$;

-- ── 3. Permissions — service_role ONLY ───────────────────────────────────────
-- Functions get EXECUTE for PUBLIC by default; strip it. The browser (anon)
-- must never be able to call this RPC.

revoke execute on function public.create_order_with_items(
  text, text, text, text, text, text, text, text, jsonb) from public;
revoke execute on function public.create_order_with_items(
  text, text, text, text, text, text, text, text, jsonb) from anon;
revoke execute on function public.create_order_with_items(
  text, text, text, text, text, text, text, text, jsonb) from authenticated;
grant execute on function public.create_order_with_items(
  text, text, text, text, text, text, text, text, jsonb) to service_role;

-- Make PostgREST pick up the new function immediately.
notify pgrst, 'reload schema';

-- ── 4. Verification (run after; read-only) ──────────────────────────────────

-- a) Column + partial unique index exist:
select column_name, data_type, is_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'orders'
    and column_name = 'client_request_id';
select indexname, indexdef from pg_indexes
  where schemaname = 'public' and tablename = 'orders'
    and indexname = 'orders_client_request_id_key';

-- b) Function exists, SECURITY INVOKER, pinned search_path:
select proname, prosecdef as is_security_definer, proconfig
  from pg_proc
  where pronamespace = 'public'::regnamespace
    and proname = 'create_order_with_items';

-- c) EXECUTE only for service_role — expect NO anon/authenticated/PUBLIC:
select grantee, privilege_type
  from information_schema.routine_privileges
  where routine_schema = 'public'
    and routine_name = 'create_order_with_items';

-- d) Anon still has NO write grants on orders/order_items — expect 0 rows:
select table_name, privilege_type
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in ('orders', 'order_items')
    and grantee = 'anon'
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE');

-- e) OPTIONAL dry run (creates a real test order — cancel/delete it after):
-- select public.create_order_with_items(
--   'staff', 'sql-editor-test-0001', 'dine_in', '99',
--   null, null, null, 'SQL editor dry run — delete me',
--   '[{"item_code":"A01","quantity":1}]'::jsonb);
-- Repeat the exact same call: expect the SAME order_number with
-- "duplicate": true. Clean up:
-- delete from public.order_items where order_id in
--   (select id from public.orders where client_request_id = 'sql-editor-test-0001');
-- delete from public.orders where client_request_id = 'sql-editor-test-0001';

-- ── 5. ROLLBACK (commented out — copy lines out to use) ─────────────────────
-- App rollback first: ORDER_INTAKE_SOURCE = "n8n" (one line), build, deploy.
-- The SQL below is only for removing the schema objects afterwards; they are
-- harmless to leave in place (the function simply goes uncalled).
--
-- drop function if exists public.create_order_with_items(
--   text, text, text, text, text, text, text, text, jsonb);
-- drop index if exists public.orders_client_request_id_key;
-- alter table public.orders drop column if exists client_request_id;
