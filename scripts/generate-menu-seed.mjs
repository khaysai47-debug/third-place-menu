// Generates the two review-first SQL artifacts that depend on the compiled
// menu, from src/data/menu.ts:
//
//   docs/sql/2026-09-04-menu-content-preflight.sql   (read-only, run FIRST)
//   docs/sql/2026-09-04-menu-content-seed.sql        (fills blanks only)
//
//   npm run seed:menu-sql
//
// It WRITES FILES. It does not connect to Supabase, and nothing in this repo
// executes the SQL it produces — a human pastes it into the SQL editor, in
// order, exactly like every other migration here.
//
// The seed is a TRUE no-op on a second run: it only touches rows where at
// least one target column is blank AND has a value to receive, and it never
// rewrites a non-blank value — not even to trim it. Trimming is used ONLY to
// decide blankness; the owner's own text is preserved byte for byte.

import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const outDir = "node_modules/.cache/menu-seed";
execSync(
  `npx tsc src/data/menu.ts --outDir ${outDir}` +
    " --module nodenext --moduleResolution nodenext --target es2022" +
    " --lib es2022,dom --skipLibCheck",
  { stdio: "inherit" },
);
writeFileSync(path.join(outDir, "package.json"), '{"type":"module"}\n');
const { MENU } = await import(pathToFileURL(path.resolve(outDir, "menu.js")).href);

/** A SQL string literal, or a TYPED null. Blank is null: the app treats an
 *  empty translation as absent, and the database should agree.
 *
 *  `NULL::text` rather than bare NULL so a column that is null in every row —
 *  name_th and description_th are, today — still resolves to text in the
 *  VALUES list instead of Postgres refusing to infer a type. */
const lit = (value) => {
  const text = typeof value === "string" ? value.trim() : "";
  return text === "" ? "NULL::text" : `'${text.replace(/'/g, "''")}'`;
};

/** column ⇢ the compiled field it is seeded from. */
const COLUMNS = [
  ["description_en", (i) => i.descriptionEn],
  ["description_my", (i) => i.descriptionMy],
  ["description_th", (i) => i.descriptionTh],
  ["name_my", (i) => i.nameMy],
  ["name_th", (i) => i.nameTh],
  ["unit", (i) => i.unit],
];

const rows = MENU.map(
  (item) => `    (${[lit(item.id), ...COLUMNS.map(([, read]) => lit(read(item)))].join(", ")})`,
);
const codeRows = MENU.map((item) => `    (${lit(item.id)})`);

/** "keep what is there, byte for byte, unless it is blank". BTRIM appears
 *  only inside the blankness TEST — never around a value being written. */
const setClause = COLUMNS.map(
  ([col]) =>
    `  ${col.padEnd(14)} = case when btrim(coalesce(m.${col}, '')) <> '' then m.${col} else v.${col} end`,
).join(",\n");

/** A row is worth touching only if some column is blank AND has something to
 *  receive. This is what makes a second identical run report UPDATE 0. */
const changeGuard = COLUMNS.map(
  ([col]) => `      (btrim(coalesce(m.${col}, '')) = '' and v.${col} is not null)`,
).join("\n      or\n");

const columnNames = COLUMNS.map(([c]) => c);
const today = new Date().toISOString().slice(0, 10);

/* ── Preflight ─────────────────────────────────────────────────────────── */

const preflight = `-- ============================================================================
-- Menu content PREFLIGHT — read-only (generated ${today})
-- ============================================================================
-- GENERATED FILE. Produced by scripts/generate-menu-seed.mjs.
--
-- RUN THIS FIRST, BEFORE THE MIGRATION, AND READ THE OUTPUT.
-- It mutates nothing. Every query below is a SELECT.
--
-- STOP AND DO NOT MIGRATE IF:
--   § 2 does not report exactly ${MENU.length} expected codes present, or
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
-- Expect: expected_codes = ${MENU.length}, present = ${MENU.length}, missing = 0.
with expected(item_code) as (
  values
${codeRows.join(",\n")}
)
select (select count(*) from expected)                                as expected_codes,
       count(m.item_code)                                             as present,
       (select count(*) from expected) - count(m.item_code)           as missing
  from expected e
  left join public.menu_items m on m.item_code = e.item_code;

-- ── 3. MISSING codes — expect zero rows ─────────────────────────────────────
with expected(item_code) as (
  values
${codeRows.join(",\n")}
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
${codeRows.join(",\n")}
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
-- change: an updated_at stamp or an audit row would fire on all ${MENU.length}
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
`;

/* ── Seed ──────────────────────────────────────────────────────────────── */

const seed = `-- ============================================================================
-- Menu content seed — ${MENU.length} items (generated ${today})
-- ============================================================================
-- GENERATED FILE. Produced by scripts/generate-menu-seed.mjs from
-- src/data/menu.ts; regenerate rather than editing by hand.
--
-- REVIEW-FIRST: paste into the Supabase SQL Editor and run manually, AFTER
-- the preflight has passed and 2026-09-04-menu-content-i18n.sql has added the
-- columns. Nothing in this repo executes it.
--
-- WHAT IT DOES: fills the new content columns for rows that do not have that
-- value yet, matched on item_code.
--
-- WHAT IT CANNOT DO:
--   - REWRITE ANYTHING NON-BLANK. Each column is written as
--     "keep m.<col> when it is not blank, else the seed". BTRIM appears only
--     in the blankness TEST, never around a value being stored, so an owner's
--     leading or trailing spacing survives byte for byte;
--   - TOUCH A ROW IT WOULD NOT CHANGE. The WHERE clause requires some column
--     to be blank AND to have a value waiting, so a second identical run
--     reports UPDATE 0 and no row-level trigger fires;
--   - insert or delete a row. A code that is not already in the table is
--     reported by the preflight and ignored here;
--   - touch name_en, price, category, availability_status, is_available or
--     sort_order. Those are operational and out of scope.
--
-- Myanmar names are DRAFT — src/data/menu.ts records that the spelling needs
-- native confirmation. Thai is absent everywhere and seeds as NULL.

-- ── 1. Fill blank content columns ───────────────────────────────────────────

begin;

update public.menu_items as m set
${setClause}
from (
  values
${rows.join(",\n")}
) as v(item_code, ${columnNames.join(", ")})
where m.item_code = v.item_code
  and (
${changeGuard}
  );

commit;

-- ── 2. Verification (read-only) ─────────────────────────────────────────────

-- a) THE NO-OP PROOF. Re-run § 1 exactly as it stands. It must report
--    "UPDATE 0". If it reports anything else, something is rewriting values
--    and the change guard is not doing its job — stop and investigate.
--    The same query, as a dry count that touches nothing:
select count(*) as rows_that_would_change
  from public.menu_items m
  join (
    values
${rows.join(",\n")}
  ) as v(item_code, ${columnNames.join(", ")}) on m.item_code = v.item_code
  where
${changeGuard};
-- Expect ${MENU.length} before the first run and 0 after it.

-- b) Coverage:
select count(*) as items,
       count(*) filter (where nullif(btrim(description_en), '') is not null) as with_en_description,
       count(*) filter (where nullif(btrim(name_my), '')        is not null) as with_my_name,
       count(*) filter (where nullif(btrim(name_th), '')        is not null) as with_th_name,
       count(*) filter (where nullif(btrim(unit), '')           is not null) as with_unit,
       count(*) filter (where image_url is not null)                         as with_photo
  from public.menu_items;
-- Expect with_my_name >= ${MENU.filter((i) => i.nameMy).length}, with_th_name = 0,
-- with_photo = 0 until onboarding supplies them.

-- c) Operational columns untouched — compare against the preflight's § 1
--    before-image. Every row must match on all six:
select item_code, name_en, category, price, is_available, availability_status, sort_order
  from public.menu_items
  order by sort_order asc, item_code asc;

-- ── 3. Restoration ──────────────────────────────────────────────────────────
-- There is deliberately NO blanket rollback here. Blanking the content columns
-- would destroy the owner's own wording along with anything seeded, and after
-- the first edit the two are indistinguishable.
--
-- Restore from the before-image exported in the preflight's § 1, one column at
-- a time, e.g. for description_en:
--
--   begin;
--   update public.menu_items as m
--      set description_en = b.description_en
--     from (values ('A01', 'the exported text'), ...) as b(item_code, description_en)
--    where m.item_code = b.item_code;
--   commit;
--
-- If no before-image was taken, there is nothing to restore to — which is why
-- the preflight puts it first.
`;

mkdirSync("docs/sql", { recursive: true });
writeFileSync("docs/sql/2026-09-04-menu-content-preflight.sql", preflight, "utf8");
writeFileSync("docs/sql/2026-09-04-menu-content-seed.sql", seed, "utf8");
console.log(`wrote preflight + seed — ${MENU.length} items, ${COLUMNS.length} content columns`);
