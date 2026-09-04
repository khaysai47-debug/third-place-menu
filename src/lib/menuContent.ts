// Menu content: what the customer READS, kept strictly apart from what the
// order SUBMITS.
//
// THE RULE THIS FILE EXISTS TO ENFORCE. `id` and `canonicalName` are the
// operational identity of a line — `id` is the item_code the intake route
// prices the order from, and `canonicalName` is the English name the n8n
// rollback path still sends. `displayName` and `description` are what the
// customer sees, and they change with the language picker. Nothing in a cart
// line or an order payload may ever be built from `displayName`: a Burmese
// item name reaching the automation would arrive as an unrecognised product.
//
// SOURCE OF TRUTH, in order:
//   1. Supabase menu_items — the owner's menu, editable in the table editor.
//   2. src/data/menu.ts — a typed fallback compiled into the bundle. It is
//      what renders when the database read fails, so the menu never goes
//      blank and ordering never white-screens.
// A blank column in the database is treated as ABSENT, not as content, so a
// half-filled row falls back field by field rather than showing empty labels.
//
// CATEGORIES ARE CODE, NOT DATA. MenuCategoryId is a typed union that drives
// the rail icons, the section layout and the feature/row/compact variants, so
// adding a category is already a code change. Six of them are kept in
// src/data/menu.ts rather than given their own table or — worse — copied onto
// all 38 item rows.

import { nonBlankText, type Language } from "./i18n";
import type { MenuCategory, MenuCategoryId, MenuItem } from "../data/menu";

/**
 * The per-item content columns of Supabase `menu_items`.
 *
 * Every field optional: the migration adds these columns empty, and rows are
 * filled in during onboarding. An unmigrated database simply supplies none of
 * them and the local fallback answers for everything.
 */
export interface MenuItemContent {
  readonly nameEn?: string;
  readonly nameMy?: string;
  readonly nameTh?: string;
  readonly descriptionEn?: string;
  readonly descriptionMy?: string;
  readonly descriptionTh?: string;
  readonly imageUrl?: string;
  readonly unit?: string;
}

/** One menu item, resolved for a language and ready to render. */
export interface LocalizedMenuItem {
  /** CANONICAL. The item_code. Never localised, never derived from display. */
  readonly id: string;
  /** CANONICAL English name — the only name any payload may carry. */
  readonly canonicalName: string;
  /** What the customer reads. Localised. Never submitted. */
  readonly displayName: string;
  readonly description: string;
  readonly unit?: string;
  readonly imageUrl?: string;
  /** undefined means "ask staff" — never invented, never defaulted to 0. */
  readonly price?: number;
  readonly available: boolean;
  readonly category: MenuCategoryId;
  readonly popular: boolean;
  readonly order: number;
  readonly tags?: readonly string[];
}

/** First candidate that actually says something. One blank rule for the whole
 *  app — the same one the copy dictionary uses. */
function pick(...candidates: (string | null | undefined)[]): string | undefined {
  for (const candidate of candidates) {
    const value = nonBlankText(candidate);
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * A photo URL we are willing to put on the page.
 *
 * HTTPS only, no embedded credentials, bounded — the same shape of check the
 * payment QR gets in api/_lib/orderDetails.server.ts, and for the same reason:
 * this value comes from a database row an operator typed, and a malformed one
 * must answer "no image" rather than render something unexpected.
 */
export function approvedImageUrl(value: string | null | undefined): string | undefined {
  const raw = nonBlankText(value);
  if (raw === undefined || raw.length > 2_000 || /\s/.test(raw)) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return undefined;
    if (url.hostname === "" || url.username !== "" || url.password !== "") return undefined;
  } catch {
    return undefined;
  }
  return raw;
}

/**
 * A price we are willing to show.
 *
 * The database read maps a missing/non-numeric price to 0, which would put
 * "฿0" on a card. Only a finite positive number is accepted from the row;
 * anything else falls through to the compiled fallback, and if that has none
 * either the card says "Price · ask staff" rather than inventing a figure.
 */
function usablePrice(...candidates: (number | undefined)[]): number | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Resolve one item for a language.
 *
 * `fallback` is the compiled row; `content` is the database row's content
 * columns when there is one. Name and description resolve
 * database-then-fallback WITHIN the language first, then through English —
 * so a row translated in Supabase wins, a row translated only in the bundle
 * still shows, and an untranslated item shows English rather than nothing.
 */
export function localizeMenuItem(
  fallback: MenuItem,
  content: MenuItemContent | undefined,
  language: Language,
  availability?: { available: boolean; price?: number },
): LocalizedMenuItem {
  const canonicalName = pick(content?.nameEn, fallback.nameEn) ?? fallback.id;
  const englishDescription = pick(content?.descriptionEn, fallback.descriptionEn) ?? "";

  const displayName =
    language === "my"
      ? (pick(content?.nameMy, fallback.nameMy, canonicalName) ?? canonicalName)
      : language === "th"
        ? (pick(content?.nameTh, fallback.nameTh, canonicalName) ?? canonicalName)
        : canonicalName;

  const description =
    language === "my"
      ? (pick(content?.descriptionMy, fallback.descriptionMy, englishDescription) ?? "")
      : language === "th"
        ? (pick(content?.descriptionTh, fallback.descriptionTh, englishDescription) ?? "")
        : englishDescription;

  return {
    id: fallback.id,
    canonicalName,
    displayName,
    description,
    unit: pick(content?.unit, fallback.unit),
    imageUrl: approvedImageUrl(content?.imageUrl),
    price: usablePrice(availability?.price, fallback.price),
    available: availability?.available ?? fallback.available,
    // Taxonomy stays with the compiled row: it is a typed union driving icons
    // and layout, not free text from a database column.
    category: fallback.category,
    popular: fallback.popular,
    order: fallback.order,
    tags: fallback.tags,
  };
}

/** The category name and blurb for a language, English when untranslated. */
export function localizeCategory(
  category: MenuCategory,
  language: Language,
): { name: string; blurb: string } {
  const name =
    language === "my"
      ? (pick(category.nameMy, category.nameEn) ?? category.nameEn)
      : language === "th"
        ? (pick(category.nameTh, category.nameEn) ?? category.nameEn)
        : category.nameEn;
  const blurb =
    language === "my"
      ? (pick(category.blurbMy, category.blurb) ?? category.blurb)
      : language === "th"
        ? (pick(category.blurbTh, category.blurb) ?? category.blurb)
        : category.blurb;
  return { name, blurb };
}
