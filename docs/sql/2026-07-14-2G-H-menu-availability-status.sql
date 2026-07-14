-- ============================================================================
-- Phase 2G-H — menu_items 3-state availability (2026-07-14)
-- ============================================================================
-- REVIEW-FIRST MIGRATION: paste into the Supabase SQL Editor and run manually.
-- Never executed by any tool in this repo. Non-destructive: adds one column
-- and one read policy; is_available is NOT removed (retires in Phase 2H).
--
-- WHY: the app has three menu states (Available / Sold Out / Hidden) but the
-- DB has only the is_available boolean — Hidden cannot round-trip and comes
-- back as Sold Out. availability_status (text + CHECK, deliberately not an
-- enum type so extending later needs no type migration) becomes the source
-- of truth; the app's server route dual-writes both columns during the
-- transition so n8n workflows and old readers keep working.
--
-- ⚠️ HIDDEN-HISTORY LIMITATION: rows that were Hidden before this migration
-- are stored as is_available=false — indistinguishable from Sold Out. The
-- backfill maps them to 'sold_out'. Previously-hidden items MUST be re-marked
-- Hidden by hand (one-time manual review) after the migration.

-- ── 1. Schema change + backfill (one transaction) ───────────────────────────

begin;

alter table public.menu_items
  add column availability_status text
  constraint menu_items_availability_status_check
  check (availability_status in ('available', 'sold_out', 'hidden'));

-- Backfill from the boolean: true→available, false→sold_out. 'hidden' is
-- intentionally never produced here (see limitation above).
update public.menu_items
  set availability_status = case when is_available then 'available' else 'sold_out' end;

-- Only after the backfill: default for future inserts + NOT NULL. Doing this
-- AFTER the UPDATE (instead of ADD COLUMN ... DEFAULT) means no existing row
-- ever transits through a wrong 'available' default.
alter table public.menu_items
  alter column availability_status set default 'available',
  alter column availability_status set not null;

commit;

-- ── 2. Customer-menu read access (plan R1) — COLUMN-LIMITED ─────────────────
-- The app reads menu_items directly with the anon key (the menu is
-- public-by-nature data). Security model, two layers:
--   ROWS:    RLS stays ENABLED; the SELECT policy allows all rows (every
--            menu row is public — Hidden is a display state, not a secret;
--            the frontend requests it to filter/manage).
--   COLUMNS: a COLUMN-LIMITED grant — anon can read ONLY the public menu
--            columns listed below. Any internal/cost/audit/future private
--            column is unreadable by design; select=* from the anon key is
--            REJECTED by Postgres, not silently served.
-- Writes: anon has NO insert/update/delete grant at all — every write goes
-- through the app's server route (x-staff-secret + service-role key, which
-- bypasses RLS). n8n likewise uses its own service credentials — unaffected.
-- Without the policy PostgREST returns 200 with ZERO rows (the "expenses
-- lesson") — not an error.
-- sort_order is granted (needed for ORDER BY) though the app doesn't
-- display it; id/created_at/etc. are deliberately NOT granted.

alter table public.menu_items enable row level security;

drop policy if exists "menu_items anon read" on public.menu_items;
create policy "menu_items anon read"
  on public.menu_items for select to anon using (true);

-- Idempotent: clear any broader grant, then grant only the public columns.
revoke select on public.menu_items from anon;
grant select (item_code, name_en, category, price, is_available,
              availability_status, sort_order)
  on public.menu_items to anon;

-- ── 3. Verification (run after; read-only) ──────────────────────────────────

-- a) Column + constraint exist:
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
  where table_schema = 'public' and table_name = 'menu_items'
    and column_name in ('availability_status', 'is_available');

-- b) Backfill correctness — expect ONLY ('available', true) and
--    ('sold_out', false); zero 'hidden' rows immediately after backfill:
select availability_status, is_available, count(*)
  from public.menu_items
  group by 1, 2
  order by 1, 2;

-- c) Columns in sync — expect 0 rows:
select item_code, name_en, availability_status, is_available
  from public.menu_items
  where (availability_status = 'available') <> is_available;

-- d) Anon read policy present — expect 1 row:
select policyname, cmd, roles
  from pg_policies
  where schemaname = 'public' and tablename = 'menu_items';

-- e) Column-limited grant — expect EXACTLY these 7 columns for anon, and
--    only SELECT: item_code, name_en, category, price, is_available,
--    availability_status, sort_order.
select column_name, privilege_type
  from information_schema.column_privileges
  where table_schema = 'public' and table_name = 'menu_items'
    and grantee = 'anon'
  order by column_name;

-- ── 4. ROLLBACK (commented out — copy lines out to use) ─────────────────────
-- ⚠️ Dropping the column DISCARDS every 'hidden' status set since the
-- migration (they collapse back to is_available=false = Sold Out). Before
-- running, save them:
--   select item_code, name_en from public.menu_items
--     where availability_status = 'hidden';
--
-- begin;
-- alter table public.menu_items drop column availability_status;
-- commit;
--
-- Only if the anon read access must ALSO be rolled back (this re-breaks the
-- Supabase customer-menu read — flip MENU_AVAILABILITY_SOURCE to "n8n" first):
-- drop policy if exists "menu_items anon read" on public.menu_items;
-- revoke select on public.menu_items from anon;  -- removes the column grants
--
-- NOTE: if only the column rollback (§ 4 drop column) is run, re-issue the
-- column grant WITHOUT availability_status, or anon reads start failing:
-- revoke select on public.menu_items from anon;
-- grant select (item_code, name_en, category, price, is_available, sort_order)
--   on public.menu_items to anon;

-- ── 5. Re-sync after an n8n-write rollback period ───────────────────────────
-- n8n writes only is_available, so availability_status goes stale while
-- writes are rolled back to n8n. Before flipping forward again, re-run:
--   (⚠️ this also collapses any hidden set during the rollback → sold_out;
--    save hidden item codes first, as in § 4)
-- update public.menu_items
--   set availability_status = case when is_available then 'available' else 'sold_out' end
--   where (availability_status = 'available') <> is_available;
