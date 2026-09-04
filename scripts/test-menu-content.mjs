// MENU CONTENT + LOCALISED DISPLAY (no test framework — `npm run test:menu-content`).
//
// The property this file exists to protect: a customer can read the menu in
// Myanmar or Thai, and NOTHING they submit changes because of it. The item
// code, the canonical English name and the price are the same in all three
// languages, because those are what the intake route and the n8n rollback
// path recognise.
//
// Also asserted: the compiled menu answers when the database cannot, blank
// database columns behave as missing, and a bad or absent photo URL leaves
// the card exactly as it looks today.

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// COMMONJS on purpose. menuContent.ts imports ./i18n and ../data/menu without
// file extensions — the style the rest of src/lib uses — and Node's ESM
// resolver requires them. Compiling to CJS lets require() resolve exactly as
// the bundler does, so the source stays idiomatic instead of being bent to
// suit its own test.
const outDir = "node_modules/.cache/menu-content-test";
execSync(
  `npx tsc src/lib/menuContent.ts src/data/menu.ts --outDir ${outDir}` +
    " --module commonjs --moduleResolution node10 --target es2022" +
    " --lib es2022,dom --skipLibCheck",
  { stdio: "inherit" },
);
writeFileSync(path.join(outDir, "package.json"), '{"type":"commonjs"}\n');

const require = createRequire(import.meta.url);
const load = (file) => require(path.resolve(outDir, file));
const { localizeMenuItem, localizeCategory, approvedImageUrl } = load("lib/menuContent.js");
const { MENU, CATEGORIES } = load("data/menu.js");

const menuScreenSource = readFileSync("src/components/menu/MenuScreen.tsx", "utf8");
const checkoutSource = readFileSync("src/components/menu/CheckoutSheet.tsx", "utf8");
const cardSource = readFileSync("src/components/menu/MenuItemCard.tsx", "utf8");
const readPathSource = readFileSync("src/lib/menuAvailability.ts", "utf8");

/** A compiled row shaped like the real ones. */
const item = (over = {}) => ({
  id: "A01",
  nameEn: "Beef",
  nameMy: "နွားသားကင်",
  category: "skewers",
  descriptionEn: "Tender beef skewers.",
  price: 100,
  unit: "x4 skewers",
  available: true,
  popular: false,
  order: 1,
  createdAt: "",
  updatedAt: "",
  ...over,
});

/* ── 1. Display selection per language ─────────────────────────────────── */

const withDb = {
  nameEn: "Beef Skewers",
  nameMy: "DB မြန်မာ",
  nameTh: "DB ไทย",
  descriptionEn: "DB english description.",
  descriptionMy: "DB မြန်မာ description",
  descriptionTh: "DB ไทย description",
  unit: "x4",
};

assert.equal(localizeMenuItem(item(), withDb, "en").displayName, "Beef Skewers");
assert.equal(localizeMenuItem(item(), withDb, "my").displayName, "DB မြန်မာ");
assert.equal(localizeMenuItem(item(), withDb, "th").displayName, "DB ไทย");
assert.equal(localizeMenuItem(item(), withDb, "my").description, "DB မြန်မာ description");
assert.equal(localizeMenuItem(item(), withDb, "th").description, "DB ไทย description");

// The database wins over the compiled row where it has a value.
assert.equal(
  localizeMenuItem(item(), withDb, "en").canonicalName,
  "Beef Skewers",
  "a name_en in the database replaces the compiled one",
);

/* ── 2. Fallback: blank, missing, and no database at all ───────────────── */

for (const [label, blank] of [
  ["empty string", ""],
  ["whitespace", "   "],
]) {
  const row = { ...withDb, nameMy: blank, descriptionMy: blank };
  const out = localizeMenuItem(item(), row, "my");
  assert.equal(
    out.displayName,
    "နွားသားကင်",
    `a ${label} name_my falls back to the compiled Myanmar`,
  );
  assert.equal(
    out.description,
    "DB english description.",
    `a ${label} description_my falls back through English`,
  );
}

// Nothing in the database for this language → compiled Myanmar, then English.
const onlyEnglishRow = { nameEn: "Beef Skewers", descriptionEn: "DB english description." };
assert.equal(localizeMenuItem(item(), onlyEnglishRow, "my").displayName, "နွားသားကင်");
assert.equal(
  localizeMenuItem(item(), onlyEnglishRow, "th").displayName,
  "Beef Skewers",
  "no Thai anywhere renders English, never blank",
);
assert.equal(
  localizeMenuItem(item({ nameMy: undefined }), undefined, "my").displayName,
  "Beef",
  "no database row and no compiled Myanmar still renders the English name",
);

// THE OUTAGE CASE: no content, no availability — the compiled row answers for
// everything and the item stays orderable.
const offline = localizeMenuItem(item(), undefined, "th");
assert.equal(offline.displayName, "Beef");
assert.equal(offline.description, "Tender beef skewers.");
assert.equal(offline.price, 100, "price survives a database outage");
assert.equal(
  offline.available,
  true,
  "an item does not become unorderable because the read failed",
);
assert.equal(offline.unit, "x4 skewers");

// And the screen keeps its live map null on failure, which is what makes the
// compiled menu the fallback rather than an empty list.
assert.ok(
  /catch \(error\) \{[\s\S]*?setAvailabilityWarning\(true\)/.test(menuScreenSource),
  "a failed availability read warns instead of clearing the menu",
);
assert.ok(
  !/setLive\(null\)|setLive\(\[\]\)/.test(menuScreenSource),
  "nothing empties the live map on error — the last good rows or null stand",
);
assert.ok(
  menuScreenSource.includes("MENU.flatMap((item) => {"),
  "the rendered menu is still driven by the compiled list, overlaid with live rows",
);

/* ── 3. Canonical identity and price are language-invariant ────────────── */

for (const source of [withDb, onlyEnglishRow, undefined]) {
  const [en, my, th] = ["en", "my", "th"].map((l) => localizeMenuItem(item(), source, l));
  assert.equal(en.id, my.id, "item_code does not change with language");
  assert.equal(en.id, th.id);
  assert.equal(
    en.canonicalName,
    my.canonicalName,
    "the canonical name does not change with language",
  );
  assert.equal(en.canonicalName, th.canonicalName);
  assert.equal(en.price, my.price, "price does not change with language");
  assert.equal(en.price, th.price);
  assert.equal(en.available, my.available, "availability does not change with language");
  assert.equal(en.category, my.category, "category does not change with language");
}

// Every real item, in every language: identity and price are stable.
for (const real of MENU) {
  const base = localizeMenuItem(real, undefined, "en");
  for (const language of ["my", "th"]) {
    const other = localizeMenuItem(real, undefined, language);
    assert.equal(other.id, base.id, `${real.id} keeps its code in ${language}`);
    assert.equal(other.canonicalName, base.canonicalName, `${real.id} keeps its canonical name`);
    assert.equal(other.price, base.price, `${real.id} keeps its price in ${language}`);
    assert.ok(other.displayName.trim().length > 0, `${real.id} has a name to show in ${language}`);
  }
}

// THE PAYLOAD BOUNDARY. The cart line carries both, and only the canonical
// one is submitted.
assert.ok(
  menuScreenSource.includes("name: item.canonicalName") &&
    menuScreenSource.includes("displayName: item.displayName"),
  "cart lines carry the canonical name for the payload and the display name for the customer",
);
assert.ok(
  checkoutSource.includes("        name: item.name,"),
  "the order payload still sends item.name — the CANONICAL one",
);
assert.ok(
  !/name: item\.displayName/.test(checkoutSource),
  "no payload field is ever built from the localised name",
);
assert.ok(
  checkoutSource.includes("itemCode") === false,
  "the checkout sheet does not reshape the intake body — orders.ts owns that",
);
assert.ok(
  readFileSync("src/lib/orders.ts", "utf8").includes(
    "items: payload.items.map((item) => ({ itemCode: item.id, quantity: item.quantity })),",
  ),
  "the Supabase intake body is still item codes and quantities only",
);

/* ── 4. Sold out and hidden are unchanged ──────────────────────────────── */

assert.equal(
  localizeMenuItem(item(), withDb, "my", { available: false }).available,
  false,
  "a sold-out item is sold out in every language",
);
assert.equal(
  localizeMenuItem(item(), withDb, "my", { available: false }).displayName,
  "DB မြန်မာ",
  "and still shows its localised name while sold out",
);
assert.ok(
  menuScreenSource.includes('if (row?.availability === "Hidden") return [];'),
  "hidden items are dropped from the customer menu, as before",
);
assert.ok(
  menuScreenSource.includes("soldOut: !item.available"),
  "cart lines still flag an item that went sold out after being added",
);

/* ── 5. Price safety ───────────────────────────────────────────────────── */

assert.equal(
  localizeMenuItem(item(), undefined, "en", { available: true, price: 0 }).price,
  100,
  "a 0 from the database read does not become a ฿0 card — the compiled price stands",
);
assert.equal(
  localizeMenuItem(item(), undefined, "en", { available: true, price: 250 }).price,
  250,
  "a real database price wins",
);
assert.equal(
  localizeMenuItem(item({ price: undefined }), undefined, "en", { available: true, price: 0 })
    .price,
  undefined,
  "with no usable price anywhere the card says ask staff rather than inventing one",
);

/* ── 6. Photos: absent, malformed and hostile all fall back ────────────── */

assert.equal(approvedImageUrl("https://cdn.example.com/a.jpg"), "https://cdn.example.com/a.jpg");
for (const bad of [
  undefined,
  null,
  "",
  "   ",
  "http://cdn.example.com/a.jpg",
  "javascript:alert(1)",
  "data:image/png;base64,AAAA",
  "//cdn.example.com/a.jpg",
  "https://user:pw@cdn.example.com/a.jpg",
  "https://cdn.example.com/a b.jpg",
  "not a url",
  `https://cdn.example.com/${"x".repeat(2100)}.jpg`,
]) {
  assert.equal(approvedImageUrl(bad), undefined, `${JSON.stringify(bad)} is not an image URL`);
}
assert.equal(
  localizeMenuItem(item(), { imageUrl: "javascript:alert(1)" }, "en").imageUrl,
  undefined,
  "a hostile URL never reaches the card",
);
assert.equal(localizeMenuItem(item(), undefined, "en").imageUrl, undefined, "no photo is fine");

// The card falls back to the icon for BOTH "no photo" and "photo failed".
assert.ok(
  /if \(!src \|\| failed\) return <SkewerFlameIcon/.test(cardSource),
  "the icon is the fallback for a missing AND a broken photo",
);
assert.ok(
  /onError=\{\(\) => setFailed\(true\)\}/.test(cardSource),
  "a photo that fails to load switches to the icon rather than leaving a torn box",
);
assert.ok(
  cardSource.includes("h-11 w-11") && cardSource.includes("object-cover"),
  "the photo occupies the same 44px tile the icon did, so no card can change height",
);

/* ── 7. Categories: localised, and still code-level taxonomy ───────────── */

const signature = CATEGORIES.find((c) => c.id === "signature");
assert.equal(localizeCategory(signature, "en").name, signature.nameEn);
assert.equal(
  localizeCategory(signature, "my").name,
  signature.nameMy,
  "Myanmar category names exist",
);
assert.equal(
  localizeCategory(signature, "th").name,
  signature.nameEn,
  "no Thai category name yet falls back to English",
);
assert.equal(
  localizeCategory({ ...signature, nameMy: "  " }, "my").name,
  signature.nameEn,
  "a blank category translation falls back",
);
for (const category of CATEGORIES) {
  for (const language of ["en", "my", "th"]) {
    const { name, blurb } = localizeCategory(category, language);
    assert.ok(name.trim().length > 0, `${category.id} has a name in ${language}`);
    assert.ok(blurb.trim().length > 0, `${category.id} has a blurb in ${language}`);
  }
}
assert.equal(
  localizeMenuItem(item(), { nameEn: "x" }, "en").category,
  "skewers",
  "the category comes from the typed compiled row, not a free-text database column",
);

/* ── 8. The read path degrades instead of failing ──────────────────────── */

assert.ok(
  readPathSource.includes(
    "const tiers = [CONTENT_MENU_COLUMNS, PUBLIC_MENU_COLUMNS, PRE_MIGRATION_MENU_COLUMNS];",
  ),
  "the read asks for content columns first and steps down for an older database",
);
assert.ok(
  readPathSource.includes("if (!rows) throw lastError;"),
  "a genuine outage still throws to the caller rather than returning an empty menu",
);
assert.ok(
  /put\("nameMy", row\.name_my\)/.test(readPathSource) &&
    readPathSource.includes(
      'if (typeof value === "string" && value.trim() !== "") content[key] = value;',
    ),
  "blank database strings are dropped at the boundary, so they read as absent",
);

/* ── 9. The migration artifacts exist and are review-first ─────────────── */

const migration = readFileSync("docs/sql/2026-09-04-menu-content-i18n.sql", "utf8");
const seed = readFileSync("docs/sql/2026-09-04-menu-content-seed.sql", "utf8");

assert.ok(migration.includes("REVIEW-FIRST MIGRATION"), "the migration says how it is run");
for (const column of [
  "name_my",
  "name_th",
  "description_en",
  "description_my",
  "description_th",
  "image_url",
  "unit",
]) {
  assert.ok(migration.includes(`add column if not exists ${column}`), `${column} is added`);
  assert.ok(
    new RegExp(`grant select \\([\\s\\S]*?${column}[\\s\\S]*?\\)`).test(migration),
    `${column} is in the anon grant — without it the column is invisible`,
  );
}
assert.ok(
  !/drop column(?!\s+if exists)/.test(migration.split("-- ── 4. ROLLBACK")[0]),
  "the live part of the migration drops nothing",
);
assert.ok(
  migration.includes("menu_items_image_url_https"),
  "image_url is constrained to https at the database too",
);
// Idempotent and non-destructive by construction.
assert.ok(
  seed.includes("coalesce(nullif(btrim(m.description_en), ''), v.description_en)"),
  "the seed only fills blanks — an operator's own wording is never overwritten",
);
assert.ok(
  !/\binsert into\b|\bdelete from\b/i.test(seed),
  "the seed neither inserts nor deletes menu rows",
);
assert.ok(
  !/\bname_en\s*=/.test(seed) && !/\bprice\s*=/.test(seed) && !/availability_status\s*=/.test(seed),
  "the seed does not touch operational columns",
);
assert.equal(
  (seed.match(/^ {4}\('[A-Z]\d{2}',/gm) ?? []).length,
  MENU.length,
  `the seed carries all ${MENU.length} items`,
);

console.log("test-menu-content: all assertions passed");
