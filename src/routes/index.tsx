import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Hero } from "@/components/menu/Hero";
import { ServiceTiles } from "@/components/menu/ServiceTiles";
import { CategoryNav } from "@/components/menu/CategoryNav";
import { SectionHeading } from "@/components/menu/SectionHeading";
import { MenuItemCard } from "@/components/menu/MenuItemCard";
import { CartBar } from "@/components/menu/CartBar";
import { CATEGORIES, MENU, itemsByCategory, type MenuCategoryId, type MenuItem } from "@/data/menu";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "The Third Place — Chinese BBQ & Lounge | E-Menu" },
      { name: "description", content: "A warm table after class, work, and everything in between. Premium Chinese BBQ & lounge near Assumption University." },
      { property: "og:title", content: "The Third Place — Chinese BBQ & Lounge" },
      { property: "og:description", content: "A warm table after class, work, and everything in between." },
    ],
  }),
  component: MenuPage,
});

const CATEGORY_ZH: Record<MenuCategoryId, string> = {
  signature: "招牌",
  skewers: "串燒",
  "skewers-veg": "素串",
  "stir-fried": "小炒",
  "rice-noodles": "飯麵",
  soup: "湯品",
};

function MenuPage() {
  const [active, setActive] = useState<MenuCategoryId>("signature");
  const [cart, setCart] = useState<Record<string, number>>({});

  const addToCart = (item: MenuItem) => {
    if (!item.available || item.price === undefined) return;
    setCart((c) => ({ ...c, [item.id]: (c[item.id] ?? 0) + 1 }));
  };

  const increaseQty = (id: string) =>
    setCart((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 }));

  const decreaseQty = (id: string) =>
    setCart((c) => {
      const next = { ...c };
      if ((next[id] ?? 0) <= 1) delete next[id];
      else next[id] -= 1;
      return next;
    });

  const clearCart = () => setCart({});

  const cartItems = useMemo(() =>
    Object.entries(cart).flatMap(([id, qty]) => {
      const item = MENU.find((i) => i.id === id);
      if (!item || item.price === undefined) return [];
      return [{ id, name: item.nameEn, qty, subtotal: item.price * qty }];
    }),
  [cart]);

  const total = useMemo(() => cartItems.reduce((s, i) => s + i.subtotal, 0), [cartItems]);

  const activeCategory = CATEGORIES.find((c) => c.id === active)!;
  const items = itemsByCategory(active);

  return (
    <div className="min-h-screen ink-grain">
      <main className="mx-auto max-w-[680px] pb-32">
        <Hero />
        <div className="mt-2">
          <ServiceTiles />
        </div>

        <div className="mt-6">
          <CategoryNav active={active} onChange={setActive} />
        </div>

        <SectionHeading
          eyebrow={active === "signature" ? "Chef's Table" : "Section"}
          title={activeCategory.nameEn}
          zh={CATEGORY_ZH[active]}
          blurb={activeCategory.blurb}
        />

        {active === "signature" && (
          <div className="px-5 space-y-4">
            {items.map((item, idx) =>
              idx < 2 ? (
                <MenuItemCard key={item.id} item={item} variant="feature" onAdd={addToCart} />
              ) : (
                <MenuItemCard key={item.id} item={item} variant="compact" onAdd={addToCart} />
              )
            )}
          </div>
        )}

        {active === "skewers" && (
          <div className="px-5 space-y-2.5">
            {items.map((item) => (
              <MenuItemCard key={item.id} item={item} variant="row" onAdd={addToCart} />
            ))}
          </div>
        )}

        {(active === "skewers-veg" || active === "stir-fried" || active === "rice-noodles" || active === "soup") && (
          <div className="px-5 space-y-3">
            {items.map((item) => (
              <MenuItemCard key={item.id} item={item} variant="compact" onAdd={addToCart} />
            ))}
          </div>
        )}

        {/* Footer mark */}
        <footer className="mt-14 px-5 text-center">
          <div className="flex items-center justify-center gap-3">
            <span className="h-px w-12 bg-[var(--color-gold)]/40" />
            <span className="font-display text-[15px] tracking-[0.4em] text-[var(--color-gold-soft)]">第三空間</span>
            <span className="h-px w-12 bg-[var(--color-gold)]/40" />
          </div>
          <p className="mt-3 text-[11px] tracking-[0.22em] uppercase text-[var(--color-muted-foreground)]">
            The Third Place · Chinese BBQ &amp; Lounge
          </p>
          <p className="mt-1 text-[11px] text-[var(--color-muted-foreground)]">
            Near Assumption University · Powered by Atlas
          </p>
        </footer>
      </main>

      <CartBar items={cartItems} total={total} onIncrease={increaseQty} onDecrease={decreaseQty} onClear={clearCart} />
    </div>
  );
}
