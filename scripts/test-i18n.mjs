// CUSTOMER LANGUAGE SEAM (no test framework — run with `npm run test:i18n`).
//
// src/lib/i18n.ts is deliberately free of React, `window` and `localStorage`:
// every input is passed in. That is what lets this file drive the whole
// mechanism with plain values — the same reason keyboardInset.ts takes its
// viewport as an argument instead of reading it.
//
// What is asserted here:
//   - a supported language parses, and NOTHING else does;
//   - ?lang= beats a stored preference, which beats English, and a picker
//     override beats the link on refresh;
//   - storage that throws (private mode) degrades to English, never crashes;
//   - a missing, EMPTY or WHITESPACE translation renders English;
//   - functional Chinese disappears in Myanmar/Thai while identity Chinese
//     stays in every language;
//   - the document language is restored when the customer provider unmounts;
//   - parameterised copy substitutes whole phrases, never English fragments;
//   - the recovery copy promises no text keywords.

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
  formatCopy,
  showFunctionalChinese,
  applyDocumentLanguage,
  hasLanguageParam,
  withLanguageParam,
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

const menuSource = readFileSync("src/components/menu/MenuScreen.tsx", "utf8");
const heroSource = readFileSync("src/components/menu/Hero.tsx", "utf8");
const chineseSource = readFileSync("src/components/menu/ChineseText.tsx", "utf8");
const contextSource = readFileSync("src/lib/i18nContext.tsx", "utf8");
const switchSource = readFileSync("src/components/menu/LanguageSwitch.tsx", "utf8");
const noticeSource = readFileSync("src/components/menu/SessionNotice.tsx", "utf8");
const secureRouteSource = readFileSync("src/routes/m.tsx", "utf8");

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
// on purpose: Chinese is never a SELECTABLE customer language here, whatever
// role a given piece of Chinese plays on the page (see section 6).
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
assert.doesNotThrow(() => storeLanguage("my", fakeStore({ throws: true })));
assert.doesNotThrow(() => storeLanguage("my", null));

/* ── 4. Precedence, the URL contract, and picker override ──────────────── */

assert.equal(
  resolveInitialLanguage({ search: "?lang=my", storage: fakeStore({ seed: "th" }) }),
  "my",
  "?lang= WINS over a stored preference — the Messenger link carries the choice " +
    "the customer just made in chat",
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
assert.equal(resolveInitialLanguage({ search: "", storage: fakeStore() }), "en");
assert.equal(resolveInitialLanguage({}), "en", "no inputs at all is English");
assert.equal(
  resolveInitialLanguage({ search: "?lang=th", storage: fakeStore({ throws: true }) }),
  "th",
  "a broken storage does not stop the link's language applying",
);

// Presence, independent of validity — an invalid lang= is still a lang= the
// picker must overwrite rather than leave lying in the URL.
assert.equal(hasLanguageParam("?lang=my"), true);
assert.equal(hasLanguageParam("?lang=zh"), true, "present but unsupported still counts as present");
assert.equal(hasLanguageParam("?browse=1"), false);
assert.equal(hasLanguageParam(""), false);
assert.equal(hasLanguageParam(null), false);

assert.equal(withLanguageParam("?lang=my", "th"), "?lang=th", "the picker rewrites the parameter");
assert.equal(
  withLanguageParam("?browse=1&lang=my", "th"),
  "?browse=1&lang=th",
  "every other parameter survives the rewrite",
);
assert.equal(withLanguageParam("", "th"), "?lang=th");
assert.equal(withLanguageParam("?lang=zh", "en"), "?lang=en", "an invalid value is corrected");

// THE REFRESH CONTRACT. Arrive on ?lang=my, pick Thai, reload: Thai — the link
// must not keep forcing Myanmar back. Proven against BOTH carriers, so it
// holds even in a browser that refuses storage.
const afterOverride = withLanguageParam("?lang=my", "th");
assert.equal(
  resolveInitialLanguage({ search: afterOverride, storage: fakeStore({ seed: "th" }) }),
  "th",
  "refresh after a picker override keeps the NEW language",
);
assert.equal(
  resolveInitialLanguage({ search: afterOverride, storage: null }),
  "th",
  "and keeps it with no storage at all, because the URL was corrected too",
);

// The fragment strip must carry the query with it, or a Messenger link loses
// its language on the first render.
assert.ok(
  /router\.navigate\(\{\s*to:\s*"\/m",\s*search:\s*\(prev\)\s*=>\s*prev,\s*hash:\s*""/.test(
    secureRouteSource,
  ),
  "/m preserves the search string while removing the token fragment",
);
assert.ok(
  secureRouteSource.includes("hasMenuSessionFragment()"),
  "fragment-based token transport is unchanged",
);
assert.ok(
  contextSource.includes("if (!hasLanguageParam(search)) return;"),
  "a clean URL stays clean — the picker only rewrites a lang= that is already there",
);
assert.ok(
  contextSource.includes("window.history.replaceState"),
  "the override replaces rather than pushes, so Back is not littered",
);

/* ── 5. Blank-translation safety and the English floor ─────────────────── */

// Every key must carry non-blank English. This is the property that makes
// selectCopy total, so it is asserted over the whole dictionary.
for (const [key, entry] of Object.entries(COPY)) {
  const english = entry.en;
  assert.ok(
    typeof english === "string" || (english && typeof english === "object"),
    `${key} has English`,
  );
  if (typeof english === "string") {
    assert.notEqual(english.trim(), "", `${key}'s English is not blank`);
  } else {
    assert.notEqual(english.one.trim(), "", `${key}'s English singular is not blank`);
    assert.notEqual(english.other.trim(), "", `${key}'s English plural is not blank`);
  }
}

// A translator leaving a cell blank must fall back to English, not blank the
// customer's screen. All flavours of "nothing useful" behave the same.
for (const [label, value] of [
  ["missing", undefined],
  ["empty", ""],
  ["whitespace", "   "],
  ["tabs and newlines", "\t\n "],
]) {
  assert.equal(
    selectCopy({ en: "English copy", my: value }, "my"),
    "English copy",
    `a ${label} translation falls back to English`,
  );
}
assert.equal(
  selectCopy({ en: "English copy", my: "မြန်မာ" }, "my"),
  "မြန်မာ",
  "a real translation is used",
);
assert.equal(selectCopy({ en: "only" }, "th"), "only", "English-only entries are safe");

// Total in every direction: never undefined, never empty.
for (const key of Object.keys(COPY)) {
  for (const language of LANGUAGES) {
    const out = translate(key, language, { count: 2, platform: "Messenger" });
    assert.ok(
      typeof out === "string" && out.trim().length > 0,
      `${key}/${language} renders real copy, never undefined or blank`,
    );
  }
}

/* ── 6. Chinese: identity is preserved, functional copy is not duplicated ─ */

assert.equal(showFunctionalChinese("en"), true, "English mode keeps the English + 中文 pairing");
assert.equal(showFunctionalChinese("my"), false, "Myanmar does not get functional Chinese too");
assert.equal(showFunctionalChinese("th"), false, "Thai does not get functional Chinese too");

// FUNCTIONAL: hidden outside English, and hidden from screen readers when
// shown, because the English beside it already says the same thing.
assert.ok(/export function FunctionalZh/.test(chineseSource), "FunctionalZh exists");
assert.ok(
  /const \{ showZh \} = useLanguage\(\);\s*\n\s*if \(!showZh\) return null;/.test(chineseSource),
  "FunctionalZh renders nothing outside English",
);
assert.ok(
  /<span lang="zh-Hant" aria-hidden/.test(chineseSource),
  "functional Chinese shown beside English is aria-hidden and tagged zh-Hant",
);
// IDENTITY: present in every language, announced, and tagged so a screen
// reader switches voice instead of spelling it out in English phonemes.
assert.ok(
  /export function IdentityZh/.test(chineseSource),
  "identity Chinese has its own component",
);
// The function body ONLY — the next declaration's doc comment would otherwise
// be swept in and the aria-hidden check would read the wrong component.
const identityStart = chineseSource.indexOf("export function IdentityZh");
const identityBody = chineseSource.slice(
  identityStart,
  chineseSource.indexOf("\n}\n", identityStart),
);
assert.ok(
  !/showZh|useLanguage/.test(identityBody),
  "identity Chinese is NOT conditioned on language — it is the restaurant's name",
);
assert.ok(
  /lang="zh-Hant"/.test(identityBody) && !/aria-hidden/.test(identityBody),
  "identity Chinese is tagged zh-Hant and left announced",
);

// The two worked examples.
assert.ok(
  menuSource.includes("<FunctionalZh>暫時售罄 · </FunctionalZh>") &&
    menuSource.includes('{t("menu.sectionEmpty")}'),
  "the sold-out message is functional: its Chinese half drops away in my/th",
);
assert.ok(
  heroSource.includes("<IdentityZh") && heroSource.includes("第三空間"),
  "the restaurant's Chinese name is identity and survives every language",
);
// The separator must live inside the Chinese so it is not stranded in front of
// Burmese text.
assert.ok(
  !/暫時售罄 · \{t\(/.test(menuSource),
  "the separator went with the Chinese, not left dangling before the translation",
);
assert.ok(
  !Object.values(COPY).some((entry) => "zh" in entry),
  "zh is not a key in the copy dictionary — it is never a selectable language",
);

/* ── 7. Document language is restored on unmount ───────────────────────── */

// Drives the exact lifecycle React runs: apply on mount, cleanup-then-apply on
// each change, cleanup on unmount.
const doc = { lang: "en" };
const restoreFirst = applyDocumentLanguage(doc, "my");
assert.equal(doc.lang, "my", "the customer page announces the customer's language");
restoreFirst();
const restoreSecond = applyDocumentLanguage(doc, "th");
assert.equal(doc.lang, "th", "switching language updates it");
// Customer navigates to /staff: the provider unmounts.
restoreSecond();
assert.equal(
  doc.lang,
  "en",
  "the staff dashboard does NOT inherit my/th after a customer used this browser",
);

// A provider that mounts over an already-non-default document restores that.
const odd = { lang: "zh-Hant" };
applyDocumentLanguage(odd, "th")();
assert.equal(odd.lang, "zh-Hant", "whatever was there is what comes back");

assert.ok(
  contextSource.includes(
    "useEffect(() => applyDocumentLanguage(document.documentElement, language)",
  ),
  "the provider returns the restore as its effect cleanup",
);
assert.ok(
  readFileSync("src/routes/__root.tsx", "utf8").includes('<html lang="en">'),
  "the root stays English — only a mounted customer provider changes it",
);

/* ── 8. Parameterised and plural copy ──────────────────────────────────── */

assert.equal(formatCopy("{count} sections", { count: 6 }), "6 sections");
assert.equal(formatCopy("no placeholders", { count: 6 }), "no placeholders");
assert.equal(formatCopy("{count} sections"), "{count} sections", "no params leaves the template");
assert.equal(formatCopy("{a} and {b}", { a: "x", b: "y" }), "x and y");
assert.equal(
  formatCopy("{missing} here", { other: 1 }),
  "{missing} here",
  "an unknown placeholder stays VISIBLE so the mistake is caught in review",
);

// Whole phrases per form — never "{count}" glued to a hardcoded English noun.
const plural = { en: { one: "{count} section", other: "{count} sections" } };
assert.equal(selectCopy(plural, "en", { count: 1 }), "1 section");
assert.equal(selectCopy(plural, "en", { count: 6 }), "6 sections");
assert.equal(selectCopy(plural, "en", { count: 0 }), "0 sections");
assert.equal(selectCopy(plural, "en"), "{count} sections", "no count given uses the general form");
// Burmese and Thai have ONE form; Intl.PluralRules knows that, we do not
// encode it. An untranslated entry still falls back through English's rules.
assert.equal(selectCopy(plural, "my", { count: 1 }), "1 section");
assert.equal(
  selectCopy({ ...plural, my: "{count} ကဏ္ဍ" }, "my", { count: 6 }),
  "6 ကဏ္ဍ",
  "a single-form language uses its one phrase for every count",
);
assert.equal(
  selectCopy({ ...plural, th: { one: "  ", other: "{count} ส่วน" } }, "th", { count: 1 }),
  "1 ส่วน",
  "a blank plural form falls back within the same language before English",
);
assert.equal(
  translate("categoryRail.sectionCount", "en", { count: 6 }),
  "6 sections",
  "the wired example works end to end",
);
assert.ok(
  readFileSync("src/components/menu/CategoryRail.tsx", "utf8").includes(
    't("categoryRail.sectionCount", { count: CATEGORIES.length })',
  ),
  "the section count is one translatable phrase, not a number beside an English word",
);

/* ── 9. Recovery copy promises no text keywords ────────────────────────── */

// The Messenger flow is driven by quick-reply PAYLOADS. Nothing establishes
// that typing "menu" or "start order" does anything, so the copy must not say
// it does.
for (const promise of [">menu<", ">order<", ">start order<", "start order"]) {
  assert.ok(
    !noticeSource.includes(promise),
    `the recovery copy no longer promises the text keyword ${JSON.stringify(promise)}`,
  );
}
assert.ok(
  noticeSource.includes('t("session.reopenOptions"') &&
    noticeSource.includes('t("session.reopenOptionsGeneric")'),
  "recovery copy is resolved through the seam, in the customer's language",
);
const recovery = COPY["session.reopenOptions"].en;
assert.ok(
  recovery.includes("send any message"),
  "it tells the customer to do the thing that IS implemented — any message re-triggers the greeting",
);
assert.ok(recovery.includes("Place an Order"), "and names the quick reply they should then choose");
assert.ok(recovery.includes("{platform}"), "the platform is a parameter, not a concatenation");
assert.ok(
  !/\bstart order\b/i.test(recovery) && !/\btype\b/i.test(recovery),
  "no executable text keyword is promised",
);

/* ── 10. The picker, the cart, and staff isolation ─────────────────────── */

assert.equal(LANGUAGE_NAMES.en, "English");
assert.equal(LANGUAGE_NAMES.my, "မြန်မာ", "Myanmar is labelled in Burmese");
assert.equal(LANGUAGE_NAMES.th, "ไทย", "Thai is labelled in Thai");

assert.notEqual(LANGUAGE_STORAGE_KEY, "tp_cart", "the language key is not the cart key");
assert.ok(
  LANGUAGE_STORAGE_KEY.startsWith("tp."),
  "the language key is namespaced so it cannot collide with staff keys",
);
assert.ok(
  !/tp_cart|setCart|addToCart/.test(switchSource),
  "the language switch cannot reach the cart",
);
assert.ok(!/tp_cart|setCart/.test(contextSource), "the language provider cannot reach the cart");
assert.ok(
  !/<LanguageProvider[^>]*\bkey=/.test(readFileSync("src/routes/index.tsx", "utf8")),
  "the provider is not keyed — a remount would discard the cart",
);
assert.ok(
  !/<LanguageProvider[^>]*\bkey=/.test(secureRouteSource),
  "the secure route's provider is not keyed either",
);
assert.ok(
  menuSource.includes('localStorage.getItem("tp_cart")'),
  "the cart still restores from its own key, untouched by this package",
);

for (const staffRoute of ["src/routes/staff.tsx", "src/routes/owner.tsx"]) {
  const source = readFileSync(staffRoute, "utf8");
  assert.ok(
    !/LanguageProvider|useT\(|FunctionalZh|from "@\/lib\/i18n/.test(source),
    `${staffRoute} does not consume the customer language seam`,
  );
}

console.log("test-i18n: all assertions passed");
