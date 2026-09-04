// Customer language: the seam, with no React and no globals reached for
// implicitly.
//
// THE CHINESE ON THIS MENU IS TWO DIFFERENT THINGS. An earlier version of this
// file claimed all of it was brand; that was wrong, and getting it wrong is
// what a Burmese or Thai customer would have paid for.
//
//   IDENTITY   — 第三空間, the 訂 chop, the restaurant's own name. Who the
//                place IS. Preserved in every language, untouched.
//   FUNCTIONAL — 招牌/串燒 category names, 堂食/自取/外送, 暫時售罄,
//                訂單已送出, 連結已過期, 再下一單. These CARRY INFORMATION and
//                today each sits beside an English phrase saying the same
//                thing. English mode keeps that pairing; Myanmar and Thai show
//                the selected language ALONE, because repeating the message in
//                a third language the customer did not choose is noise.
//
// `showFunctionalChinese` below is that policy in one predicate, and
// ../components/menu/ChineseText.tsx is the pair of components that apply it.
// Chinese is never a SELECTABLE language either way — `parseLanguage` refuses
// "zh", and the suite asserts it.
//
// Every reader is passed in (search string, storage, document) rather than
// read off `window` inside, for the same reason
// ./components/menu/keyboardInset.ts takes its viewport as an argument: a test
// can then drive the whole thing with plain values and no DOM.

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
 * A phrase, or its singular and plural forms.
 *
 * Each form is a COMPLETE phrase. Copy is never assembled by concatenating an
 * English fragment with a number, because word order, measure words and
 * pluralisation all differ across en/my/th and a sentence glued together in
 * English shape cannot be translated correctly.
 */
export type CopyValue = string | { readonly one: string; readonly other: string };

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
  readonly en: CopyValue;
  readonly my?: CopyValue;
  readonly th?: CopyValue;
}

/**
 * Values substituted into `{name}` placeholders. `count` is special: when it
 * is a number it also selects the plural form.
 */
export interface CopyParams {
  readonly [name: string]: string | number;
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
  /* ── Language picker ─────────────────────────────────────────────────── */
  "language.label": { en: "Language" },

  /* ── Hero ────────────────────────────────────────────────────────────── */
  // Paired with the functional 菜單 in English mode.
  "hero.menuLabel": { en: "Menu" },
  "hero.openNow": { en: "Open now" },
  "hero.logoAlt": { en: "The Third Place — Chinese BBQ & Lounge" },
  "hero.tagline": { en: "Chinese BBQ made for sharing." },
  "hero.nearby": { en: "Near Assumption University" },
  // Digits, but the dash and any AM/PM convention are not universal, so it
  // stays translatable rather than being assumed locale-free.
  "hero.hours": { en: "11:00 — 23:00" },

  /* ── Order type / service rail ───────────────────────────────────────── */
  "orderType.ariaLabel": { en: "Order type" },
  "orderType.dineIn": { en: "Dine In" },
  "orderType.pickup": { en: "Pick Up" },
  "orderType.delivery": { en: "Delivery" },
  "serviceRail.popular": { en: "Popular" },

  /* ── Category rail ───────────────────────────────────────────────────── */
  "categoryRail.ariaLabel": { en: "Menu sections" },
  "categoryRail.heading": { en: "Menu" },
  // Plural entry: both forms are whole phrases.
  "categoryRail.sectionCount": {
    en: { one: "{count} section", other: "{count} sections" },
  },

  /* ── Menu screen ─────────────────────────────────────────────────────── */
  "menu.browseOnlyBanner": {
    en: "Browse only — read the full menu here. Ordering stays off until you ask for it.",
  },
  "menu.browseOnlyHint": { en: "Tap “Order Now” below when you are ready." },
  "menu.orderNow": { en: "Order Now" },
  "menu.availabilityWarning": {
    en: "Live availability couldn't refresh — a few items may have just sold out. Staff will confirm your order.",
  },
  "menu.sectionEmpty": { en: "Nothing in this section is available right now." },
  "menu.sectionEmptyHint": { en: "Please try another section, or ask our staff." },
  "section.eyebrowChefsTable": { en: "Chef's Table" },
  "section.eyebrowDefault": { en: "Section" },

  /* ── Item card ───────────────────────────────────────────────────────── */
  "item.priceAskStaff": { en: "Price · ask staff" },
  "item.soldOut": { en: "Sold out" },
  "item.bestSeller": { en: "Best Seller" },
  // Accessible names are whole phrases with the item name inserted — never
  // an English verb concatenated onto a translated noun.
  "item.addAria": { en: "Add {item} to your order" },
  "item.addAnotherAria": { en: "Add another {item}" },
  "item.removeOneAria": { en: "Remove one {item}" },

  /* ── Cart bar ────────────────────────────────────────────────────────── */
  "cart.yourOrder": { en: "Your order" },
  "cart.itemAdded": { en: "Item added" },
  "cart.readyToReview": { en: "Ready to review" },
  "cart.removeSoldOut": { en: "Remove sold-out" },
  "cart.viewCart": { en: "View Cart →" },

  /* ── Checkout ────────────────────────────────────────────────────────── */
  "checkout.reviewOrder": { en: "Review Order" },
  "checkout.clear": { en: "Clear" },
  "checkout.tapAgainToClear": { en: "Tap again to clear" },
  "checkout.soldOutBlock": {
    en: "Some items just sold out — please remove them from your cart first.",
  },
  "checkout.errTableRequired": { en: "Table number is required" },
  "checkout.errNameRequired": { en: "Name is required" },
  "checkout.errPhoneRequired": { en: "Phone is required" },
  "checkout.errAddressRequired": { en: "Delivery address is required" },
  "checkout.fieldTableNumber": { en: "Table number" },
  "checkout.fieldName": { en: "Name" },
  "checkout.fieldPhone": { en: "Phone number" },
  "checkout.fieldAddress": { en: "Delivery address" },
  "checkout.fieldNotes": { en: "Order notes (optional)" },
  "checkout.subtotal": { en: "Subtotal" },
  "checkout.deliveryFee": { en: "Delivery fee" },
  "checkout.placeOrder": { en: "Place order" },
  "checkout.sending": { en: "Sending order…" },
  "checkout.close": { en: "Close" },
  "checkout.orderReceived": { en: "Order received" },
  "checkout.itemsHeading": { en: "Items" },
  "checkout.tableLabel": { en: "Table" },
  "checkout.total": { en: "Total" },
  "checkout.remove": { en: "Remove" },
  "checkout.emptyCart": { en: "Your order is empty." },
  "checkout.emptyCartHint": { en: "Close this and add a dish to begin." },
  "checkout.howToServe": { en: "How to serve it" },
  "checkout.itemCount": { en: { one: "{count} item", other: "{count} items" } },
  // Placeholders are examples, not labels: a Thai address example is not a
  // useful hint to a Burmese reader, so they are translatable like any copy.
  "checkout.phTable": { en: "e.g. 12" },
  "checkout.phName": { en: "e.g. Somchai" },
  "checkout.phPhone": { en: "e.g. 081 234 5678" },
  "checkout.phAddress": { en: "e.g. 88 Soi Bangna 12, Bang Na" },
  "checkout.phNotes": { en: "e.g. less spicy, no peanuts" },

  /* ── Order confirmation ──────────────────────────────────────────────── */
  "success.prepareShortly": { en: "Staff will prepare it shortly." },
  "success.confirmPickup": { en: "Staff will confirm when it is ready for pickup." },
  "success.confirmDelivery": { en: "Staff will confirm delivery and payment." },
  "success.keepPhoneAvailable": {
    en: "Please keep your phone available — staff may call to confirm.",
  },
  // The fee is a parameter: its amount is configuration, not copy.
  "success.deliveryFeeIncluded": {
    en: "The ฿{fee} delivery fee is included in your total.",
  },
  "success.paymentViaStaffChat": { en: "Payment confirmation may happen through staff chat." },

  /* ── Secure-link terminal states ─────────────────────────────────────── */
  "session.completedTitle": { en: "Order received" },
  "session.completedBlurb": {
    en: "This link has already been used for your order. It can't place another one.",
  },
  "session.expiredTitle": { en: "This link has expired" },
  "session.expiredBlurb": { en: "Secure menu links stay open for 24 hours. This one has closed." },
  "session.revokedTitle": { en: "This link was replaced" },
  "session.revokedBlurb": {
    en: "A newer menu link was sent to your chat. Please use the most recent one.",
  },
  "session.invalidTitle": { en: "This link isn't valid" },
  "session.invalidBlurb": {
    en: "The link may be incomplete, or it was opened without its secure part.",
  },
  "session.orderLabel": { en: "Order" },
  "session.startNewHeading": { en: "Start New Order" },
  "session.startNewButton": { en: "Start New Order on {platform}" },
  "session.startNewButtonGeneric": { en: "Start New Order" },
  "session.openSameConversation": {
    en: "Open the same conversation you received this link in.",
  },
  "session.browsePublicMenu": { en: "Browse Public Menu" },
  "session.browseDisclaimer": {
    en: "This opens our normal web menu. An order placed there is a direct web order and is not connected to your {platform} chat with us.",
  },
  "session.browseDisclaimerGeneric": {
    en: "This opens our normal web menu. An order placed there is a direct web order and is not connected to your chat with us.",
  },
  // Recovery copy. It must not promise that typing a keyword does anything:
  // the Messenger flow is driven by quick-reply payloads (ORDER_START,
  // SHOW_MENU …), and no text-keyword handler is established. Sending ANY
  // message re-triggers the greeting branch, which is what this now says.
  "session.reopenOptions": {
    en: "Go back to your {platform} chat with us and send any message — we'll show your options again, including Place an Order.",
  },
  "session.reopenOptionsGeneric": {
    en: "Go back to your chat with us and send any message — we'll show your options again, including Place an Order.",
  },

  /* ── Secure-link loading / failure ───────────────────────────────────── */
  "secureMenu.didntLoad": { en: "This didn't load" },
  "secureMenu.didntLoadBlurb": {
    en: "We couldn't check your link just now. Your link is still fine — please try again.",
  },
  "secureMenu.tryAgain": { en: "Try again" },
  "secureMenu.opening": { en: "Opening your menu" },

  /* ── Static catastrophic error page (no React, no client JS) ─────────── */
  "errorPage.title": { en: "This page didn't load" },
  "errorPage.blurb": {
    en: "Something went wrong on our end. You can try refreshing or head back home.",
  },
  "errorPage.tryAgain": { en: "Try again" },
  "errorPage.goHome": { en: "Go home" },
} satisfies Record<string, CopyEntry>;

export type CopyKey = keyof typeof COPY;

/** A string that actually says something. An empty or whitespace-only
 *  translation is treated as ABSENT, not as copy — a translator leaving a cell
 *  blank must fall back to English, never blank the customer's screen. */
export const nonBlankText = (value: string | null | undefined): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;

/** Internal alias kept short for the copy paths below. */
const nonBlank = nonBlankText;

/** The raw text of a value, ignoring blankness — the last resort that keeps
 *  the return type total. */
const rawText = (value: CopyValue): string => (typeof value === "string" ? value : value.other);

/**
 * The form of `value` for `count`, in `language`'s own plural rules — English
 * distinguishes one from other, Myanmar and Thai have a single form, and
 * Intl.PluralRules already knows that so we do not encode it ourselves.
 * Returns undefined when the chosen form is missing or blank.
 */
function pluralForm(
  value: CopyValue | undefined,
  language: Language,
  count: number | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return nonBlank(value);
  if (count === undefined) return nonBlank(value.other);
  return new Intl.PluralRules(language).select(count) === "one"
    ? (nonBlank(value.one) ?? nonBlank(value.other))
    : nonBlank(value.other);
}

/**
 * Substitutes `{name}` placeholders. An unknown placeholder is left VISIBLE
 * rather than silently replaced with nothing, so a missing parameter shows up
 * in review instead of shipping a sentence with a hole in it.
 */
export function formatCopy(text: string, params?: CopyParams): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/**
 * The selection rule, on its own so it can be proved against fixtures rather
 * than against shipped copy — no invented Myanmar or Thai has to exist in the
 * dictionary for a test to show that a present translation is actually used.
 *
 * Order: the language's own form, else English, else English's raw text. The
 * last step cannot normally be reached (the suite asserts every entry's
 * English is non-blank) and exists so the return type is `string`, never
 * `string | undefined`.
 */
export function selectCopy(entry: CopyEntry, language: Language, params?: CopyParams): string {
  const count = typeof params?.count === "number" ? params.count : undefined;
  const text =
    pluralForm(entry[language], language, count) ??
    pluralForm(entry.en, "en", count) ??
    rawText(entry.en);
  return formatCopy(text, params);
}

/**
 * Copy in `language`, falling back to English for any key not yet translated.
 * Total by construction: the return type is `string`, not `string | undefined`.
 */
export function translate(key: CopyKey, language: Language, params?: CopyParams): string {
  return selectCopy(COPY[key], language, params);
}

/* ── Chinese on the customer menu: an explicit policy ──────────────────── */

/**
 * IDENTITY marks — the restaurant's own name and seals (第三空間, the 訂 chop,
 * "The Third Place"). These are WHO THE PLACE IS, not information about an
 * order, so they are preserved in every language exactly as they are. They
 * carry lang="zh-Hant" because they are real Chinese, not decoration.
 *
 * FUNCTIONAL Chinese — 招牌/串燒 category names, 堂食/自取/外送, 暫時售罄,
 * 訂單已送出, 連結已過期, 再下一單 and the rest. These CARRY INFORMATION, and
 * today each one sits beside an English phrase that says the same thing.
 *
 * The rule:
 *   - English mode keeps the existing English + 中文 pairing, and the Chinese
 *     half is aria-hidden because the English beside it already says it;
 *   - Myanmar and Thai mode show the selected language ALONE. Leaving the
 *     Chinese there would hand a Burmese customer a second language they did
 *     not ask for and did not choose, next to their own.
 *
 * `showFunctionalChinese` is the whole policy in one predicate so there is one
 * place to change it, and so a component cannot quietly decide otherwise.
 */
export function showFunctionalChinese(language: Language): boolean {
  return language === "en";
}

/* ── Document language ─────────────────────────────────────────────────── */

/** Just the bit of `document.documentElement` this needs — so a test can pass
 *  `{ lang: "en" }` and observe the whole lifecycle without a DOM. */
export interface DocumentLanguageTarget {
  lang: string;
}

/**
 * Sets the document language and returns the undo.
 *
 * The undo matters: the customer provider is mounted per route, so when a
 * customer navigates to /staff the provider unmounts and MUST put the document
 * language back. Without this a staff member on a shared browser inherits
 * lang="my" on an English/Chinese dashboard.
 */
export function applyDocumentLanguage(
  target: DocumentLanguageTarget,
  language: Language,
): () => void {
  const previous = target.lang;
  target.lang = language;
  return () => {
    target.lang = previous;
  };
}

/* ── The ?lang= handoff ────────────────────────────────────────────────── */

/** Whether a search string carries a `lang` parameter at all — valid or not. */
export function hasLanguageParam(search: string | null | undefined): boolean {
  if (typeof search !== "string" || search === "") return false;
  try {
    return new URLSearchParams(search).has(LANGUAGE_QUERY_PARAM);
  } catch {
    return false;
  }
}

/**
 * The same search string with `lang` set to `language`, preserving every other
 * parameter and their order.
 *
 * This is what stops a URL from continuing to force the language a customer
 * has since changed with the picker: arriving on `?lang=my` and choosing Thai
 * rewrites the URL to `?lang=th`, so a refresh keeps Thai. Rewriting the
 * parameter (rather than deleting it) also means the choice survives a browser
 * that refuses localStorage.
 */
export function withLanguageParam(search: string | null | undefined, language: Language): string {
  const params = new URLSearchParams(typeof search === "string" ? search : "");
  params.set(LANGUAGE_QUERY_PARAM, language);
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}
