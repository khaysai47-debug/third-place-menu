// Menu data — local sample, Airtable-ready shape.
// Map these field names 1:1 to Airtable columns when wiring later.

export type MenuCategoryId =
  | "signature"
  | "skewers"
  | "stir-fried"
  | "rice-noodles"
  | "soup";

export interface MenuCategory {
  id: MenuCategoryId;
  nameEn: string;
  nameMy?: string;
  blurb: string;
}

export interface MenuItem {
  id: string;                 // Menu Item ID
  nameEn: string;             // Item Name English
  nameMy?: string;            // Item Name Myanmar (hidden in UI until confirmed)
  category: MenuCategoryId;   // Category English (id)
  categoryMy?: string;        // Category Myanmar
  tags?: string[];            // Item Type / Tags: Meat | Seafood | Vegetable | Spicy ...
  descriptionEn: string;      // Description English
  descriptionMy?: string;     // Description Myanmar
  price: number;              // THB
  unit: string;               // Portion / Unit (e.g. "per stick", "small", "bowl")
  image?: string;             // Image URL (optional)
  available: boolean;         // Availability Status
  popular?: boolean;          // Popular Item
  order: number;              // Display Order within category
  notes?: string;             // Notes / Need Confirmation
  createdAt: string;          // ISO
  updatedAt: string;          // ISO
}

export const CATEGORIES: MenuCategory[] = [
  { id: "signature",    nameEn: "Signature",      nameMy: "အထူး",     blurb: "Chef's picks — the soul of the lounge." },
  { id: "skewers",      nameEn: "BBQ Skewers",    nameMy: "ဘာဘီကျူး",  blurb: "Charcoal-grilled, brushed with mala oil." },
  { id: "stir-fried",   nameEn: "Stir Fried",     nameMy: "လှော်",       blurb: "Wok-tossed, smoky breath of the kitchen." },
  { id: "rice-noodles", nameEn: "Rice & Noodles", nameMy: "ထမင်း",      blurb: "Warm bowls to anchor the table." },
  { id: "soup",         nameEn: "Soup",           nameMy: "ဟင်းချို",    blurb: "Slow, restorative, shared." },
];

const now = "2026-06-04T00:00:00Z";

export const MENU: MenuItem[] = [
  // Signature
  { id: "sig-001", nameEn: "Mala BBQ Fish", category: "signature", tags: ["Seafood", "Spicy", "Mala"],
    descriptionEn: "Whole fish grilled over charcoal, blanketed in Sichuan mala oil, sesame, and scorched chili.",
    price: 389, unit: "whole fish", available: true, popular: true, order: 1, createdAt: now, updatedAt: now },
  { id: "sig-002", nameEn: "Mapo Tofu", category: "signature", tags: ["Vegetable", "Spicy"],
    descriptionEn: "Silken tofu, fermented chili bean, numbing Sichuan pepper, minced pork.",
    price: 159, unit: "bowl", available: true, popular: true, order: 2, createdAt: now, updatedAt: now },
  { id: "sig-003", nameEn: "Spicy Crispy Chicken", category: "signature", tags: ["Meat", "Spicy"],
    descriptionEn: "Twice-fried chicken tossed with dried chilies, peanuts, and Sichuan pepper.",
    price: 219, unit: "plate", available: true, popular: true, order: 3, createdAt: now, updatedAt: now },
  { id: "sig-004", nameEn: "Stir Fried Pork Intestine", category: "signature", tags: ["Meat", "Spicy"],
    descriptionEn: "Hand-cleaned pork intestine, wok-charred with chili and pickled vegetable.",
    price: 189, unit: "plate", available: true, order: 4, createdAt: now, updatedAt: now },
  { id: "sig-005", nameEn: "Mala Potato", category: "signature", tags: ["Vegetable", "Spicy"],
    descriptionEn: "Crisp potato strips bathed in mala butter and toasted sesame.",
    price: 129, unit: "plate", available: true, order: 5, createdAt: now, updatedAt: now },

  // Skewers
  { id: "skw-001", nameEn: "Beef Skewers", category: "skewers", tags: ["Meat"],
    descriptionEn: "Marbled beef, cumin, chili, charcoal-kissed.", price: 35, unit: "per stick",
    available: true, popular: true, order: 1, createdAt: now, updatedAt: now },
  { id: "skw-002", nameEn: "Chicken Skewers", category: "skewers", tags: ["Meat"],
    descriptionEn: "Thigh meat brushed with house mala oil.", price: 25, unit: "per stick",
    available: true, order: 2, createdAt: now, updatedAt: now },
  { id: "skw-003", nameEn: "Mutton Skewers", category: "skewers", tags: ["Meat", "Spicy"],
    descriptionEn: "Tender lamb, cumin crust, smoky finish.", price: 39, unit: "per stick",
    available: true, popular: true, order: 3, createdAt: now, updatedAt: now },
  { id: "skw-004", nameEn: "Pork Belly Skewers", category: "skewers", tags: ["Meat"],
    descriptionEn: "Fatty belly seared until edges caramelize.", price: 30, unit: "per stick",
    available: true, order: 4, createdAt: now, updatedAt: now },
  { id: "skw-005", nameEn: "Shrimp Skewers", category: "skewers", tags: ["Seafood"],
    descriptionEn: "Whole shrimp, garlic butter, light chili.", price: 45, unit: "per stick",
    available: true, order: 5, createdAt: now, updatedAt: now },
  { id: "skw-006", nameEn: "Squid Skewers", category: "skewers", tags: ["Seafood", "Spicy"],
    descriptionEn: "Tender squid scored and grilled with mala glaze.", price: 49, unit: "per stick",
    available: true, order: 6, createdAt: now, updatedAt: now },
  { id: "skw-007", nameEn: "Broccoli Skewers", category: "skewers", tags: ["Vegetable"],
    descriptionEn: "Charred florets, sesame, flake salt.", price: 20, unit: "per stick",
    available: true, order: 7, createdAt: now, updatedAt: now },
  { id: "skw-008", nameEn: "Potato Skewers", category: "skewers", tags: ["Vegetable"],
    descriptionEn: "Sliced potato, cumin, mild chili.", price: 20, unit: "per stick",
    available: true, order: 8, createdAt: now, updatedAt: now },

  // Stir Fried
  { id: "stf-001", nameEn: "Stir Fried Pork Intestine", category: "stir-fried", tags: ["Meat", "Spicy"],
    descriptionEn: "Wok-tossed with pickled chili and leek.", price: 189, unit: "plate",
    available: true, order: 1, createdAt: now, updatedAt: now },
  { id: "stf-002", nameEn: "Mala Potato", category: "stir-fried", tags: ["Vegetable", "Spicy"],
    descriptionEn: "Numbing-spicy potato, sesame, scallion.", price: 129, unit: "plate",
    available: true, order: 2, createdAt: now, updatedAt: now },
  { id: "stf-003", nameEn: "Spicy Crispy Chicken", category: "stir-fried", tags: ["Meat", "Spicy"],
    descriptionEn: "Dry-fried chicken, dried chili, peanut.", price: 219, unit: "plate",
    available: true, order: 3, createdAt: now, updatedAt: now },

  // Rice & Noodles
  { id: "rn-001", nameEn: "White Rice", category: "rice-noodles",
    descriptionEn: "Steamed jasmine rice.", price: 20, unit: "bowl",
    available: true, order: 1, createdAt: now, updatedAt: now },
  { id: "rn-002", nameEn: "Fried Rice", category: "rice-noodles", tags: ["Meat"],
    descriptionEn: "House fried rice with egg, scallion, and char.", price: 89, unit: "plate",
    available: true, popular: true, order: 2, createdAt: now, updatedAt: now },

  // Soup
  { id: "sp-001", nameEn: "Tom Yum Soup", category: "soup", tags: ["Seafood", "Spicy"],
    descriptionEn: "Lemongrass, galangal, lime, chili — a warming bridge between Thailand and Sichuan.",
    price: 149, unit: "bowl", available: true, popular: true, order: 1, createdAt: now, updatedAt: now },
];

export const itemsByCategory = (cat: MenuCategoryId) =>
  MENU.filter((m) => m.category === cat).sort((a, b) => a.order - b.order);
