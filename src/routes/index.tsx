import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Hero } from "@/components/menu/Hero";
import { OrderTypeRail } from "@/components/menu/OrderTypeRail";
import { CategoryRail } from "@/components/menu/CategoryRail";
import { SectionHeading } from "@/components/menu/SectionHeading";
import { MenuItemCard } from "@/components/menu/MenuItemCard";
import { CartTray } from "@/components/menu/CartTray";
import { CheckoutSheet } from "@/components/menu/CheckoutSheet";
import type { OrderType } from "@/components/menu/orderType";
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
  // Incremented on every open so the checkout form remounts: one drawer
  // session = one intended order = one idempotency key.
  const [checkoutSession, setCheckoutSession] = useState(0);
  const [orderType, setOrderType] = useState<OrderType>("dine-in");
  const menuSectionRef = useRef<HTMLDivElement>(null);

  // Single scrolling pattern reused by the hero CTA and by category
  // selection, so both behave identically. Honours reduced-motion.
  const scrollToMenu = useCallback(() => {
    menuSectionRef.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
  }, []);

  // Changing chapter also returns to the top of the menu — otherwise a tap
  // made while deep in a long chapter drops the customer into the middle of
  // a shorter one.
  const handleCategoryChange = useCallback(
    (id: MenuCategoryId) => {
      setActive(id);
      scrollToMenu();
    },
    [scrollToMenu],
  );

  const openCheckout = useCallback(() => {
    setCheckoutSession((s) => s + 1);
    setCheckoutOpen(true);
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

  // One-tap removal — used by the sold-out row, which has no working stepper.
  const removeItem = (id: string) =>
    setCart((c) => {
      const next = { ...c };
      delete next[id];
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
  const cartCount = cartItems.reduce((s, i) => s + i.qty, 0);

  const total = useMemo(() => cartItems.reduce((s, i) => s + i.subtotal, 0), [cartItems]);

  const activeCategory = CATEGORIES.find((c) => c.id === active)!;
  const items = menu.filter((m) => m.category === active).sort((a, b) => a.order - b.order);

  return (
    <div className="relative min-h-dvh tp-shell">
      {/* Ember field. Fixed and inert, so the glow stays put while the menu
          travels over it and never repaints per scroll frame. */}
      <div aria-hidden className="tp-ember pointer-events-none fixed inset-0 z-0" />

      {/* pb-32 clears the order tray (~76px plus the safe area) in every
          state, so the footer is never hidden behind it. */}
      <main className="relative z-10 mx-auto max-w-[680px] pb-32">
        <Hero onEnter={scrollToMenu} />

        <section className="px-5">
          <p className="mb-3 text-[10.5px] uppercase tracking-[0.24em] text-[var(--color-gold-soft)]/55">
            How are you eating with us?
          </p>
          <OrderTypeRail value={orderType} onChange={setOrderType} />
        </section>

        {availabilityWarning && (
          <p className="tp-rise-sm mx-5 mt-5 rounded-xl border border-[var(--color-gold)]/25 bg-[var(--color-lacquer-deep)]/70 px-4 py-2.5 text-center text-[12px] leading-relaxed text-[var(--color-gold-soft)]/80">
            即時供應狀態暫時無法更新 · Live availability couldn't refresh — a few items may have
            just sold out. Staff will confirm your order.
          </p>
        )}

        <div className="mt-9" ref={menuSectionRef}>
          <CategoryRail active={active} onChange={handleCategoryChange} />
        </div>

        {/* Keyed on the chapter so every card remounts and replays its
            entrance — the chapter change reads as turning a page rather than
            as content silently swapping underneath the heading. */}
        <div key={active}>
          <SectionHeading
            title={activeCategory.nameEn}
            zh={CATEGORY_ZH[active]}
            blurb={activeCategory.blurb}
            count={items.length}
          />

          {/* Without this a fully sold-out or hidden chapter is just a heading
              over blank space, which reads as a failed load. */}
          {items.length === 0 ? (
            <div className="px-5">
              <p className="tp-rise rounded-2xl border border-dashed border-[var(--color-gold)]/30 px-4 py-8 text-center text-[13.5px] leading-relaxed text-[var(--color-cream)]/55">
                暫時售罄 · Nothing in this section is available right now.
                <span className="mt-1.5 block text-[12.5px] text-[var(--color-cream)]/35">
                  Please try another section, or ask our staff.
                </span>
              </p>
            </div>
          ) : (
            <div className="space-y-3 px-5">
              {items.map((item, idx) => (
                <div
                  key={item.id}
                  className="tp-rise"
                  // Cap the stagger so the twelfth row is not half a second
                  // behind the first.
                  style={{ ["--i" as string]: Math.min(idx, 7) }}
                >
                  <MenuItemCard
                    item={item}
                    variant={active === "signature" && idx < 2 ? "feature" : "list"}
                    qty={cart[item.id] ?? 0}
                    onAdd={addToCart}
                    onIncrease={increaseQty}
                    onDecrease={decreaseQty}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <footer className="mt-16 px-5 text-center">
          <div className="flex items-center justify-center gap-3">
            <span className="h-px w-12 bg-[var(--color-gold)]/35" />
            <span className="font-display text-[15px] tracking-[0.4em] text-[var(--color-gold-soft)]/80">
              第三空間
            </span>
            <span className="h-px w-12 bg-[var(--color-gold)]/35" />
          </div>
          <p className="mt-3 text-[10.5px] uppercase tracking-[0.24em] text-[var(--color-cream)]/40">
            The Third Place · Chinese BBQ &amp; Lounge
          </p>
          <p className="mt-1.5 text-[11px] text-[var(--color-cream)]/30">
            Near Assumption University · Powered by Atlas
          </p>
        </footer>
      </main>

      <CartTray count={cartCount} total={total} hasSoldOut={cartHasSoldOut} onOpen={openCheckout} />

      <CheckoutSheet
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        sessionKey={checkoutSession}
        items={cartItems}
        total={total}
        onIncrease={increaseQty}
        onDecrease={decreaseQty}
        onRemove={removeItem}
        onClear={clearCart}
        initialOrderType={orderType}
      />
    </div>
  );
}
