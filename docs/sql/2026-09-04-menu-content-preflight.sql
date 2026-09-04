-- ============================================================================
-- Menu content PREFLIGHT — read-only (generated 2026-09-04)
-- ============================================================================
-- GENERATED FILE. Produced by scripts/generate-menu-seed.mjs.
--
-- RUN THIS FIRST, BEFORE THE MIGRATION, AND READ THE OUTPUT.
-- It mutates nothing. Every query below is a SELECT.
--
-- STOP AND DO NOT MIGRATE IF:
--   § 2 does not report exactly 38 expected codes present, or
--   § 3 lists any MISSING code, or
--   § 4 lists any DUPLICATE code.
-- Extra codes (§ 5) are for human review, not an automatic stop: the table may
-- legitimately carry items this repo does not know about.
--
-- NOTHING HERE INSERTS A MISSING ROW. For this pilot the seed never creates
-- menu items — if a code is missing, a human decides what that means.

-- ── 1. Before-image. TAKE THIS FIRST AND KEEP IT. ───────────────────────────
-- Export the result and save it outside the database. It is the ONLY basis
-- for restoring content if anything later goes wrong; there is deliberately no
-- blanket "clear the columns" rollback, because that would destroy the owner's
-- own wording along with the seeded values.
select item_code, name_en, category, price, is_available, availability_status, sort_order
  from public.menu_items
  order by sort_order asc, item_code asc;
-- After the migration adds them, re-export including the content columns:
--   select item_code, name_en, name_my, name_th, description_en, description_my,
--          description_th, image_url, unit
--     from public.menu_items order by item_code;

-- ── 2. Expected-code coverage ───────────────────────────────────────────────
-- Expect: expected_codes = 38, present = 38, missing = 0.
with expected(item_code) as (
  values
    ('A01'),
    ('A02'),
    ('A03'),
    ('A04'),
    ('A05'),
    ('A06'),
    ('A07'),
    ('A08'),
    ('A09'),
    ('A10'),
    ('A11'),
    ('A12'),
    ('A13'),
    ('A15'),
    ('A16'),
    ('A17'),
    ('A19'),
    ('A20'),
    ('A21'),
    ('A22'),
    ('A14'),
    ('A18'),
    ('A23'),
    ('A24'),
    ('A25'),
    ('A26'),
    ('A27'),
    ('B01'),
    ('B02'),
    ('B03'),
    ('B04'),
    ('B05'),
    ('B06'),
    ('B07'),
    ('B08'),
    ('B09'),
    ('B10'),
    ('B11')
)
select (select count(*) from expected)                                as expected_codes,
       count(m.item_code)                                             as present,
       (select count(*) from expected) - count(m.item_code)           as missing
  from expected e
  left join public.menu_items m on m.item_code = e.item_code;

-- ── 3. MISSING codes — expect zero rows ─────────────────────────────────────
with expected(item_code) as (
  values
    ('A01'),
    ('A02'),
    ('A03'),
    ('A04'),
    ('A05'),
    ('A06'),
    ('A07'),
    ('A08'),
    ('A09'),
    ('A10'),
    ('A11'),
    ('A12'),
    ('A13'),
    ('A15'),
    ('A16'),
    ('A17'),
    ('A19'),
    ('A20'),
    ('A21'),
    ('A22'),
    ('A14'),
    ('A18'),
    ('A23'),
    ('A24'),
    ('A25'),
    ('A26'),
    ('A27'),
    ('B01'),
    ('B02'),
    ('B03'),
    ('B04'),
    ('B05'),
    ('B06'),
    ('B07'),
    ('B08'),
    ('B09'),
    ('B10'),
    ('B11')
)
select e.item_code as missing_item_code
  from expected e
  left join public.menu_items m on m.item_code = e.item_code
  where m.item_code is null
  order by 1;

-- ── 4. DUPLICATE codes — expect zero rows ───────────────────────────────────
-- "exactly once" is the contract: item_code is the operational identity every
-- integration keys on, and two rows sharing one would make pricing ambiguous.
select item_code, count(*) as occurrences
  from public.menu_items
  group by item_code
  having count(*) > 1
  order by 1;

-- ── 5. EXTRA codes — review, do not assume ──────────────────────────────────
-- Rows the table has and this repo does not. They are NOT rendered to
-- customers (the customer menu starts from the compiled list), and the seed
-- ignores them. Confirm each is intentional.
with expected(item_code) as (
  values
    ('A01'),
    ('A02'),
    ('A03'),
    ('A04'),
    ('A05'),
    ('A06'),
    ('A07'),
    ('A08'),
    ('A09'),
    ('A10'),
    ('A11'),
    ('A12'),
    ('A13'),
    ('A15'),
    ('A16'),
    ('A17'),
    ('A19'),
    ('A20'),
    ('A21'),
    ('A22'),
    ('A14'),
    ('A18'),
    ('A23'),
    ('A24'),
    ('A25'),
    ('A26'),
    ('A27'),
    ('B01'),
    ('B02'),
    ('B03'),
    ('B04'),
    ('B05'),
    ('B06'),
    ('B07'),
    ('B08'),
    ('B09'),
    ('B10'),
    ('B11')
)
select m.item_code, m.name_en, m.availability_status
  from public.menu_items m
  left join expected e on e.item_code = m.item_code
  where e.item_code is null
  order by 1;

-- ── 6. Schema as it stands ──────────────────────────────────────────────────
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
  where table_schema = 'public' and table_name = 'menu_items'
  order by ordinal_position;

-- ── 7. Constraints ──────────────────────────────────────────────────────────
select conname, contype, pg_get_constraintdef(oid) as definition
  from pg_constraint
  where conrelid = 'public.menu_items'::regclass
  order by conname;

-- ── 8. Triggers ─────────────────────────────────────────────────────────────
-- A row-level UPDATE trigger is why the seed must not touch rows it does not
-- change: an updated_at stamp or an audit row would fire on all 38
-- items every run.
select tgname, tgenabled, pg_get_triggerdef(oid) as definition
  from pg_trigger
  where tgrelid = 'public.menu_items'::regclass and not tgisinternal
  order by tgname;

-- ── 9. RLS and policies ─────────────────────────────────────────────────────
select relrowsecurity as rls_enabled, relforcerowsecurity as rls_forced
  from pg_class where oid = 'public.menu_items'::regclass;

select policyname, cmd, permissive, roles, qual, with_check
  from pg_policies
  where schemaname = 'public' and tablename = 'menu_items'
  order by policyname;

-- ── 10. Grants as they stand ────────────────────────────────────────────────
-- Table-level grants for anon and PUBLIC. Anything beyond SELECT for anon, or
-- ANY grant to PUBLIC, is a finding: it would widen access past the
-- column-limited contract.
select grantee, privilege_type
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'menu_items'
    and grantee in ('anon', 'PUBLIC', 'authenticated')
  order by grantee, privilege_type;

select grantee, column_name, privilege_type
  from information_schema.column_privileges
  where table_schema = 'public' and table_name = 'menu_items'
    and grantee in ('anon', 'PUBLIC')
  order by grantee, column_name;
