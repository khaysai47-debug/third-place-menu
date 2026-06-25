import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Hero } from "@/components/menu/Hero";
import { ServiceTiles } from "@/components/menu/ServiceTiles";
import { CategoryNav } from "@/components/menu/CategoryNav";
import { SectionHeading } from "@/components/menu/SectionHeading";
import { MenuItemCard } from "@/components/menu/MenuItemCard";
import { CartBar } from "@/components/menu/CartBar";
import { CheckoutDrawer, type OrderType } from "@/components/menu/CheckoutDrawer";
import { CATEGORIES, MENU, type MenuCategoryId, type MenuItem } from "@/data/menu";
import { getMenuAvailability, type MenuAvailabilityStatus } from "@/lib/menuAvailability";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "The Third Place — Chinese BBQ & Lounge | E-Menu" },
      {
        name: "description",
        content:
          "A warm table after class, work, and everything in between. Premium Chinese BBQ & lounge near Assumption University.",
      },
      { property: "og:title", content: "The Third Place — Chinese BBQ & Lounge" },
      {
        property: "og:description",
        content: "A warm table after class, work, and everything in between.",
      },
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
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [orderType, setOrderType] = useState<OrderType>("dine-in");
  const menuSectionRef = useRef<HTMLDivElement>(null);

  const handlePopularClick = useCallback(() => {
    setActive("signature");
    menuSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  // Live "Availability Status" by menu item id; null until fetched.
  const [availability, setAvailability] = useState<ReadonlyMap<
    string,
    MenuAvailabilityStatus
  > | null>(null);
  const [availabilityWarning, setAvailabilityWarning] = useState(false);
  const [cart, setCart] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem("tp_cart");
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) return {};
      return Object.fromEntries(
        Object.entries(parsed).filter(([, v]) => typeof v === "number" && v > 0),
      ) as Record<string, number>;
    } catch {
      return {};
    }
  });

  useEffect(() => {
    if (Object.keys(cart).length === 0) {
      localStorage.removeItem("tp_cart");
    } else {
      localStorage.setItem("tp_cart", JSON.stringify(cart));
    }
  }, [cart]);

  // Fail open: if the availability API is unreachable, the menu stays
  // orderable from local data and we only show a soft notice. The in-flight
  // guard prevents overlapping fetches from the poll / focus refresh.
  const refreshingAvailabilityRef = useRef(false);
  const loadAvailability = useCallback(async (isInitial = false) => {
    if (refreshingAvailabilityRef.current) return;
    refreshingAvailabilityRef.current = true;
    try {
      const live = await getMenuAvailability();
      setAvailability(new Map(live.map((i) => [i.menuItemId, i.availability])));
    } catch (error) {
      console.error("Live availability unavailable; using local menu data", error);
      // Only the initial load surfaces the soft warning; background refreshes
      // stay silent and keep the last-known availability.
      if (isInitial) setAvailabilityWarning(true);
    } finally {
      refreshingAvailabilityRef.current = false;
    }
  }, []);

  // Initial load.
  useEffect(() => {
    void loadAvailability(true);
  }, [loadAvailability]);

  // Keep availability fresh without a manual refresh: poll every 30s while the
  // tab is visible, and refresh immediately when it regains focus. Paused when
  // hidden; overlap-guarded above.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!document.hidden) void loadAvailability();
    }, 30000);
    const onVisible = () => {
      if (!document.hidden) void loadAvailability();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loadAvailability]);

  // Local menu with live availability overlaid. Hidden items are dropped;
  // items the API doesn't know about keep their local availability.
  const menu = useMemo(() => {
    if (!availability) return MENU;
    return MENU.flatMap((item) => {
      const status = availability.get(item.id);
      if (!status) return [item];
      if (status === "Hidden") return [];
      return [{ ...item, available: status === "Available" }];
    });
  }, [availability]);

  const addToCart = (item: MenuItem) => {
    if (!item.available || item.price === undefined) return;
    setCart((c) => ({ ...c, [item.id]: (c[item.id] ?? 0) + 1 }));
  };

  const increaseQty = (id: string) => setCart((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 }));

  const decreaseQty = (id: string) =>
    setCart((c) => {
      const next = { ...c };
      if ((next[id] ?? 0) <= 1) delete next[id];
      else next[id] -= 1;
      return next;
    });

  const clearCart = () => setCart({});

  // Cart rows resolve against the full local MENU so an item that went
  // Sold Out (or Hidden) after being added is flagged instead of vanishing.
  const cartItems = useMemo(
    () =>
      Object.entries(cart).flatMap(([id, qty]) => {
        const item = MENU.find((i) => i.id === id);
        if (!item || item.price === undefined) return [];
        const status = availability?.get(id);
        const orderable = status ? status === "Available" : item.available;
        return [{ id, name: item.nameEn, qty, subtotal: item.price * qty, soldOut: !orderable }];
      }),
    [cart, availability],
  );

  const cartHasSoldOut = cartItems.some((i) => i.soldOut);

  const total = useMemo(() => cartItems.reduce((s, i) => s + i.subtotal, 0), [cartItems]);

  const activeCategory = CATEGORIES.find((c) => c.id === active)!;
  const items = menu.filter((m) => m.category === active).sort((a, b) => a.order - b.order);

  return (
    <div className="min-h-screen ink-grain">
      <main className="mx-auto max-w-[680px] pb-32">
        <Hero />
        <div className="mt-2">
          <ServiceTiles
            orderType={orderType}
            onOrderTypeChange={setOrderType}
            onPopularClick={handlePopularClick}
          />
        </div>

        {availabilityWarning && (
          <p className="mt-4 mx-5 rounded-xl border border-[var(--color-gold)]/25 bg-[var(--color-charcoal-soft)]/60 px-4 py-2.5 text-center text-[12px] leading-relaxed text-[var(--color-gold-soft)]/80">
            即時供應狀態暫時無法更新 · Live availability couldn't refresh — a few items may have
            just sold out. Staff will confirm your order.
          </p>
        )}

        <div className="mt-6" ref={menuSectionRef}>
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
              ),
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

        {(active === "skewers-veg" ||
          active === "stir-fried" ||
          active === "rice-noodles" ||
          active === "soup") && (
          <div className="px-5 space-y-2.5">
            {items.map((item) => (
              <MenuItemCard key={item.id} item={item} variant="compact" onAdd={addToCart} />
            ))}
          </div>
        )}

        {/* Footer mark */}
        <footer className="mt-14 px-5 text-center">
          <div className="flex items-center justify-center gap-3">
            <span className="h-px w-12 bg-[var(--color-gold)]/40" />
            <span className="font-display text-[15px] tracking-[0.4em] text-[var(--color-gold-soft)]">
              第三空間
            </span>
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

      <CartBar
        items={cartItems}
        total={total}
        onIncrease={increaseQty}
        onDecrease={decreaseQty}
        onClear={clearCart}
        onCheckout={() => {
          if (!cartHasSoldOut) setCheckoutOpen(true);
        }}
      />
      {checkoutOpen && (
        <CheckoutDrawer
          items={cartItems}
          total={total}
          onClose={() => setCheckoutOpen(false)}
          initialOrderType={orderType}
        />
      )}
    </div>
  );
}
