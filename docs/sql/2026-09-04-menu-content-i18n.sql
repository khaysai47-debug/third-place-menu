-- ============================================================================
-- Menu content + EN/MY/TH localisation on menu_items (2026-09-04)
-- ============================================================================
-- REVIEW-FIRST MIGRATION: paste into the Supabase SQL Editor and run manually.
-- Never executed by any tool in this repo.
--
-- ORDER OF OPERATIONS — all three are review-first, run by a human:
--   1. docs/sql/2026-09-04-menu-content-preflight.sql   READ-ONLY. Run FIRST.
--      Take its § 1 before-image and keep it. Do not continue if it reports a
--      missing or duplicate item_code.
--   2. THIS FILE.                                       Schema + grant.
--   3. docs/sql/2026-09-04-menu-content-seed.sql        Fills blanks only.
--
-- WHY: item names, descriptions, photos and portions live in src/data/menu.ts,
-- compiled into the bundle, so the restaurant cannot change its own menu
-- without a release. This moves that content into the table that already holds
-- price and availability, editable in the Supabase table editor, and adds the
-- Myanmar/Thai columns the customer language picker reads.
--
-- ⚠️ THE GRANT IS PART OF THE MIGRATION, NOT A FOLLOW-UP. anon has a
-- COLUMN-LIMITED select grant (2026-07-14-2G-H § 2). A new column that is not
-- added to it is invisible to the customer menu — PostgREST answers 400 for
-- the column list, not a partial row. § 1 therefore adds the columns, replaces
-- the constraint and re-issues the grant in ONE transaction: if any part
-- fails, all of it rolls back and the database is left exactly as it was.
-- Schema applied with a stale grant is the one outcome this must not produce.
--
-- SAFE TO RUN BEFORE THE APP SHIPS. The read path asks for the content columns
-- FIRST and steps down to the current column list when they do not exist, so
-- either order works: migrate then deploy, or deploy then migrate.

-- ── 1. Schema, constraint and grant — ONE transaction ───────────────────────

begin;

alter table public.menu_items
  add column if not exists name_my        text,
  add column if not exists name_th        text,
  add column if not exists description_en text,
  add column if not exists description_my text,
  add column if not exists description_th text,
  add column if not exists image_url      text,
  add column if not exists unit           text;

-- All nullable with no default: an empty column means "not translated", which
-- the app already treats as "fall back to English", and a blank string is
-- treated the same as NULL (src/lib/menuContent.ts). Nothing here can make a
-- row render worse than it does today.

-- image_url is rendered in an <img src>. The app validates it too
-- (approvedImageUrl: https only, no credentials, bounded), but a CHECK keeps
-- an operator from pasting a javascript: or http: URL into the table editor in
-- the first place. NULL stays allowed — that is "no photo".
alter table public.menu_items
  drop constraint if exists menu_items_image_url_https;
alter table public.menu_items
  add constraint menu_items_image_url_https
  check (image_url is null or image_url ~ '^https://[^[:space:]]{1,2000}$');

comment on column public.menu_items.name_my is
  'Item name, Myanmar. NULL/blank = not translated; the app falls back to name_en.';
comment on column public.menu_items.name_th is
  'Item name, Thai. NULL/blank = not translated; the app falls back to name_en.';
comment on column public.menu_items.description_en is
  'Item description, English. NULL/blank = the compiled fallback in src/data/menu.ts is used.';
comment on column public.menu_items.image_url is
  'Public HTTPS image URL. NULL = the designed icon renders instead.';
comment on column public.menu_items.unit is
  'Portion wording shown on every card, e.g. "per skewer". Canonical English.';

-- Same security model as 2G-H: RLS on, all rows public (the menu IS public),
-- and anon may read ONLY these columns. Any future private column (cost,
-- supplier, audit) stays unreadable, and select=* is still rejected.
-- Writes are unchanged: anon has none, and the staff route + n8n keep their
-- own service credentials.
revoke select on public.menu_items from anon;
grant select (item_code, name_en, category, price, is_available,
              availability_status, sort_order,
              name_my, name_th, description_en, description_my, description_th,
              image_url, unit)
  on public.menu_items to anon;

commit;

-- ── 2. Verification: the EFFECTIVE read contract ────────────────────────────
-- Column-privilege rows prove what was granted. These prove what anon can
-- actually DO — which is the thing that matters, and the thing a stale policy,
-- an inherited PUBLIC grant or an RLS change would break without touching a
-- single grant row.

-- a) THE APP'S ACTUAL QUERY. Exactly the columns src/lib/menuAvailability.ts
--    selects, ordered the way it orders (sort_order is not selected but MUST
--    be readable for the ORDER BY). Expect rows, no error.
begin;
  set local role anon;
  select item_code, name_en, category, price, is_available, availability_status,
         name_my, name_th, description_en, description_my, description_th,
         image_url, unit
    from public.menu_items
    order by sort_order asc, item_code asc
    limit 5;
rollback;

-- b) ROW VISIBILITY under RLS. Expect the same number both times; a smaller
--    anon count means a policy is filtering the public menu.
select count(*) as rows_as_owner from public.menu_items;
begin;
  set local role anon;
  select count(*) as rows_as_anon from public.menu_items;
rollback;

-- c) PRIVATE COLUMNS STAY PRIVATE. Each of these must FAIL with a permission
--    error. If one succeeds, the grant is wider than intended.
begin;
  set local role anon;
  select * from public.menu_items limit 1;          -- expect: permission denied
rollback;
begin;
  set local role anon;
  select id from public.menu_items limit 1;         -- expect: permission denied
rollback;
begin;
  set local role anon;
  select created_at from public.menu_items limit 1; -- expect: permission denied
rollback;

-- d) NO ANONYMOUS WRITES. Each must FAIL.
begin;
  set local role anon;
  update public.menu_items set price = price;                      -- expect: denied
rollback;
begin;
  set local role anon;
  insert into public.menu_items (item_code) values ('__PREFLIGHT');-- expect: denied
rollback;
begin;
  set local role anon;
  delete from public.menu_items where false;                       -- expect: denied
rollback;

-- e) NO BROADER GRANT. Expect anon → SELECT only, and PUBLIC → no rows at all.
--    A PUBLIC grant would hand every role what anon has, bypassing the
--    column limit entirely.
select grantee, privilege_type
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'menu_items'
    and grantee in ('anon', 'PUBLIC', 'authenticated')
  order by grantee, privilege_type;

-- f) The column grant is exactly the 14 public columns. If this returns 7,
--    § 1 did not commit and the customer menu is falling back to its
--    compiled data.
select column_name, privilege_type
  from information_schema.column_privileges
  where table_schema = 'public' and table_name = 'menu_items'
    and grantee = 'anon'
  order by column_name;

-- g) Columns exist and are nullable — expect 7 rows, is_nullable YES:
select column_name, data_type, is_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'menu_items'
    and column_name in ('name_my','name_th','description_en','description_my',
                        'description_th','image_url','unit')
  order by column_name;

-- h) Nothing was lost — compare with the preflight's § 1 before-image:
select count(*) as items,
       count(*) filter (where availability_status = 'available') as available,
       count(*) filter (where availability_status = 'sold_out')  as sold_out,
       count(*) filter (where availability_status = 'hidden')    as hidden
  from public.menu_items;

-- i) The image CHECK rejects what it should — expect ERROR, then rollback:
-- begin;
--   update public.menu_items set image_url = 'javascript:alert(1)'
--     where item_code = (select item_code from public.menu_items limit 1);
-- rollback;

-- ── 3. Undoing this ─────────────────────────────────────────────────────────
-- SCHEMA rollback only. There is deliberately NO statement here that blanks
-- content columns: after the owner has edited one, a seeded value and a
-- hand-typed one are indistinguishable, and clearing them would destroy the
-- restaurant's own wording.
--
-- Export the content FIRST (the preflight's § 1 note gives the query), then:
--
-- begin;
-- alter table public.menu_items
--   drop constraint if exists menu_items_image_url_https,
--   drop column if exists name_my,
--   drop column if exists name_th,
--   drop column if exists description_en,
--   drop column if exists description_my,
--   drop column if exists description_th,
--   drop column if exists image_url,
--   drop column if exists unit;
-- revoke select on public.menu_items from anon;
-- grant select (item_code, name_en, category, price, is_available,
--               availability_status, sort_order)
--   on public.menu_items to anon;
-- commit;
--
-- The grant is re-issued in the SAME transaction for the same reason it was
-- applied in one: dropping the columns without narrowing the grant leaves anon
-- selecting columns that no longer exist, and every read fails.
--
-- The app needs no rollback of its own: with the columns gone the read steps
-- down a tier and the compiled menu answers for content again.

-- ── 4. Menu photos: Storage bucket (prepare only, not part of § 1) ──────────
-- Not needed until the owner supplies photos, and NOT created by this file.
-- When it is time, in the Supabase dashboard:
--   1. Storage → New bucket → name "menu-photos", PUBLIC.
--      Public because image_url is fetched by every customer's browser with no
--      session, exactly like the menu itself. Nothing private goes in it.
--   2. Leave the default policies: public read, no anon write. Uploads happen
--      through the dashboard during onboarding — this repo builds no upload UI.
--   3. Paste each object's public URL into menu_items.image_url. It must be
--      https (§ 1's CHECK enforces that) and it is validated again in the app.
-- A missing or broken URL is not an error state: the card falls back to the
-- designed icon, which is what every card shows today.
