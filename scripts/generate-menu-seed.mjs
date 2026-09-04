// Generates docs/sql/2026-09-04-menu-content-seed.sql from src/data/menu.ts.
//
//   npm run seed:menu-sql
//
// It WRITES A FILE. It does not connect to Supabase, and nothing in this repo
// executes the SQL it produces — a human pastes it into the SQL editor after
// the column migration, exactly like every other migration here.
//
// The generated statement is:
//   - IDEMPOTENT — running it twice changes nothing the second time;
//   - NON-DESTRUCTIVE — it only fills a column that is currently NULL or
//     blank, so an owner's own wording is never overwritten by the values
//     compiled into this repo;
//   - LIMITED to content: name_en, price, category, availability and
//     sort_order are operational columns and are not touched.

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

const COLUMNS = [
  "description_en",
  "description_my",
  "description_th",
  "name_my",
  "name_th",
  "unit",
];

const rows = MENU.map((item) =>
  [
    lit(item.id),
    lit(item.descriptionEn),
    lit(item.descriptionMy),
    lit(item.descriptionTh),
    lit(item.nameMy),
    lit(item.nameTh),
    lit(item.unit),
  ].join(", "),
);

const valuesBlock = rows.map((row) => `    (${row})`).join(",\n");

const sql = `-- ============================================================================
-- Menu content seed — ${MENU.length} items (generated ${new Date().toISOString().slice(0, 10)})
-- ============================================================================
-- GENERATED FILE. Produced by scripts/generate-menu-seed.mjs from
-- src/data/menu.ts; regenerate rather than editing by hand.
--
-- REVIEW-FIRST: paste into the Supabase SQL Editor and run manually, AFTER
-- 2026-09-04-menu-content-i18n.sql has added the columns. Nothing in this
-- repo executes it.
--
-- WHAT IT DOES: fills the new content columns for rows that do not have that
-- value yet, matched on item_code.
--
-- WHAT IT CANNOT DO:
--   - overwrite a value an operator has already entered. Every column is
--     written as COALESCE(existing-if-non-blank, seed), so the owner's own
--     wording always wins and re-running is a no-op;
--   - insert or delete a row. An item_code that is not already in the table
--     is reported by § 2 and ignored — this seed does not decide what is on
--     the menu, it only fills in content for what already is;
--   - touch name_en, price, category, availability_status, is_available or
--     sort_order. Those are operational and out of scope here.
--
-- Myanmar names are DRAFT — src/data/menu.ts records that the spelling needs
-- native confirmation. Thai is absent everywhere and seeds as NULL.

-- ── 1. Fill blank content columns ───────────────────────────────────────────

begin;

update public.menu_items as m set
  description_en = coalesce(nullif(btrim(m.description_en), ''), v.description_en),
  description_my = coalesce(nullif(btrim(m.description_my), ''), v.description_my),
  description_th = coalesce(nullif(btrim(m.description_th), ''), v.description_th),
  name_my        = coalesce(nullif(btrim(m.name_my), ''),        v.name_my),
  name_th        = coalesce(nullif(btrim(m.name_th), ''),        v.name_th),
  unit           = coalesce(nullif(btrim(m.unit), ''),           v.unit)
from (
  values
${valuesBlock}
) as v(item_code, ${COLUMNS.join(", ")})
where m.item_code = v.item_code;

commit;

-- ── 2. Verification (read-only) ─────────────────────────────────────────────

-- a) Seed rows with no matching menu_items row — expect 0. Anything here is an
--    item this repo knows about that the table does not; investigate before
--    assuming the menu is complete.
select v.item_code
  from (values
${rows.map((row) => `    (${row.split(", ")[0]})`).join(",\n")}
  ) as v(item_code)
  left join public.menu_items m on m.item_code = v.item_code
  where m.item_code is null;

-- b) Coverage after seeding:
select count(*) as items,
       count(*) filter (where nullif(btrim(description_en), '') is not null) as with_en_description,
       count(*) filter (where nullif(btrim(name_my), '')        is not null) as with_my_name,
       count(*) filter (where nullif(btrim(name_th), '')        is not null) as with_th_name,
       count(*) filter (where nullif(btrim(unit), '')           is not null) as with_unit,
       count(*) filter (where image_url is not null)                         as with_photo
  from public.menu_items;
-- Expect with_my_name = ${MENU.filter((i) => i.nameMy).length}, with_th_name = 0,
-- with_photo = 0 until onboarding supplies them.

-- c) Re-running § 1 must report UPDATE 0 changes in effect — verify by
--    running it a second time and re-checking (b): the numbers do not move.

-- ── 3. Rollback ─────────────────────────────────────────────────────────────
-- This seed only ever filled blanks, so "undo" means blanking what it wrote.
-- There is no way to distinguish a seeded value from an identical hand-typed
-- one, so export first (see the column migration's § 4) and clear explicitly:
--
-- update public.menu_items set description_en = NULL, description_my = NULL,
--   description_th = NULL, name_my = NULL, name_th = NULL, unit = NULL;
--
-- The customer menu keeps working: content falls back to src/data/menu.ts.
`;

mkdirSync("docs/sql", { recursive: true });
const target = "docs/sql/2026-09-04-menu-content-seed.sql";
writeFileSync(target, sql, "utf8");
console.log(`wrote ${target} — ${MENU.length} items, ${COLUMNS.length} content columns`);
