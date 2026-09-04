# Menu content model — what the owner can change, and what needs code

Written for the pilot. It records the boundaries deliberately drawn in Phase 3B
so nobody has to re-derive them from the code, and so nobody promises the owner
something the system does not do.

## The two identities

| | `item_code` | `name_en` |
|---|---|---|
| What it is | The **immutable operational identity** of a menu item (`"A01"`). | **Editable English text.** The canonical display name. |
| Who may change it | Nobody, once an order has referenced it. | The owner, in the Supabase table editor. |
| What keys on it | The order intake route, which prices every line from `menu_items`; the n8n automation; `menu_items.item_code`; the compiled `MENU` list. | Nothing. It is shown, and it travels in the n8n rollback payload as a label. |

**Integrations must key on `item_code`, never on a name.** The Supabase intake
body is `{ itemCode, quantity }` and the server recomputes every price from the
table. `name_en` is a caption that happens to be canonical — renaming a dish is
safe; renaming a *code* is not, and nothing in the app offers to.

Localised names (`name_my`, `name_th`) are display only. `LocalizedMenuItem`
keeps `canonicalName` and `displayName` as separate fields precisely so a
Burmese name cannot reach the automation as an unrecognised product.

## What the owner can change without a release

In the Supabase table editor, per row of `menu_items`:

- `name_en`, `name_my`, `name_th`
- `description_en`, `description_my`, `description_th`
- `unit` (the portion wording on every card)
- `image_url` (https only — enforced by a CHECK and re-validated in the app)
- `price`, `availability_status` / `is_available`, `sort_order` (already the case
  before this work; availability also has a staff screen)

Blank counts as absent everywhere: an empty or whitespace-only column falls back
to the next source rather than rendering an empty label.

## What still needs code

**Categories are code-defined.** `MenuCategoryId` is a TypeScript union that
drives the rail icons, the section layout and the feature/row/compact card
variants. There are six, in `src/data/menu.ts`.

- The owner **cannot add, remove or re-order a structural category** in
  Supabase. That is a code change and a release.
- Category **display names and blurbs**, in all three languages, also live in
  `src/data/menu.ts` (`nameEn`/`nameMy`/`nameTh`, `blurb`/`blurbMy`/`blurbTh`)
  and are resolved by `localizeCategory`. Renaming or translating a category is
  a content-file edit, not a database one.

This was chosen over a categories table (a join for six rows) and over copying
translated category names onto all 38 item rows (redundant, and it would drift).
It is a pilot decision, recorded so it can be revisited deliberately.

**A row added only in Supabase does not appear on the customer menu.** The
customer collection starts from the compiled `MENU` list and overlays the live
rows onto it; a database row with no compiled counterpart is simply not
iterated. Adding a *new dish* is therefore a code change plus a release, and the
preflight reports such rows under "EXTRA codes" so they are noticed rather than
silently ignored.

The seed never inserts, for the same reason: what is on the menu is a decision,
not something a migration should make.

## Where each field comes from at render time

Resolution order, per field, in `src/lib/menuContent.ts`:

1. the live `menu_items` row's content column, if non-blank;
2. the compiled row in `src/data/menu.ts` for that language, if non-blank;
3. English, by the same rule;
4. for a name with nothing else: the `item_code`.

`price` and availability are different, and deliberately so:

- **A live row is present** → its price governs. If it is `0`, negative or
  absent, the item shows "ask staff" and **cannot be ordered**. The compiled
  price is *not* substituted: presenting a plausible figure for an item whose
  operational record has none is how a customer ends up paying against a number
  nobody set.
- **No live row** (read failed, or the item is not in the table) → the compiled
  price is used. It is the last known good value, the alternative is a menu with
  no prices, and the server recomputes every total at intake regardless.

## Hidden, sold out, and the cart

`Hidden` removes an item from the **browse list only**. Cart lines resolve
against the unfiltered collection, so an item already in someone's cart when
staff hide it stays visible there — blocked, with a Remove button, contributing
nothing to the total. It does not silently vanish out of an order the customer
has already built.

The same is true of an item that goes Sold Out or loses its price.

## When the read is degraded

If the availability read fails, the screen keeps rendering from the compiled
menu and tells the customer plainly that live availability could not refresh —
on **every** failure, not only the first. The technical reason goes to the
console; none of it reaches the page.

This is deliberate fail-open, and it is safe because the server re-prices and
re-validates every order at intake. What is *not* allowed is implying the data
is verified when it is not, which is why the banner is tied to the read state
rather than to the first attempt.
