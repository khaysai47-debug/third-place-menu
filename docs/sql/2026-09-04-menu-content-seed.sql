-- ============================================================================
-- Menu content seed — 38 items (generated 2026-09-04)
-- ============================================================================
-- GENERATED FILE. Produced by scripts/generate-menu-seed.mjs from
-- src/data/menu.ts; regenerate rather than editing by hand.
--
-- REVIEW-FIRST: paste into the Supabase SQL Editor and run manually, AFTER
-- the preflight has passed and 2026-09-04-menu-content-i18n.sql has added the
-- columns. Nothing in this repo executes it.
--
-- WHAT IT DOES: fills the new content columns for rows that do not have that
-- value yet, matched on item_code.
--
-- WHAT IT CANNOT DO:
--   - REWRITE ANYTHING NON-BLANK. Each column is written as
--     "keep m.<col> when it is not blank, else the seed". BTRIM appears only
--     in the blankness TEST, never around a value being stored, so an owner's
--     leading or trailing spacing survives byte for byte;
--   - TOUCH A ROW IT WOULD NOT CHANGE. The WHERE clause requires some column
--     to be blank AND to have a value waiting, so a second identical run
--     reports UPDATE 0 and no row-level trigger fires;
--   - insert or delete a row. A code that is not already in the table is
--     reported by the preflight and ignored here;
--   - touch name_en, price, category, availability_status, is_available or
--     sort_order. Those are operational and out of scope.
--
-- Myanmar names are DRAFT — src/data/menu.ts records that the spelling needs
-- native confirmation. Thai is absent everywhere and seeds as NULL.

-- ── 1. Fill blank content columns ───────────────────────────────────────────

begin;

update public.menu_items as m set
  description_en = case when btrim(coalesce(m.description_en, '')) <> '' then m.description_en else v.description_en end,
  description_my = case when btrim(coalesce(m.description_my, '')) <> '' then m.description_my else v.description_my end,
  description_th = case when btrim(coalesce(m.description_th, '')) <> '' then m.description_th else v.description_th end,
  name_my        = case when btrim(coalesce(m.name_my, '')) <> '' then m.name_my else v.name_my end,
  name_th        = case when btrim(coalesce(m.name_th, '')) <> '' then m.name_th else v.name_th end,
  unit           = case when btrim(coalesce(m.unit, '')) <> '' then m.unit else v.unit end
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
where m.item_code = v.item_code
  and (
      (btrim(coalesce(m.description_en, '')) = '' and v.description_en is not null)
      or
      (btrim(coalesce(m.description_my, '')) = '' and v.description_my is not null)
      or
      (btrim(coalesce(m.description_th, '')) = '' and v.description_th is not null)
      or
      (btrim(coalesce(m.name_my, '')) = '' and v.name_my is not null)
      or
      (btrim(coalesce(m.name_th, '')) = '' and v.name_th is not null)
      or
      (btrim(coalesce(m.unit, '')) = '' and v.unit is not null)
  );

commit;

-- ── 2. Verification (read-only) ─────────────────────────────────────────────

-- a) THE NO-OP PROOF. Re-run § 1 exactly as it stands. It must report
--    "UPDATE 0". If it reports anything else, something is rewriting values
--    and the change guard is not doing its job — stop and investigate.
--    The same query, as a dry count that touches nothing:
select count(*) as rows_that_would_change
  from public.menu_items m
  join (
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
  ) as v(item_code, description_en, description_my, description_th, name_my, name_th, unit) on m.item_code = v.item_code
  where
      (btrim(coalesce(m.description_en, '')) = '' and v.description_en is not null)
      or
      (btrim(coalesce(m.description_my, '')) = '' and v.description_my is not null)
      or
      (btrim(coalesce(m.description_th, '')) = '' and v.description_th is not null)
      or
      (btrim(coalesce(m.name_my, '')) = '' and v.name_my is not null)
      or
      (btrim(coalesce(m.name_th, '')) = '' and v.name_th is not null)
      or
      (btrim(coalesce(m.unit, '')) = '' and v.unit is not null);
-- Expect 38 before the first run and 0 after it.

-- b) Coverage:
select count(*) as items,
       count(*) filter (where nullif(btrim(description_en), '') is not null) as with_en_description,
       count(*) filter (where nullif(btrim(name_my), '')        is not null) as with_my_name,
       count(*) filter (where nullif(btrim(name_th), '')        is not null) as with_th_name,
       count(*) filter (where nullif(btrim(unit), '')           is not null) as with_unit,
       count(*) filter (where image_url is not null)                         as with_photo
  from public.menu_items;
-- Expect with_my_name >= 38, with_th_name = 0,
-- with_photo = 0 until onboarding supplies them.

-- c) Operational columns untouched — compare against the preflight's § 1
--    before-image. Every row must match on all six:
select item_code, name_en, category, price, is_available, availability_status, sort_order
  from public.menu_items
  order by sort_order asc, item_code asc;

-- ── 3. Restoration ──────────────────────────────────────────────────────────
-- There is deliberately NO blanket rollback here. Blanking the content columns
-- would destroy the owner's own wording along with anything seeded, and after
-- the first edit the two are indistinguishable.
--
-- Restore from the before-image exported in the preflight's § 1, one column at
-- a time, e.g. for description_en:
--
--   begin;
--   update public.menu_items as m
--      set description_en = b.description_en
--     from (values ('A01', 'the exported text'), ...) as b(item_code, description_en)
--    where m.item_code = b.item_code;
--   commit;
--
-- If no before-image was taken, there is nothing to restore to — which is why
-- the preflight puts it first.
