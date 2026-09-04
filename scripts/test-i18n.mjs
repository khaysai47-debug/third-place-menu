// CUSTOMER LANGUAGE SEAM (no test framework — run with `npm run test:i18n`).
//
// src/lib/i18n.ts is deliberately free of React, `window` and `localStorage`:
// every input is passed in. That is what lets this file drive the whole
// mechanism with plain values — the same reason keyboardInset.ts takes its
// viewport as an argument instead of reading it.
//
// What is asserted here:
//   - a supported language parses, and NOTHING else does;
//   - ?lang= beats a stored preference, which beats English;
//   - storage that throws (private mode) degrades to English, never crashes;
//   - a key with no Myanmar/Thai yet renders ENGLISH, never `undefined`;
//   - the language a customer picks cannot disturb their cart;
//   - staff routes never mount the provider.

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const outDir = "node_modules/.cache/i18n-test";
execSync(
  `npx tsc src/lib/i18n.ts --outDir ${outDir}` +
    " --module nodenext --moduleResolution nodenext --target es2022" +
    " --lib es2022,dom --skipLibCheck",
  { stdio: "inherit" },
);
writeFileSync(path.join(outDir, "package.json"), '{"type":"module"}\n');

const {
  LANGUAGES,
  DEFAULT_LANGUAGE,
  LANGUAGE_NAMES,
  LANGUAGE_STORAGE_KEY,
  parseLanguage,
  languageFromSearch,
  readStoredLanguage,
  storeLanguage,
  resolveInitialLanguage,
  translate,
  selectCopy,
  COPY,
} = await import(pathToFileURL(path.resolve(outDir, "i18n.js")).href);

/** A localStorage stand-in. `throws` reproduces private-mode browsers, which
 *  raise on access rather than returning null. */
function fakeStore({ seed = null, throws = false } = {}) {
  let value = seed;
  return {
    get value() {
      return value;
    },
    getItem(key) {
      if (throws) throw new Error("storage disabled");
      return key === LANGUAGE_STORAGE_KEY ? value : null;
    },
    setItem(key, next) {
      if (throws) throw new Error("storage disabled");
      if (key === LANGUAGE_STORAGE_KEY) value = next;
    },
  };
}

/* ── 1. Language parsing ───────────────────────────────────────────────── */

assert.deepEqual([...LANGUAGES], ["en", "my", "th"], "exactly the three pilot languages");
assert.equal(DEFAULT_LANGUAGE, "en");

for (const good of ["en", "my", "th"]) {
  assert.equal(parseLanguage(good), good, `${good} is supported`);
}
// Case and surrounding whitespace are a link's problem, not the customer's.
assert.equal(parseLanguage("MY"), "my", "case-insensitive");
assert.equal(parseLanguage("  th "), "th", "trimmed");

// Anything else is null — never a guess, never a throw. "zh" is in this list
// on purpose: the Chinese on the menu is BRAND, not a selectable language,
// and must not become one through a URL.
for (const bad of [
  "",
  "  ",
  "zh",
  "en-US",
  "burmese",
  "e",
  "th;",
  "../en",
  null,
  undefined,
  7,
  {},
]) {
  assert.equal(parseLanguage(bad), null, `${JSON.stringify(bad)} is not a language`);
}

/* ── 2. ?lang= reading ─────────────────────────────────────────────────── */

assert.equal(languageFromSearch("?lang=my"), "my", "reads the query parameter");
assert.equal(languageFromSearch("lang=th"), "th", "accepts a bare query string");
assert.equal(languageFromSearch("?browse=1&lang=en"), "en", "finds it among other params");
assert.equal(languageFromSearch("?lang=zh"), null, "an unsupported value is ignored");
assert.equal(languageFromSearch("?browse=1"), null, "absent is null");
assert.equal(languageFromSearch(""), null);
assert.equal(languageFromSearch(null), null);

/* ── 3. Stored preference ──────────────────────────────────────────────── */

assert.equal(readStoredLanguage(fakeStore({ seed: "th" })), "th", "reads a stored choice");
assert.equal(readStoredLanguage(fakeStore({ seed: "zh" })), null, "a corrupt value is ignored");
assert.equal(readStoredLanguage(fakeStore()), null, "nothing stored is null");
assert.equal(readStoredLanguage(null), null, "no storage at all is null");
assert.equal(
  readStoredLanguage(fakeStore({ throws: true })),
  null,
  "storage that throws is treated as no preference, not an error",
);

const writable = fakeStore();
storeLanguage("my", writable);
assert.equal(writable.value, "my", "a choice persists");
// Must not throw: the choice still applies to the page the customer is on.
assert.doesNotThrow(() => storeLanguage("my", fakeStore({ throws: true })));
assert.doesNotThrow(() => storeLanguage("my", null));

/* ── 4. Precedence ─────────────────────────────────────────────────────── */

assert.equal(
  resolveInitialLanguage({ search: "?lang=my", storage: fakeStore({ seed: "th" }) }),
  "my",
  "?lang= WINS over a stored preference — the Messenger link carries the choice " +
    "the customer just made in chat, and a preference left in this browser weeks " +
    "ago must not override it",
);
assert.equal(
  resolveInitialLanguage({ search: "?browse=1", storage: fakeStore({ seed: "th" }) }),
  "th",
  "without ?lang=, the stored preference applies",
);
assert.equal(
  resolveInitialLanguage({ search: "?lang=zh", storage: fakeStore({ seed: "th" }) }),
  "th",
  "an unsupported ?lang= falls through to the stored preference, it does not blank it",
);
assert.equal(
  resolveInitialLanguage({ search: "", storage: fakeStore() }),
  "en",
  "nothing anywhere is English",
);
assert.equal(resolveInitialLanguage({}), "en", "no inputs at all is English");
assert.equal(
  resolveInitialLanguage({ search: "?lang=th", storage: fakeStore({ throws: true }) }),
  "th",
  "a broken storage does not stop the link's language applying",
);

/* ── 5. Translation lookup and the English floor ───────────────────────── */

// Every key must carry English. This is the property that makes `translate`
// total, so it is asserted over the whole dictionary rather than trusted.
for (const [key, entry] of Object.entries(COPY)) {
  assert.equal(typeof entry.en, "string", `${key} has English`);
  assert.notEqual(entry.en.trim(), "", `${key}'s English is not blank`);
}

const sample = "cart.viewCart";
assert.equal(translate(sample, "en"), COPY[sample].en);
// Not yet translated → English, never undefined and never an empty label.
for (const language of ["my", "th"]) {
  const out = translate(sample, language);
  assert.equal(typeof out, "string", "a translation is always a string");
  assert.equal(out, COPY[sample].en, "an untranslated key falls back to English");
}
for (const key of Object.keys(COPY)) {
  for (const language of LANGUAGES) {
    const out = translate(key, language);
    assert.ok(
      typeof out === "string" && out.length > 0,
      `${key}/${language} renders real copy, never undefined`,
    );
  }
}

// And once a translation exists it is actually used. Proved against a
// FIXTURE, not shipped copy: no invented Myanmar or Thai needs to exist in the
// dictionary for the selection rule to be verifiable.
const fixture = { en: "EN", my: "MY" };
assert.equal(selectCopy(fixture, "my"), "MY", "a present translation is used");
assert.equal(selectCopy(fixture, "th"), "EN", "a missing one falls back to English");
assert.equal(selectCopy(fixture, "en"), "EN");
assert.equal(selectCopy({ en: "only" }, "my"), "only", "English-only entries are safe");

/* ── 6. The picker is readable in its own script ───────────────────────── */

assert.equal(LANGUAGE_NAMES.en, "English");
assert.equal(LANGUAGE_NAMES.my, "မြန်မာ", "Myanmar is labelled in Burmese");
assert.equal(LANGUAGE_NAMES.th, "ไทย", "Thai is labelled in Thai");

/* ── 7. Language cannot disturb the order ──────────────────────────────── */

const menuSource = readFileSync("src/components/menu/MenuScreen.tsx", "utf8");
const contextSource = readFileSync("src/lib/i18nContext.tsx", "utf8");
const switchSource = readFileSync("src/components/menu/LanguageSwitch.tsx", "utf8");

assert.notEqual(LANGUAGE_STORAGE_KEY, "tp_cart", "the language key is not the cart key");
assert.ok(
  LANGUAGE_STORAGE_KEY.startsWith("tp."),
  "the language key is namespaced so it cannot collide with staff keys",
);
// The switch only sets a language. If it ever touched the cart, changing
// language mid-order could drop items.
assert.ok(
  !/tp_cart|setCart|addToCart/.test(switchSource),
  "the language switch cannot reach the cart",
);
assert.ok(!/tp_cart|setCart/.test(contextSource), "the language provider cannot reach the cart");
// A `key` on the provider would remount its subtree and wipe the cart state
// held in MenuScreen on every language change.
assert.ok(
  !/<LanguageProvider[^>]*\bkey=/.test(readFileSync("src/routes/index.tsx", "utf8")),
  "the provider is not keyed — a remount would discard the cart",
);
assert.ok(
  !/<LanguageProvider[^>]*\bkey=/.test(readFileSync("src/routes/m.tsx", "utf8")),
  "the secure route's provider is not keyed either",
);
// The cart is still seeded from storage independently of language.
assert.ok(
  menuSource.includes('localStorage.getItem("tp_cart")'),
  "the cart still restores from its own key, untouched by this package",
);

/* ── 8. Staff isolation ────────────────────────────────────────────────── */

for (const staffRoute of ["src/routes/staff.tsx", "src/routes/owner.tsx"]) {
  const source = readFileSync(staffRoute, "utf8");
  assert.ok(
    !/LanguageProvider|useT\(|from "@\/lib\/i18n/.test(source),
    `${staffRoute} does not consume the customer language seam`,
  );
}
// Setting <html lang> from INSIDE the provider is what keeps a staff page
// from inheriting a customer's language on a shared browser.
assert.ok(
  contextSource.includes("document.documentElement.lang = language"),
  "the document language follows the customer language",
);
assert.ok(
  readFileSync("src/routes/__root.tsx", "utf8").includes('<html lang="en">'),
  "the root stays English — only a mounted customer provider changes it",
);

/* ── 9. The brand Chinese is not localisation ──────────────────────────── */

// The zh strings on the menu sit NEXT TO English at all times; they are the
// restaurant's identity, not a language option. The empty-state line proves
// the intended shape: brand mark preserved, English slot localised.
assert.ok(
  menuSource.includes('暫時售罄 · {t("menu.sectionEmpty")}'),
  "brand Chinese is preserved verbatim beside the localised English slot",
);
assert.ok(
  !Object.values(COPY).some((entry) => "zh" in entry),
  "zh is not a key in the copy dictionary — Chinese is brand, not a translation",
);

console.log("test-i18n: all assertions passed");
