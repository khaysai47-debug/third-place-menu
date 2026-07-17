-- ============================================================================
-- Pre-Pilot Security Hardening — remove anonymous reads of sensitive tables
-- (2026-07-17)
-- ============================================================================
-- REVIEW-FIRST MIGRATION: paste into the Supabase SQL Editor and run manually.
-- Never executed by any tool in this repo. Non-destructive to DATA: this file
-- only revokes grants and drops SELECT policies — no table, column, or row is
-- altered, deleted, or rewritten. Order logic is untouched.
--
-- WHY: during the Phase 2D/2E parity work, the anon role was granted SELECT
-- (with permissive USING (true) policies) on orders, order_items,
-- payment_proofs, and expenses so the dashboards could read Supabase from
-- the browser. That was enabled for testing, not decided for production
-- (schema-discovery-notes § Unknown/risky, runbook QA-4) — it makes customer
-- names/phones/addresses, payment proofs, and expense data readable by
-- anyone holding the anon key, WHICH SHIPS IN THE CLIENT BUNDLE. The app no
-- longer needs it: dashboard reads now go through the protected
-- /api/staff/orders and /api/staff/expenses routes (x-staff-secret,
-- service-role key server-side, explicit columns).
--
-- WHAT THIS PRESERVES:
-- - menu_items anon read (2G-H column-limited grant) — the public customer
--   menu. NOT TOUCHED here.
-- - service_role access — it bypasses RLS and keeps its default grants; the
--   app's server routes and every n8n workflow keep working unchanged.
-- - All write protections — anon never had write grants; nothing changes.
--
-- ⚠️ DEPLOYMENT ORDER: deploy the hardened app code (protected read routes +
-- frontend using them) BEFORE running this file. Old still-cached frontends
-- doing anon reads will break the moment this runs (empty/denied reads with
-- the dashboards' normal error UI) — deploy first, then run this, then
-- hard-refresh the staff/owner devices.
--
-- ⚠️ BEFORE RUNNING — record the current state for rollback fidelity
-- (the anon policies were created ad hoc in the SQL editor during 2D/2E QA,
-- so their exact names live only in the database):
--
--   select tablename, policyname, cmd, roles
--     from pg_policies
--     where schemaname = 'public'
--       and tablename in ('orders','order_items','payment_proofs','expenses');
--
--   select table_name, grantee, privilege_type
--     from information_schema.role_table_grants
--     where table_schema = 'public'
--       and table_name in ('orders','order_items','payment_proofs','expenses')
--       and grantee in ('anon', 'authenticated');
--
-- Save both outputs into the runbook notes before continuing.

-- ── 1. Revoke anonymous SELECT on the four sensitive tables ─────────────────
-- Revoking the GRANT alone already closes access (RLS requires grant AND
-- policy) — the policy drops in § 2 are belt and braces. authenticated is
-- revoked too: the app has no Supabase Auth users, so any such grant is
-- unused surface. Idempotent: revoking an absent grant is a no-op.

begin;

revoke select on public.orders from anon, authenticated;
revoke select on public.order_items from anon, authenticated;
revoke select on public.payment_proofs from anon, authenticated;
revoke select on public.expenses from anon, authenticated;

-- ── 2. Drop the permissive anon SELECT policies ──────────────────────────────
-- The QA policies were created ad hoc (names not recorded in the repo), so
-- they are looked up and dropped dynamically — ONLY policies on these four
-- tables that apply to anon directly or through PUBLIC (every role inherits
-- PUBLIC). Policies for other roles/tables are
-- untouched. If a policy listed anon alongside another role it is dropped
-- too (none is known to exist; the pre-run snapshot above is the record).

do $$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname
      from pg_policies
      where schemaname = 'public'
        and tablename in ('orders', 'order_items', 'payment_proofs', 'expenses')
        and roles::text[] && array['anon', 'public']::text[]
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

-- RLS stays ENABLED on all four tables (defense in depth for any future
-- accidental grant). Idempotent.
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payment_proofs enable row level security;
alter table public.expenses enable row level security;

commit;

-- Make PostgREST pick up the changed grants immediately.
notify pgrst, 'reload schema';

-- ── 3. Verification (run after; read-only) ──────────────────────────────────

-- a) No anon/authenticated SELECT grants remain on the four tables — expect 0 rows:
select table_name, grantee, privilege_type
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in ('orders', 'order_items', 'payment_proofs', 'expenses')
    and grantee in ('anon', 'authenticated')
    and privilege_type = 'SELECT';

-- b) No column-level anon/authenticated SELECT grants either — expect 0 rows:
select table_name, grantee, column_name
  from information_schema.column_privileges
  where table_schema = 'public'
    and table_name in ('orders', 'order_items', 'payment_proofs', 'expenses')
    and grantee in ('anon', 'authenticated')
    and privilege_type = 'SELECT';

-- c) No policies applicable to anon (directly or through PUBLIC) remain on
--    the four tables — expect 0 rows:
select tablename, policyname, roles
  from pg_policies
  where schemaname = 'public'
    and tablename in ('orders', 'order_items', 'payment_proofs', 'expenses')
    and roles::text[] && array['anon', 'public']::text[];

-- d) RLS still enabled on all four — expect 4 rows, all true:
select relname, relrowsecurity
  from pg_class
  where relnamespace = 'public'::regnamespace
    and relname in ('orders', 'order_items', 'payment_proofs', 'expenses');

-- e) PUBLIC MENU UNTOUCHED — menu_items anon grant still exactly the 2G-H
--    7 columns (item_code, name_en, category, price, is_available,
--    availability_status, sort_order) and its anon read policy still present:
select column_name, privilege_type
  from information_schema.column_privileges
  where table_schema = 'public' and table_name = 'menu_items'
    and grantee = 'anon'
  order by column_name;
select policyname, cmd, roles
  from pg_policies
  where schemaname = 'public' and tablename = 'menu_items';

-- f) LIVE PROBES (from any terminal — uses only the PUBLIC anon key, never
--    paste the service key):
--    - anon read of orders must now FAIL or return zero rows:
--        curl -s "https://<project>.supabase.co/rest/v1/orders?select=order_number&limit=1" \
--          -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <ANON_KEY>"
--      expected: 401/403/permission error (NOT a row).
--    - anon read of menu_items must still WORK:
--        curl -s "https://<project>.supabase.co/rest/v1/menu_items?select=item_code,name_en&limit=1" \
--          -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <ANON_KEY>"
--      expected: 200 with one menu row.
--    - the deployed dashboards still load through /api/staff/* with the
--      staff secret entered (and show the access gate without it).

-- ── 4. ROLLBACK (commented out — copy lines out to use) ─────────────────────
-- Full rollback = FIRST revert/redeploy the app branch (frontend returns to
-- anon reads), THEN restore access below. Restoring access without the app
-- rollback is harmless but pointless (nothing uses it).
-- The recreated policies use canonical names; the ad-hoc originals may have
-- differed (see the pre-run snapshot you saved) — behavior is identical
-- (permissive SELECT USING (true) for anon).
--
-- begin;
-- create policy "orders anon read"         on public.orders         for select to anon using (true);
-- create policy "order_items anon read"    on public.order_items    for select to anon using (true);
-- create policy "payment_proofs anon read" on public.payment_proofs for select to anon using (true);
-- create policy "expenses anon read"       on public.expenses       for select to anon using (true);
-- grant select on public.orders         to anon;
-- grant select on public.order_items    to anon;
-- grant select on public.payment_proofs to anon;
-- grant select on public.expenses       to anon;
-- commit;
-- notify pgrst, 'reload schema';
--
-- (authenticated grants are NOT restored — none were relied on.)
