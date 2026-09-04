// Customer language: the seam, with no React and no globals reached for
// implicitly.
//
// WHAT THIS IS NOT. The Chinese already on the customer menu ("菜單 · Menu",
// ORDER_TYPE_ZH, CATEGORY_ZH, the 訂 seal) is BRAND, not localisation. It is
// shown NEXT TO the English at all times because this is a Chinese BBQ house,
// and it stays exactly as it is in every language. What this module localises
// is the English copy slot only. Translating the brand Chinese away, or
// treating zh as a fourth switchable language, would delete the restaurant's
// identity from its own menu — so neither is possible through this API.
//
// Every reader is passed in (search string, storage) rather than read off
// `window` inside, for the same reason ./components/menu/keyboardInset.ts
// takes its viewport as an argument: a test can then drive the whole thing
// with plain values and no DOM.

export const LANGUAGES = ["en", "my", "th"] as const;

export type Language = (typeof LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = "en";

/** Endonyms — a language picker a customer cannot read is not a picker. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: "English",
  my: "မြန်မာ",
  th: "ไทย",
};

/** Where the customer's choice persists. Namespaced so it cannot collide
 *  with the staff dashboard's own keys on a shared browser. */
export const LANGUAGE_STORAGE_KEY = "tp.customer.lang";

/** The query parameter the Messenger order link will carry (Phase 5). */
export const LANGUAGE_QUERY_PARAM = "lang";

/**
 * A supported language, or null. Never throws, never guesses: an unknown,
 * empty or malformed value is null so the caller falls back deliberately
 * rather than rendering copy in a language nobody asked for.
 */
export function parseLanguage(value: string | null | undefined): Language | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim().toLowerCase();
  return (LANGUAGES as readonly string[]).includes(candidate) ? (candidate as Language) : null;
}

/** The `?lang=` of a query string, or null. Accepts the full search string
 *  ("?lang=my") or a bare one ("lang=my"). */
export function languageFromSearch(search: string | null | undefined): Language | null {
  if (typeof search !== "string" || search === "") return null;
  try {
    return parseLanguage(new URLSearchParams(search).get(LANGUAGE_QUERY_PARAM));
  } catch {
    return null;
  }
}

/** Minimal shape we need — so a test can pass a plain object, and so a
 *  browser with storage disabled is just "no preference". */
export interface LanguageStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readStoredLanguage(storage: LanguageStore | null | undefined): Language | null {
  if (!storage) return null;
  try {
    return parseLanguage(storage.getItem(LANGUAGE_STORAGE_KEY));
  } catch {
    // Private mode and "block site data" both throw on access rather than
    // returning null. A customer who cannot persist still gets a menu.
    return null;
  }
}

export function storeLanguage(language: Language, storage: LanguageStore | null | undefined): void {
  if (!storage) return;
  try {
    storage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Non-fatal by design: the choice still applies to this page view.
  }
}

/**
 * The language a customer page starts in.
 *
 * PRECEDENCE: `?lang=` beats the stored preference, which beats English.
 * The link wins because it is the more recent, more specific instruction —
 * Phase 5 will mint the Messenger order link with the language the customer
 * just chose in chat, and that must not be overridden by a preference left
 * in this browser weeks ago.
 */
export function resolveInitialLanguage(input: {
  search?: string | null;
  storage?: LanguageStore | null;
}): Language {
  return languageFromSearch(input.search) ?? readStoredLanguage(input.storage) ?? DEFAULT_LANGUAGE;
}

/**
 * One piece of customer copy.
 *
 * `en` is REQUIRED and the others are optional, which is the whole safety
 * property: a key cannot exist without English, so `translate` can always
 * return a real string and no customer ever sees `undefined`. It also lets
 * Myanmar and Thai land key-by-key as translators return them, without a
 * half-translated dictionary failing the build.
 */
export interface CopyEntry {
  readonly en: string;
  readonly my?: string;
  readonly th?: string;
}

/**
 * The customer copy dictionary.
 *
 * DELIBERATELY SMALL. This package establishes the seam and wires a
 * representative slice through it; the remaining ~100 strings are inventoried
 * in project/translation-inventory.csv and are extracted only after the seam
 * has been reviewed. Adding a key here is the whole cost of localising one
 * string later.
 *
 * `satisfies` (not a type annotation) so `CopyKey` stays the literal union of
 * these keys — a typo at a call site is a compile error, not a blank label.
 */
export const COPY = {
  "cart.yourOrder": { en: "Your order" },
  "cart.itemAdded": { en: "Item added" },
  "cart.readyToReview": { en: "Ready to review" },
  "cart.removeSoldOut": { en: "Remove sold-out" },
  "cart.viewCart": { en: "View Cart →" },
  "menu.sectionEmpty": { en: "Nothing in this section is available right now." },
  "menu.sectionEmptyHint": { en: "Please try another section, or ask our staff." },
  "language.label": { en: "Language" },
} satisfies Record<string, CopyEntry>;

export type CopyKey = keyof typeof COPY;

/**
 * The selection rule, on its own so it can be proved against fixtures rather
 * than against shipped copy — no invented Myanmar or Thai has to exist in the
 * dictionary for a test to show that a present translation is actually used.
 */
export function selectCopy(entry: CopyEntry, language: Language): string {
  return entry[language] ?? entry.en;
}

/**
 * Copy in `language`, falling back to English for any key not yet translated.
 * Total by construction: the return type is `string`, not `string | undefined`.
 */
export function translate(key: CopyKey, language: Language): string {
  return selectCopy(COPY[key], language);
}
