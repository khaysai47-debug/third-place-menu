-- ============================================================================
-- Menu content seed — 38 items (generated 2026-09-04)
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
    ('A01', 'Tender beef skewers seasoned with Yunnan spices, grilled over open flame.', NULL::text, NULL::text, 'နွားသားကင်', NULL::text, 'x4 skewers'),
    ('A02', 'Tender beef honeycomb tripe skewers with aromatic spice seasoning.', NULL::text, NULL::text, 'နွားဗိုက်ပိုးကင်', NULL::text, 'x3 skewers'),
    ('A03', 'Juicy chicken skewer grilled with house seasoning.', NULL::text, NULL::text, 'ကြက်သားကင်', NULL::text, 'per skewer'),
    ('A04', 'Crispy grilled chicken wing with smoky char.', NULL::text, NULL::text, 'ကြက်တောင်ကင်', NULL::text, 'per skewer'),
    ('A05', 'Grilled chicken heart skewer with light seasoning.', NULL::text, NULL::text, 'ကြက်နှလုံးကင်', NULL::text, 'per skewer'),
    ('A06', 'Chewy grilled chicken gizzard with savory seasoning.', NULL::text, NULL::text, 'ကြက်ဝမ်းစိမ်းကင်', NULL::text, 'per skewer'),
    ('A07', 'Crispy grilled chicken skin — light and crunchy.', NULL::text, NULL::text, 'ကြက်သားအရေကင်', NULL::text, 'per skewer'),
    ('A08', 'Signature Yunnan-style chicken drumstick marinated in secret spice blend.', NULL::text, NULL::text, 'ယူနန်ကြက်ခြေထောက်', NULL::text, 'per skewer'),
    ('A09', 'Juicy mutton skewers with aromatic cumin and chili marinade.', NULL::text, NULL::text, 'သိုးသားကင်', NULL::text, 'x3 skewers'),
    ('A10', 'Thinly sliced pork ear grilled until tender with a satisfying crunch.', NULL::text, NULL::text, 'ဝက်နားကင်', NULL::text, 'per skewer'),
    ('A11', 'Tender sliced pork tongue grilled with seasoning.', NULL::text, NULL::text, 'ဝက်လျှာကင်', NULL::text, 'per skewer'),
    ('A12', 'Three-layer pork belly skewer, fatty and flavourful.', NULL::text, NULL::text, 'ဝက်ဝမ်းဗိုက်ကင်', NULL::text, 'per skewer'),
    ('A13', 'Grilled pork skin — crispy outside, chewy inside.', NULL::text, NULL::text, 'ဝက်သားအရေကင်', NULL::text, 'per skewer'),
    ('A15', 'Classic grilled pork skewer with house spice rub.', NULL::text, NULL::text, 'ဝက်သားကင်', NULL::text, 'per skewer'),
    ('A16', 'Grilled fresh shrimp skewer with light seasoning.', NULL::text, NULL::text, 'ပုစွန်ကင်', NULL::text, 'per skewer'),
    ('A17', 'Tender grilled squid skewer.', NULL::text, NULL::text, 'ကျွဲငှက်ကင်', NULL::text, 'per skewer'),
    ('A19', 'Grilled chicken sausage skewer.', NULL::text, NULL::text, 'ကြက်သားဆောစေ့ကင်', NULL::text, 'per skewer'),
    ('A20', 'Soft fish tofu skewer with light char.', NULL::text, NULL::text, 'ငါးသားတို့ဟူးကင်', NULL::text, 'per skewer'),
    ('A21', 'Grilled pork meatball skewer.', NULL::text, NULL::text, 'ဝက်သားလုံးကင်', NULL::text, 'per skewer'),
    ('A22', 'Grilled chicken meatball skewer.', NULL::text, NULL::text, 'ကြက်သားလုံးကင်', NULL::text, 'per skewer'),
    ('A14', 'Enoki mushrooms wrapped in pork belly and grilled until golden.', NULL::text, NULL::text, 'ဝက်ဝမ်းဗိုက်မှိဖု့ကင်', NULL::text, 'per skewer'),
    ('A18', 'Roasted yellow beans, simple and snackable.', NULL::text, NULL::text, 'ပဲဝါကင်', NULL::text, 'per skewer'),
    ('A23', 'Grilled broccoli florets with light seasoning.', NULL::text, NULL::text, 'ဘရိုကိုလီကင်', NULL::text, 'per skewer'),
    ('A24', 'Grilled potato skewer with seasoning.', NULL::text, NULL::text, 'အာလူးကင်', NULL::text, 'per skewer'),
    ('A25', 'Grilled Chinese chives with fragrant seasoning.', NULL::text, NULL::text, 'မြေက်ပင်ကင်', NULL::text, 'per skewer'),
    ('A26', 'Sliced lotus root grilled until tender and slightly caramelized.', NULL::text, NULL::text, 'ကြာမြစ်ကင်', NULL::text, 'per skewer'),
    ('A27', 'Grilled mushroom skewer with savory seasoning.', NULL::text, NULL::text, 'မှိပင်ကင်', NULL::text, 'per skewer'),
    ('B01', 'Whole fish grilled with house Mala sauce — bold, numbing, and unforgettable.', NULL::text, NULL::text, 'မာလာငါးကင်', NULL::text, 'per dish'),
    ('B02', 'Silken tofu in rich spicy Mapo sauce with minced pork and Sichuan pepper.', NULL::text, NULL::text, 'မာပိုးတို့ဟူး', NULL::text, 'per dish'),
    ('B03', 'Golden crispy chicken tossed in house spicy sauce.', NULL::text, NULL::text, 'ချင်စပကြက်ကြော်', NULL::text, 'per dish'),
    ('B04', 'Wok-fried pork intestine with dried chilies and aromatics.', NULL::text, NULL::text, 'ဝက်အူကြော်', NULL::text, 'per dish'),
    ('B05', 'Crispy potato cubes tossed in signature Mala spice blend.', NULL::text, NULL::text, 'မာလာအာလူး', NULL::text, 'per dish'),
    ('B06', 'Shredded potato stir-fried with garlic and light seasoning.', NULL::text, NULL::text, 'အာလူးကြော်', NULL::text, 'per dish'),
    ('B07', 'Steamed jasmine white rice.', NULL::text, NULL::text, 'ထမင်းဖြူ', NULL::text, 'per serving'),
    ('B08', 'Fresh kale stir-fried with garlic and oyster sauce.', NULL::text, NULL::text, 'ကိုင်းလန်ကြော်', NULL::text, 'per dish'),
    ('B09', 'Classic wok-fried rice with egg and seasoning.', NULL::text, NULL::text, 'ထမင်းကြော်', NULL::text, 'per serving'),
    ('B10', 'Morning glory stir-fried with garlic and chili.', NULL::text, NULL::text, 'ဟင်းနုနွယ်ကြော်', NULL::text, 'per dish'),
    ('B11', 'Classic Thai hot and sour soup with fresh herbs and mushroom.', NULL::text, NULL::text, 'တွမ်ယမ်ဟင်းချို', NULL::text, 'per dish')
) as v(item_code, description_en, description_my, description_th, name_my, name_th, unit)
where m.item_code = v.item_code;

commit;

-- ── 2. Verification (read-only) ─────────────────────────────────────────────

-- a) Seed rows with no matching menu_items row — expect 0. Anything here is an
--    item this repo knows about that the table does not; investigate before
--    assuming the menu is complete.
select v.item_code
  from (values
    ('A01'),
    ('A02'),
    ('A03'),
    ('A04'),
    ('A05'),
    ('A06'),
    ('A07'),
    ('A08'),
    ('A09'),
    ('A10'),
    ('A11'),
    ('A12'),
    ('A13'),
    ('A15'),
    ('A16'),
    ('A17'),
    ('A19'),
    ('A20'),
    ('A21'),
    ('A22'),
    ('A14'),
    ('A18'),
    ('A23'),
    ('A24'),
    ('A25'),
    ('A26'),
    ('A27'),
    ('B01'),
    ('B02'),
    ('B03'),
    ('B04'),
    ('B05'),
    ('B06'),
    ('B07'),
    ('B08'),
    ('B09'),
    ('B10'),
    ('B11')
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
-- Expect with_my_name = 38, with_th_name = 0,
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
