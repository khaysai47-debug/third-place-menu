// Real menu data imported from Airtable "Menu Item" grid view CSV.
// Field names mirror Airtable columns 1:1 so this can be swapped for an
// Airtable API fetch with zero UI changes. See README at bottom.

export type MenuCategoryId =
  | "signature"
  | "skewers"
  | "skewers-veg"
  | "stir-fried"
  | "rice-noodles"
  | "soup";

export interface MenuCategory {
  id: MenuCategoryId;
  nameEn: string;        // Category English (display)
  nameMy?: string;       // Category Myanmar (hidden in UI for now)
  blurb: string;
}

export interface MenuItem {
  id: string;                 // Menu Item ID (e.g. "A01")
  nameEn: string;             // Item Name English
  nameMy?: string;            // Item Name Myanmar (not displayed yet)
  category: MenuCategoryId;   // mapped from Category English
  categoryMy?: string;        // Category Myanmar
  tags?: string[];            // Item Type / Tags
  descriptionEn: string;      // Description English
  descriptionMy?: string;     // Description Myanmar
  price?: number;             // Price (THB). undefined => "Need confirmation"
  unit?: string;              // Portion / Unit
  image?: string;             // Image URL — falls back to designed placeholder
  available: boolean;         // Availability Status === "Available"
  popular: boolean;           // Popular Item checkbox
  order: number;              // Display Order
  notes?: string;             // Notes / Need Confirmation
  createdAt: string;
  updatedAt: string;
}

export const CATEGORIES: MenuCategory[] = [
  { id: "signature",    nameEn: "Signature",    nameMy: "ထူးခြားဟင်းများ",      blurb: "Chef\'s picks — the soul of the lounge." },
  { id: "skewers",      nameEn: "BBQ Skewers",  nameMy: "ကင်ကြော",               blurb: "Charcoal-grilled, brushed with house spice." },
  { id: "skewers-veg",  nameEn: "Veg Skewers",  nameMy: "ဟင်းသီးဟင်းရွက်ကင်",      blurb: "Garden-side of the grill." },
  { id: "stir-fried",   nameEn: "Stir Fried",   nameMy: "လှော်ထားသောဟင်းများ",   blurb: "Wok-tossed, smoky breath of the kitchen." },
  { id: "rice-noodles", nameEn: "Rice & Noodles", nameMy: "ထမင်းနှင့်ခေါက်ဆွဲ", blurb: "Warm bowls to anchor the table." },
  { id: "soup",         nameEn: "Soup",         nameMy: "ဟင်းချို",              blurb: "Slow, restorative, shared." },
];

export const MENU: MenuItem[] = [
  { id: "A01", nameEn: "Beef", nameMy: "နွားသားကင်", category: "skewers", categoryMy: "ကင်ကြော", tags: ["Meat"], descriptionEn: "Tender beef skewers seasoned with Yunnan spices, grilled over open flame.", price: 100.0, unit: "x4 skewers", available: true, popular: false, order: 1, notes: "Comes as 4 skewers per order. Myanmar spelling needs native confirmation.", createdAt: "6/4/2026 9:25am", updatedAt: "6/4/2026 9:44am" },
  { id: "A02", nameEn: "Beef Louver", nameMy: "နွားဗိုက်ပိုးကင်", category: "skewers", categoryMy: "ကင်ကြော", tags: ["Meat"], descriptionEn: "Tender beef honeycomb tripe skewers with aromatic spice seasoning.", price: 80.0, unit: "x3 skewers", available: true, popular: false, order: 2, notes: "Myanmar spelling needs native confirmation.", createdAt: "6/4/2026 9:25am", updatedAt: "6/4/2026 9:44am" },
  { id: "A03", nameEn: "Chicken", nameMy: "ကြက်သားကင်", category: "skewers", categoryMy: "ကင်ကြော", tags: ["Meat"], descriptionEn: "Juicy chicken skewer grilled with house seasoning.", price: 15.0, unit: "per skewer", available: true, popular: false, order: 3, notes: "Myanmar spelling needs native confirmation.", createdAt: "6/4/2026 9:25am", updatedAt: "6/4/2026 9:44am" },
  { id: "A04", nameEn: "Chicken Wing", nameMy: "ကြက်တောင်ကင်", category: "skewers", categoryMy: "ကင်ကြော", tags: ["Meat"], descriptionEn: "Crispy grilled chicken wing with smoky char.", price: 15.0, unit: "per skewer", available: true, popular: false, order: 4, notes: "Price unclear in menu image — confirm with owner. Myanmar spelling needs native confirmation.", createdAt: "6/4/2026 9:25am", updatedAt: "6/4/2026 9:44am" },
  { id: "A05", nameEn: "Chicken Heart", nameMy: "ကြက်နှလုံးကင်", category: "skewers", categoryMy: "ကင်ကြော", tags: ["Meat"], descriptionEn: "Grilled chicken heart skewer with light seasoning.", price: 15.0, unit: "per skewer", available: true, popular: false, order: 5, notes: "Myanmar spelling needs native confirmation.", createdAt: "6/4/2026 9:25am", updatedAt: "6/4/2026 9:44am" },
  { id: "A06", nameEn: "Chicken Gizzard", nameMy: "ကြက်ဝမ်းစိမ်းကင်", category: "skewers", categoryMy: "ကင်ကြော", tags: ["Meat"], descriptionEn: "Chewy grilled chicken gizzard with savory seasoning.", price: 15.0, unit: "per skewer", available: true, popular: false, order: 6, notes: "Myanmar spelling needs native confirmation.", createdAt: "6/4/2026 9:25am", updatedAt: "6/4/2026 9:44am" },
  { id: "A07", nameEn: "Chicken Skin", nameMy: "ကြက်သားအရေကင်", category: "skewers", categoryMy: "ကင်ကြော", tags: ["Meat"], descriptionEn: "Crispy grilled chicken skin — light and crunchy.", price: 15.0, unit: "per skewer", available: true, popular: false, order: 7, notes: "Myanmar spelling needs native confirmation.", createdAt: "6/4/2026 9:25am", updatedAt: "6/4/2026 9:44am" },
  { id: "A08", nameEn: "Yunnan Drumstick", nameMy: "ယူနန်ကြက်ခြေထောက်", category: "skewers", categoryMy: "ကင်ကြော", tags: ["Meat"], descriptionEn: "Signature Yunnan-style chicken drumstick marinated in secret spice blend.", unit: "per skewer", available: true, popular: false, order: 8, notes: "Price unclear — confirm with owner. Myanmar spelling needs native confirmation.", createdAt: "6/4/2026 9:25am", updatedAt: "6/4/2026 10:07am" },
  { id: "A09", nameEn: "Mutton", nameMy: "သိုးသားကင်", category: "skewers", categoryMy: "ကင်ကြော", tags: ["Meat"], descriptionEn: "Juicy mutton skewers with aromatic cumin and chili marinade.", price: 60.0, unit: "x3 skewers", available: true, popular: false, order: 9, notes: "Comes as 3 skewers per order. Myanmar spelling needs native confirmation.", createdAt: "6/4/2026 9:25am", updatedAt: "6/4/2026 9:44am" },
  { id: "A10", nameEn: "Pork Ear", nameMy: "ဝက်နားကင်", category: "skewers", categoryMy: "ကင်ကြော", tags: ["Meat"], descriptionEn: "Thinly sliced pork ear grilled until tender with a satisfying crunch.", price: 15.0, unit: "per skewer", available: true, popular: false, order: 10, notes: "Myanmar spelling needs native confirmation.", createdAt: "6/4/2026 9:25am", updatedAt: "6/4/2026 9:44am" },
  { id: "A11", nameEn: "Pork Tongue", nameMy: "ဝက်လျှာကင်", category: "skewers", categoryMy: "ကင်ကြော", tags: ["Meat"], descriptionEn: "Tender sliced pork tongue grilled with seasoning.", price: 15.0, unit: "per skewer", available: true, popular: false, order: 11, notes: "Myanmar spelling needs native confirmation.", createdAt: "6/4/2026 9:25am", updatedAt: "6/4/2026 9:44am" },
  { id: "A12", nameEn: "Pork Belly", nameMy: "ဝက်ဝမ်းဗိုက်ကင်", category: "skewers", categoryMy: "ကင်ကြော", tags: ["Meat"], descriptionEn: "Three-layer pork belly skewer, fatty and flavourful.", price: 15.0, unit: "per skewer", available: true, popular: false, order: 12, notes: "Myanmar spelling needs native confirmation.", createdAt: "6/4/2026 9:25am", updatedAt: "6/4/2026 9:44am" },
  { id: "A13", nameEn: "Pork Skin", nameMy: "ဝက်သားအရေကင်", category: "skewers", categoryMy: "ကင်ကြော", tags: ["Meat"], descriptionEn: "Grilled pork skin — crispy outside, chewy inside.", price: 15.0, unit: "per skewer", available: true, popular: false, order: 13, notes: "Myanmar spelling needs native confirmation.", createdAt: "6/4/2026 9:25am", updatedAt: "6/4/2026 9:44am" },
  { id: "A15", nameEn: "Pork", nameMy: "ဝက်သားကင်", category: "skewers", categoryMy: "ကင်ကြော", tags: ["Meat"], descriptionEn: "Classic grilled pork skewer with house spice rub.", price: 15.0, unit: "per skewer", available: true, popular: false, order: 14, notes: "Myanmar spelling needs native confirmation.", createdAt: "6/4/2026 9:25am", updatedAt: "6/4/2026 9:44am" },
  { id: "A16", nameEn: "Shrimp", nameMy: "ပုစွန်ကင်", category: "skewers", categoryMy: "ကင်ကြော", tags: ["Seafood"], descriptionEn: "Grilled fresh shrimp skewer with light seasoning.", price: 15.0, unit: "per skewer", available: true, popular: false, order: 15, notes: "Confirm price — may be higher than 15฿. Myanmar spelling needs native confirmation.", createdAt: "6/4/2026 9:25am", updatedAt: "6/4/2026 9:44am" },
  { id: "A17", nameEn: "Squid", nameMy: "ကျွဲငှက်ကင်", category: "skewers", categoryMy: "ကင်ကြော", tags: ["Seafood"], descriptionEn: "Tender grilled squid skewer.", price: 15.0, unit: "per skewer", available: true, popular: false, order: 16, notes: "Confirm price. Myanmar spelling needs native confirmation.", createdAt: "6/4/2026 9:25am", updatedAt: "6/4/2026 9:44am" },
  { id: "A19", nameEn: "Chicken Sausage", nameMy: "ကြက်သားဆောစေ့ကင်", category: "skewers", categoryMy: "ကင်ကြော", tags: ["Meat"], descriptionEn: "Grilled chicken sausage skewer.", price: 15.0, unit: "per skewer", available: true, popular: false, order: 17, notes: "Myanmar spelling needs native confirmation.", createdAt: "6/4/2026 9:25am", updatedAt: "6/4/2026 9:44am" },
  { id: "A20", nameEn: "Fish Tofu", nameMy: "ငါးသားတို့ဟူးကင်", category: "skewers", categoryMy: "ကင်ကြော", tags: ["Seafood"], descriptionEn: "Soft fish tofu skewer with light char.", price: 15.0, unit: "per skewer", available: true, popular: false, order: 18, notes: "Myanmar spelling needs native confirmation.", createdAt: "6/4/2026 9:25am", updatedAt: "6/4/2026 9:44am" },
  { id: "A21", nameEn: "Pork Ball", nameMy: "ဝက်သားလုံးကင်", category: "skewers", categoryMy: "ကင်ကြော", tags: ["Meat"], descriptionEn: "Grilled pork meatball skewer.", price: 15.0, unit: "per skewer", available: true, popular: false, order: 19, notes: "Myanmar spelling needs native confirmation.", createdAt: "6/4/2026 9:25am", updatedAt: "6/4/2026 9:44am" },
  { id: "A22", nameEn: "Chicken Ball", nameMy: "ကြက်သားလုံးကင်", category: "skewers", categoryMy: "ကင်ကြော", tags: ["Meat"], descriptionEn: "Grilled chicken meatball skewer.", price: 15.0, unit: "per skewer", available: true, popular: false, order: 20, notes: "Myanmar spelling needs native confirmation.", createdAt: "6/4/2026 9:25am", updatedAt: "6/4/2026 9:44am" },
  { id: "A14", nameEn: "Bacon Mushroom Roll", nameMy: "ဝက်ဝမ်းဗိုက်မှိဖု့ကင်", category: "skewers-veg", categoryMy: "ကင်ကြော — ဟင်းသီးဟင်းရွက်", tags: ["Meat", "Vegetable"], descriptionEn: "Enoki mushrooms wrapped in pork belly and grilled until golden.", price: 15.0, unit: "per skewer", available: true, popular: false, order: 1, notes: "Myanmar spelling needs native confirmation.", createdAt: "6/4/2026 9:26am", updatedAt: "6/4/2026 10:08am" },
  { id: "A18", nameEn: "Yellow Bean", nameMy: "ပဲဝါကင်", category: "skewers-veg", categoryMy: "ကင်ကြော — ဟင်းသီးဟင်းရွက်", tags: ["Vegetable"], descriptionEn: "Roasted yellow beans, simple and snackable.", price: 15.0, unit: "per skewer", available: true, popular: false, order: 2, notes: "Myanmar spelling needs native confirmation.", createdAt: "6/4/2026 9:26am", updatedAt: "6/4/2026 10:08am" },
  { id: "A23", nameEn: "Broccoli", nameMy: "ဘရိုကိုလီကင်", category: "skewers-veg", categoryMy: "ကင်ကြော — ဟင်းသီးဟင်းရွက်", tags: ["Vegetable"], descriptionEn: "Grilled broccoli florets with light seasoning.", price: 15.0, unit: "per skewer", available: true, popular: false, order: 3, notes: "Myanmar spelling needs native confirmation.", createdAt: "6/4/2026 9:26am", updatedAt: "6/4/2026 10:08am" },
  { id: "A24", nameEn: "Potato (BBQ)", nameMy: "အာလူးကင်", category: "skewers-veg", categoryMy: "ကင်ကြော — ဟင်းသီးဟင်းရွက်", tags: ["Vegetable"], descriptionEn: "Grilled potato skewer with seasoning.", price: 15.0, unit: "per skewer", available: true, popular: false, order: 4, notes: "Myanmar spelling needs native confirmation.", createdAt: "6/4/2026 9:26am", updatedAt: "6/4/2026 10:08am" },
  { id: "A25", nameEn: "Chinese Chives", nameMy: "မြေက်ပင်ကင်", category: "skewers-veg", categoryMy: "ကင်ကြော — ဟင်းသီးဟင်းရွက်", tags: ["Vegetable"], descriptionEn: "Grilled Chinese chives with fragrant seasoning.", price: 15.0, unit: "per skewer", available: true, popular: false, order: 5, notes: "Myanmar name needs confirmation.", createdAt: "6/4/2026 9:26am", updatedAt: "6/4/2026 10:02am" },
  { id: "A26", nameEn: "Lotus Root", nameMy: "ကြာမြစ်ကင်", category: "skewers-veg", categoryMy: "ကင်ကြော — ဟင်းသီးဟင်းရွက်", tags: ["Vegetable"], descriptionEn: "Sliced lotus root grilled until tender and slightly caramelized.", price: 15.0, unit: "per skewer", available: true, popular: false, order: 6, notes: "Myanmar spelling needs native confirmation.", createdAt: "6/4/2026 9:26am", updatedAt: "6/4/2026 10:08am" },
  { id: "A27", nameEn: "Mushroom", nameMy: "မှိပင်ကင်", category: "skewers-veg", categoryMy: "ကင်ကြော — ဟင်းသီးဟင်းရွက်", tags: ["Vegetable"], descriptionEn: "Grilled mushroom skewer with savory seasoning.", price: 15.0, unit: "per skewer", available: true, popular: false, order: 7, notes: "Myanmar spelling needs native confirmation.", createdAt: "6/4/2026 9:26am", updatedAt: "6/4/2026 10:08am" },
  { id: "B01", nameEn: "Mala BBQ Fish", nameMy: "မာလာငါးကင်", category: "signature", categoryMy: "အထူးဟင်းချက်များ", tags: ["Signature", "Spicy", "Seafood"], descriptionEn: "Whole fish grilled with house Mala sauce — bold, numbing, and unforgettable.", price: 188.0, unit: "per dish", available: true, popular: true, order: 1, notes: "Myanmar spelling needs native confirmation.", createdAt: "6/4/2026 9:26am", updatedAt: "6/4/2026 10:08am" },
  { id: "B02", nameEn: "Mapo Tofu", nameMy: "မာပိုးတို့ဟူး", category: "signature", categoryMy: "အထူးဟင်းချက်များ", tags: ["Signature", "Spicy"], descriptionEn: "Silken tofu in rich spicy Mapo sauce with minced pork and Sichuan pepper.", price: 148.0, unit: "per dish", available: true, popular: true, order: 2, notes: "Myanmar spelling needs native confirmation.", createdAt: "6/4/2026 9:26am", updatedAt: "6/4/2026 10:08am" },
  { id: "B03", nameEn: "Spicy Crispy Chicken", nameMy: "ချင်စပကြက်ကြော်", category: "signature", categoryMy: "အထူးဟင်းချက်များ", tags: ["Signature", "Spicy", "Meat"], descriptionEn: "Golden crispy chicken tossed in house spicy sauce.", price: 138.0, unit: "per dish", available: true, popular: true, order: 3, notes: "Myanmar spelling needs native confirmation.", createdAt: "6/4/2026 9:26am", updatedAt: "6/4/2026 10:08am" },
  { id: "B04", nameEn: "Stir Fried Pork Intestine", nameMy: "ဝက်အူကြော်", category: "signature", categoryMy: "အထူးဟင်းချက်များ", tags: ["Signature", "Meat"], descriptionEn: "Wok-fried pork intestine with dried chilies and aromatics.", price: 148.0, unit: "per dish", available: true, popular: false, order: 4, notes: "Myanmar spelling needs native confirmation.", createdAt: "6/4/2026 9:26am", updatedAt: "6/4/2026 10:08am" },
  { id: "B05", nameEn: "Mala Potato", nameMy: "မာလာအာလူး", category: "signature", categoryMy: "အထူးဟင်းချက်များ", tags: ["Signature", "Spicy", "Vegetable"], descriptionEn: "Crispy potato cubes tossed in signature Mala spice blend.", price: 98.0, unit: "per dish", available: true, popular: false, order: 5, notes: "Myanmar spelling needs native confirmation.", createdAt: "6/4/2026 9:26am", updatedAt: "6/4/2026 10:08am" },
  { id: "B06", nameEn: "Stir Fried Potato", nameMy: "အာလူးကြော်", category: "stir-fried", categoryMy: "ကြော်ဟင်းများ", tags: ["Vegetable"], descriptionEn: "Shredded potato stir-fried with garlic and light seasoning.", price: 98.0, unit: "per dish", available: true, popular: false, order: 1, notes: "Myanmar spelling needs native confirmation.", createdAt: "6/4/2026 9:26am", updatedAt: "6/4/2026 10:08am" },
  { id: "B07", nameEn: "White Rice", nameMy: "ထမင်းဖြူ", category: "rice-noodles", categoryMy: "ထမင်းနှင့်ခေါက်ဆွဲ", tags: ["Rice"], descriptionEn: "Steamed jasmine white rice.", price: 18.0, unit: "per serving", available: true, popular: false, order: 1, notes: "Myanmar spelling needs native confirmation.", createdAt: "6/4/2026 9:26am", updatedAt: "6/4/2026 10:08am" },
  { id: "B08", nameEn: "Stir Fried Kale", nameMy: "ကိုင်းလန်ကြော်", category: "stir-fried", categoryMy: "ကြော်ဟင်းများ", tags: ["Vegetable"], descriptionEn: "Fresh kale stir-fried with garlic and oyster sauce.", price: 98.0, unit: "per dish", available: true, popular: false, order: 2, notes: "Myanmar spelling needs native confirmation.", createdAt: "6/4/2026 9:26am", updatedAt: "6/4/2026 10:08am" },
  { id: "B09", nameEn: "Fried Rice", nameMy: "ထမင်းကြော်", category: "rice-noodles", categoryMy: "ထမင်းနှင့်ခေါက်ဆွဲ", tags: ["Rice"], descriptionEn: "Classic wok-fried rice with egg and seasoning.", price: 58.0, unit: "per serving", available: true, popular: false, order: 2, notes: "Myanmar spelling needs native confirmation.", createdAt: "6/4/2026 9:26am", updatedAt: "6/4/2026 10:08am" },
  { id: "B10", nameEn: "Stir Fried Morning Glory", nameMy: "ဟင်းနုနွယ်ကြော်", category: "stir-fried", categoryMy: "ကြော်ဟင်းများ", tags: ["Vegetable"], descriptionEn: "Morning glory stir-fried with garlic and chili.", price: 98.0, unit: "per dish", available: true, popular: false, order: 3, notes: "Confirm price. Myanmar spelling needs native confirmation.", createdAt: "6/4/2026 9:26am", updatedAt: "6/4/2026 10:08am" },
  { id: "B11", nameEn: "Tomyum Soup", nameMy: "တွမ်ယမ်ဟင်းချို", category: "soup", categoryMy: "ဟင်းချို", tags: ["Soup"], descriptionEn: "Classic Thai hot and sour soup with fresh herbs and mushroom.", price: 158.0, unit: "per dish", available: true, popular: false, order: 1, notes: "Myanmar spelling needs native confirmation.", createdAt: "6/4/2026 9:26am", updatedAt: "6/4/2026 10:08am" },
];

/** Items in a category — available only, sorted by Display Order. */
export const itemsByCategory = (cat: MenuCategoryId): MenuItem[] =>
  MENU
    .filter((m) => m.category === cat && m.available)
    .sort((a, b) => a.order - b.order);

/**
 * Later: replace MENU above with an Airtable fetch.
 *
 * Suggested shape:
 *   const records = await fetch(`https://api.airtable.com/v0/${BASE}/Menu%20Item`)
 *   const MENU = records.map(mapAirtableRecord);
 *
 * The Airtable field names already match this file:
 *   "Menu Item ID"     -> id
 *   "Item Name English"-> nameEn
 *   "Item Name Myanmar"-> nameMy
 *   "Category English" -> category   (map label -> MenuCategoryId)
 *   "Category Myanmar" -> categoryMy
 *   "Item Type / Tags" -> tags       (split CSV)
 *   "Description English" -> descriptionEn
 *   "Description Myanmar" -> descriptionMy
 *   "Price"            -> price      (strip "฿", parse number; blank => undefined)
 *   "Portion / Unit"   -> unit
 *   "Image"            -> image
 *   "Availability Status" === "Available" -> available
 *   "Popular Item"     -> popular    (checkbox boolean)
 *   "Display Order"    -> order
 *   "Notes / Need Confirmation" -> notes
 */
