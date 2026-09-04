// MENU CONTENT + LOCALISED DISPLAY (no test framework — `npm run test:menu-content`).
//
// The property this file exists to protect: a customer can read the menu in
// Myanmar or Thai, and NOTHING they submit changes because of it. The item
// code, the canonical English name and the price are the same in all three
// languages, because those are what the intake route and the n8n rollback
// path recognise.
//
// Also asserted: an item hidden while it sits in a cart stays there to be
// removed; a live row with an unusable price is blocked rather than papered
// over with the compiled figure; a failed read is visible every time, not just
// the first; a corrected photo URL recovers without a remount; and the three
// SQL artifacts are preflight-first, atomic, and a true no-op on re-run.

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
  assert.equal(out.displayName, "နွားသားကင်", `a ${label} name_my falls back to compiled Myanmar`);
  assert.equal(
    out.description,
    "DB english description.",
    `a ${label} description_my falls back through English`,
  );
}

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

const offline = localizeMenuItem(item(), undefined, "th");
assert.equal(offline.displayName, "Beef");
assert.equal(offline.description, "Tender beef skewers.");
assert.equal(offline.price, 100, "price survives a database outage");
assert.equal(offline.available, true, "an item does not become unorderable because a read failed");
assert.equal(offline.unit, "x4 skewers");

/* ── 3. Canonical identity and price are language-invariant ────────────── */

for (const source of [withDb, onlyEnglishRow, undefined]) {
  const [en, my, th] = ["en", "my", "th"].map((l) => localizeMenuItem(item(), source, l));
  assert.equal(en.id, my.id, "item_code does not change with language");
  assert.equal(en.id, th.id);
  assert.equal(en.canonicalName, my.canonicalName, "canonical name does not change with language");
  assert.equal(en.canonicalName, th.canonicalName);
  assert.equal(en.price, my.price, "price does not change with language");
  assert.equal(en.price, th.price);
  assert.equal(en.available, my.available, "availability does not change with language");
  assert.equal(en.category, my.category, "category does not change with language");
}

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

// THE PAYLOAD BOUNDARY.
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
  readFileSync("src/lib/orders.ts", "utf8").includes(
    "items: payload.items.map((item) => ({ itemCode: item.id, quantity: item.quantity })),",
  ),
  "the Supabase intake body is still item codes and quantities only",
);

/* ── 4. HIDDEN ITEMS STAY IN THE CART ──────────────────────────────────── */

// The regression this section exists for: filtering Hidden out of the menu and
// then resolving cart lines against that filtered list made an item vanish
// from someone's order the moment staff hid it.
const hiddenItem = localizeMenuItem(item(), withDb, "en", { status: "Hidden", price: 100 });
assert.equal(hiddenItem.hidden, true, "a hidden item is marked hidden");
assert.equal(hiddenItem.available, false, "and cannot be ordered");
assert.equal(hiddenItem.displayName, "Beef Skewers", "but is still fully resolvable for the cart");
assert.equal(hiddenItem.price, 100, "and keeps its price so the line can show what it cost");

const soldOutItem = localizeMenuItem(item(), withDb, "en", { status: "Sold Out", price: 100 });
assert.equal(soldOutItem.soldOut, true);
assert.equal(soldOutItem.hidden, false, "sold out is not hidden");
assert.equal(soldOutItem.available, false, "and is not orderable");

const liveItem = localizeMenuItem(item(), withDb, "en", { status: "Available", price: 100 });
assert.equal(liveItem.available, true, "an available, priced item is orderable");
assert.equal(liveItem.hidden, false);
assert.equal(liveItem.soldOut, false);
// Nothing latches: availability coming back restores normal behaviour.
assert.equal(
  localizeMenuItem(item(), withDb, "en", { status: "Available", price: 100 }).available,
  true,
  "an item that was hidden and is available again is orderable again",
);

assert.ok(
  menuScreenSource.includes("const allItems = useMemo<LocalizedMenuItem[]>"),
  "an unfiltered collection exists",
);
assert.ok(
  /const menu = useMemo\(\(\) => allItems\.filter\(\(item\) => !item\.hidden\)/.test(
    menuScreenSource,
  ),
  "the BROWSE list is the filtered one",
);
assert.ok(
  menuScreenSource.includes("const item = allItems.find((i) => i.id === id);"),
  "CART lines resolve against the UNFILTERED collection",
);
assert.ok(
  !/const item = menu\.find\(/.test(menuScreenSource),
  "no cart resolution goes through the filtered browse list",
);
assert.ok(
  !/if \(!item \|\| item\.price === undefined\) return \[\];/.test(menuScreenSource),
  "an unpriced cart line is no longer silently discarded",
);
assert.ok(
  menuScreenSource.includes("soldOut: !item.available") &&
    menuScreenSource.includes("priceUnavailable: item.priceUnavailable"),
  "a blocked line is flagged so checkout shows it, blocks submit and offers Remove",
);
assert.ok(
  menuScreenSource.includes("subtotal: item.price !== undefined ? item.price * qty : 0"),
  "a line with no price contributes nothing to the total",
);
assert.ok(
  checkoutSource.includes('setSubmitError(t("checkout.soldOutBlock"));'),
  "a blocked line still blocks the whole submit",
);
assert.ok(
  checkoutSource.includes("onClick={() => onRemove(item.id)}"),
  "and the customer can remove it",
);

/* ── 5. INVALID LIVE PRICE IS NOT PAPERED OVER ─────────────────────────── */

for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
  const out = localizeMenuItem(item(), withDb, "en", { status: "Available", price: bad });
  assert.equal(out.price, undefined, `a live price of ${bad} quotes nothing`);
  assert.equal(out.priceUnavailable, true, `a live price of ${bad} is flagged unavailable`);
  assert.equal(out.available, false, `a live price of ${bad} blocks ordering`);
  assert.notEqual(out.price, 100, "the compiled price is NOT substituted for a live invalid one");
}

const repriced = localizeMenuItem(item(), withDb, "en", { status: "Available", price: 250 });
assert.equal(repriced.price, 250, "a real live price wins");
assert.equal(repriced.priceUnavailable, false);
assert.equal(repriced.available, true);

// NO LIVE ROW is the different case: the compiled price is the last known good
// value, and the alternative is a menu with no prices at all.
const noRow = localizeMenuItem(item(), withDb, "en");
assert.equal(noRow.price, 100, "with no live row the compiled price is used");
assert.equal(noRow.priceUnavailable, false);
assert.equal(noRow.available, true, "and the item stays orderable through an outage");

const neverPriced = localizeMenuItem(item({ price: undefined }), withDb, "en");
assert.equal(neverPriced.price, undefined);
assert.equal(neverPriced.priceUnavailable, true);
assert.equal(neverPriced.available, false, "an item with no price anywhere cannot be ordered");

assert.ok(
  cardSource.includes('{t("item.priceAskStaff")}'),
  "the card shows the ask-staff copy when there is no price",
);
assert.equal(
  (checkoutSource.match(/item\.priceUnavailable/g) ?? []).length,
  2,
  "exactly the two money-rendering sites consult priceUnavailable: the cart line and the confirmation line",
);
assert.ok(
  /priceUnavailable\?: boolean;/.test(checkoutSource),
  "and the cart line type carries the flag",
);
assert.ok(
  (checkoutSource.match(/t\("item\.priceAskStaff"\)/g) ?? []).length >= 2,
  "both show ask-staff instead of a ฿0 figure",
);

/* ── 6. Degraded read is visible, every time ───────────────────────────── */

assert.ok(
  menuScreenSource.includes(
    'const [readState, setReadState] = useState<"pending" | "live" | "degraded">("pending")',
  ),
  "the screen tracks whether the last read actually succeeded",
);
assert.ok(
  menuScreenSource.includes('setReadState("live")'),
  "a successful read is recorded as live",
);
assert.ok(
  menuScreenSource.includes('setReadState("degraded")'),
  "a failed read is recorded as degraded",
);
assert.ok(
  !/if \(isInitial\) set/.test(menuScreenSource),
  "a background refresh failure is no longer silent — it used to warn only on the first attempt",
);
assert.ok(
  menuScreenSource.includes('{readState === "degraded" && ('),
  "the customer-facing notice follows the read state",
);
assert.ok(
  menuScreenSource.includes("MENU.map((item) => {"),
  "the compiled list still drives rendering, so a failed read cannot blank the menu",
);
assert.ok(
  menuScreenSource.includes('console.error("Live availability unavailable; using local menu data"'),
  "the technical reason goes to the console",
);
assert.ok(
  /"menu\.availabilityWarning": \{[\s\S]*?refresh/.test(readFileSync("src/lib/i18n.ts", "utf8")),
  "the customer sees plain language, not an error code",
);
assert.ok(
  !/\{error\}|\{String\(error\)\}|error\.message/.test(menuScreenSource),
  "no error object is rendered to the customer",
);

/* ── 7. Photos: absent, malformed, hostile, and RECOVERED ──────────────── */

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

assert.ok(
  /if \(!src \|\| failedSrc === src\) return <SkewerFlameIcon/.test(cardSource),
  "the icon is the fallback for a missing AND a broken photo",
);
// THE RESET. Failure is remembered against the URL that failed, not as a latch.
assert.ok(
  /const \[failedSrc, setFailedSrc\] = useState<string \| null>\(null\)/.test(cardSource),
  "the failed URL is remembered, not a boolean",
);
assert.ok(
  /onError=\{\(\) => setFailedSrc\(src\)\}/.test(cardSource),
  "a failure records WHICH url failed",
);
assert.ok(
  /key=\{src\}/.test(cardSource),
  "the img is keyed on the url so a changed photo mounts a fresh element",
);
assert.ok(
  cardSource.includes("h-11 w-11") && cardSource.includes("object-cover"),
  "the photo occupies the same 44px tile the icon did, so no card can change height",
);

/* ── 8. Categories: localised, and still code-level taxonomy ───────────── */

const signature = CATEGORIES.find((c) => c.id === "signature");
assert.equal(localizeCategory(signature, "en").name, signature.nameEn);
assert.equal(localizeCategory(signature, "my").name, signature.nameMy, "Myanmar names exist");
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

/* ── 9. The read path degrades instead of failing ──────────────────────── */

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

/* ── 10. SQL artifacts: preflight, atomic migration, no-op seed ────────── */

const preflight = readFileSync("docs/sql/2026-09-04-menu-content-preflight.sql", "utf8");
const migration = readFileSync("docs/sql/2026-09-04-menu-content-i18n.sql", "utf8");
const seed = readFileSync("docs/sql/2026-09-04-menu-content-seed.sql", "utf8");

// PREFLIGHT — read-only, exact codes, before-image first.
assert.ok(
  !/^\s*(insert into|update |delete from|alter table|drop )/im.test(preflight),
  "the preflight mutates nothing",
);
assert.ok(preflight.includes("missing_item_code"), "the preflight reports MISSING codes");
assert.ok(preflight.includes("having count(*) > 1"), "the preflight reports DUPLICATE codes");
assert.ok(/EXTRA codes/.test(preflight), "the preflight reports EXTRA codes for review");
assert.equal(
  (preflight.match(/^ {4}\('[A-Z]\d{2}'\)/gm) ?? []).length,
  MENU.length * 3,
  `all ${MENU.length} expected codes appear in each of the three code checks`,
);
assert.ok(
  preflight.indexOf("Before-image") < preflight.indexOf("Expected-code coverage"),
  "the before-image is taken FIRST, before anything else",
);
for (const inspection of [
  "information_schema.columns",
  "pg_constraint",
  "pg_trigger",
  "pg_policies",
  "role_table_grants",
]) {
  assert.ok(preflight.includes(inspection), `the preflight inspects ${inspection}`);
}

// MIGRATION — one transaction covering columns, constraint AND grant.
const txn = migration.slice(migration.indexOf("begin;"), migration.indexOf("commit;"));
for (const inside of [
  "add column if not exists name_my",
  "menu_items_image_url_https",
  "revoke select on public.menu_items from anon",
  "grant select (item_code",
]) {
  assert.ok(txn.includes(inside), `inside the ONE transaction: ${inside}`);
}
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
  assert.ok(txn.includes(`add column if not exists ${column}`), `${column} is added atomically`);
  assert.ok(
    new RegExp(`grant select \\([\\s\\S]*?${column}[\\s\\S]*?\\)`).test(txn),
    `${column} is in the anon grant inside the same transaction`,
  );
}
// EFFECTIVE verification, not just privilege rows.
assert.ok(migration.includes("set local role anon;"), "verification runs AS anon");
assert.ok(
  /order by sort_order asc, item_code asc/.test(migration),
  "verification reproduces the application's actual SELECT + ORDER BY contract",
);
for (const mustFail of [
  "select * from public.menu_items",
  "select id from public.menu_items",
  "update public.menu_items set price",
  "insert into public.menu_items",
  "delete from public.menu_items",
]) {
  assert.ok(migration.includes(mustFail), `verification proves anon cannot: ${mustFail}`);
}
assert.ok(migration.includes("'PUBLIC'"), "a broader PUBLIC grant is checked for");
assert.ok(migration.includes("rows_as_anon"), "row visibility under RLS is checked");
assert.ok(
  !/set\s+description_\w+\s*=\s*NULL/i.test(migration + seed),
  "no rollback blanks the owner's content columns",
);
assert.ok(/before-image/i.test(migration), "restoration is based on a preserved export");

// SEED — true no-op, byte-preserving.
assert.ok(
  seed.includes(
    "case when btrim(coalesce(m.description_en, '')) <> '' then m.description_en else v.description_en end",
  ),
  "a non-blank value is kept byte for byte — BTRIM only tests blankness",
);
assert.ok(
  !/=\s*btrim\(/.test(seed.slice(seed.indexOf("update public.menu_items"), seed.indexOf("from ("))),
  "nothing is written through BTRIM, so owner spacing is never silently trimmed",
);
assert.ok(
  seed.includes("(btrim(coalesce(m.description_en, '')) = '' and v.description_en is not null)"),
  "the change guard requires a blank column WITH a value waiting",
);
assert.ok(
  /where m\.item_code = v\.item_code\n {2}and \(/.test(seed),
  "the UPDATE is restricted to rows that would actually change",
);
assert.ok(
  seed.includes("rows_that_would_change"),
  "a dry-count query proves the no-op without running the update",
);
assert.ok(
  /Expect \d+ before the first run and 0 after it/.test(seed),
  "the expected no-op result is stated",
);
assert.ok(
  !/\binsert into\b|\bdelete from\b/i.test(seed),
  "the seed neither inserts nor deletes menu rows",
);
for (const operational of [
  "name_en",
  "price",
  "availability_status",
  "is_available",
  "sort_order",
]) {
  assert.ok(
    !new RegExp(`^\\s*${operational}\\s*=`, "m").test(seed),
    `the seed does not assign ${operational}`,
  );
}
assert.equal(
  (seed.match(/^ {4}\('[A-Z]\d{2}',/gm) ?? []).length,
  MENU.length * 2,
  `the seed carries all ${MENU.length} items in both its update and its dry-count`,
);

console.log("test-menu-content: all assertions passed");
