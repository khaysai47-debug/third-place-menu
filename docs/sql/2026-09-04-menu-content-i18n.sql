-- ============================================================================
-- Menu content + EN/MY/TH localisation on menu_items (2026-09-04)
-- ============================================================================
-- REVIEW-FIRST MIGRATION: paste into the Supabase SQL Editor and run manually.
-- Never executed by any tool in this repo. Non-destructive: it ADDS nullable
-- columns and re-issues the anon column grant. No row is written, no existing
-- column is altered or dropped, and availability data is untouched.
--
-- WHY: item names, descriptions, photos and portions live in src/data/menu.ts,
-- compiled into the bundle, so the restaurant cannot change its own menu
-- without a release. This moves that content into the table that already holds
-- price and availability, editable in the Supabase table editor, and adds the
-- Myanmar/Thai columns the customer language picker reads.
--
-- ⚠️ THE GRANT IS LOAD-BEARING. anon has a COLUMN-LIMITED select grant
-- (2026-07-14-2G-H § 2). A new column that is not added to it is invisible to
-- the customer menu — PostgREST answers 400 for the column list, not a partial
-- row. § 2 below re-issues the full grant; do not skip it.
--
-- SAFE TO RUN BEFORE THE APP SHIPS. The read path asks for the content columns
-- FIRST and steps down to the current column list when they do not exist, so
-- either order works: migrate then deploy, or deploy then migrate.

-- ── 1. Columns ──────────────────────────────────────────────────────────────
-- All nullable with no default: an empty column means "not translated", which
-- the app already treats as "fall back to English", and a blank string is
-- treated the same as NULL (src/lib/menuContent.ts). Nothing here can make a
-- row render worse than it does today.

begin;

alter table public.menu_items
  add column if not exists name_my        text,
  add column if not exists name_th        text,
  add column if not exists description_en text,
  add column if not exists description_my text,
  add column if not exists description_th text,
  add column if not exists image_url      text,
  add column if not exists unit           text;

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

commit;

-- ── 2. Re-issue the column-limited anon grant ───────────────────────────────
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

-- ── 3. Verification (run after; read-only) ──────────────────────────────────

-- a) All seven columns exist and are nullable — expect 7 rows, is_nullable YES:
select column_name, data_type, is_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'menu_items'
    and column_name in ('name_my','name_th','description_en','description_my',
                        'description_th','image_url','unit')
  order by column_name;

-- b) The grant covers EXACTLY the 14 public columns — expect 14 rows, all
--    SELECT. If this returns 7, § 2 did not run and the customer menu will
--    fall back to its compiled data.
select column_name, privilege_type
  from information_schema.column_privileges
  where table_schema = 'public' and table_name = 'menu_items'
    and grantee = 'anon'
  order by column_name;

-- c) Nothing was lost — expect the same counts as before the migration:
select count(*) as items,
       count(*) filter (where availability_status = 'available') as available,
       count(*) filter (where availability_status = 'sold_out')  as sold_out,
       count(*) filter (where availability_status = 'hidden')    as hidden
  from public.menu_items;

-- d) The image CHECK rejects what it should — expect ERROR, then rollback:
-- begin;
--   update public.menu_items set image_url = 'javascript:alert(1)'
--     where item_code = (select item_code from public.menu_items limit 1);
-- rollback;

-- e) After seeding, how much content is actually in place:
select count(*) filter (where nullif(btrim(description_en), '') is not null) as with_en_description,
       count(*) filter (where nullif(btrim(name_my), '')        is not null) as with_my_name,
       count(*) filter (where nullif(btrim(name_th), '')        is not null) as with_th_name,
       count(*) filter (where image_url is not null)                          as with_photo
  from public.menu_items;

-- ── 4. ROLLBACK (commented out — copy lines out to use) ─────────────────────
-- Dropping the columns DISCARDS every translation, description, portion and
-- photo URL entered since the migration. Export them first:
--   select item_code, name_my, name_th, description_en, description_my,
--          description_th, image_url, unit
--     from public.menu_items order by item_code;
--
-- The app needs NO rollback of its own: with the columns gone the read steps
-- down a tier and the compiled menu answers for content again.
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
-- commit;
--
-- ⚠️ Then RE-ISSUE the narrower grant, or anon reads start failing:
-- revoke select on public.menu_items from anon;
-- grant select (item_code, name_en, category, price, is_available,
--               availability_status, sort_order)
--   on public.menu_items to anon;

-- ── 5. Menu photos: Storage bucket (prepare only, not part of § 1) ──────────
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
