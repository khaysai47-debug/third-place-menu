import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Hero } from "@/components/menu/Hero";
import { LanguageSwitch } from "@/components/menu/LanguageSwitch";
import { FunctionalZh } from "@/components/menu/ChineseText";
import { ServiceRail } from "@/components/menu/ServiceRail";
import { CategoryRail } from "@/components/menu/CategoryRail";
import { SectionHeading } from "@/components/menu/SectionHeading";
import { MenuItemCard } from "@/components/menu/MenuItemCard";
import { CartTray } from "@/components/menu/CartTray";
import { CheckoutSheet } from "@/components/menu/CheckoutSheet";
import type { OrderType } from "@/components/menu/orderType";
import { CATEGORIES, MENU, type MenuCategoryId, type MenuItem } from "@/data/menu";
import { getMenuAvailability, type MenuAvailabilityStatus } from "@/lib/menuAvailability";
import { useT } from "@/lib/i18nContext";

// The approved customer menu. Extracted VERBATIM from src/routes/index.tsx in
// Phase 3D so that both "/" (normal web menu) and "/m" (secure bot-session
// link) render the SAME screen — the design is identical on both, by
// construction rather than by copy. This move changed no markup, no class, no
// animation, and no behaviour; the only addition is the optional `session`
// prop, which is forwarded to the checkout sheet and changes nothing visually.

/** Present only when the menu was opened through a secure bot-session link. */
export interface MenuSessionContext {
  /** Secure link token — sent in the checkout POST body, never in a URL. */
  token: string;
}

const CATEGORY_ZH: Record<MenuCategoryId, string> = {
  signature: "招牌",
  skewers: "串燒",
  "skewers-veg": "素串",
  "stir-fried": "小炒",
  "rice-noodles": "飯麵",
  soup: "湯品",
};

export function MenuScreen({
  session,
  browseOnly = false,
}: {
  session?: MenuSessionContext;
  /** Read-only mode for the Messenger "Menu" option: the SAME screen and the
   *  SAME src/data/menu.ts, with ordering switched off. Nothing is copied —
   *  the cart bar, the checkout sheet and the add controls simply are not
   *  mounted, so there is no second ordering path to keep in step.
   *
   *  It is the ENTRY state, not a permanent one: Order Now takes the customer
   *  out of it into this same screen's ordinary ordering tree. */
  browseOnly?: boolean;
}) {
  const t = useT();
  // Seeded by the prop, left ONLY by Order Now. Until that intentional tap
  // this is exactly the browse-only tree it was before: no add control, no
  // cart bar, no checkout sheet is mounted, so nothing is merely "disabled".
  const [browsing, setBrowsing] = useState(browseOnly);
  const [active, setActive] = useState<MenuCategoryId>("signature");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  // Incremented on every open so the checkout form remounts: one drawer
  // session = one intended order = one idempotency key.
  const [checkoutSession, setCheckoutSession] = useState(0);
  const [orderType, setOrderType] = useState<OrderType>("dine-in");
  const menuSectionRef = useRef<HTMLDivElement>(null);

  // Single scrolling pattern reused by the Popular tile and by category
  // selection, so both behave identically. Honours reduced-motion.
  const scrollToMenu = useCallback(() => {
    menuSectionRef.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
  }, []);

  // Popular is a shortcut into the Signature section, not an order type.
  const handlePopularClick = useCallback(() => {
    setActive("signature");
    scrollToMenu();
  }, [scrollToMenu]);

  // Changing section also returns to the top of the menu — otherwise a tap
  // made while deep in a long section drops the customer into the middle of
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

  // Skewers read as a price list, everything else as description-led cards.
  // Signature leads with two feature plates.
  const variantFor = (idx: number): "feature" | "row" | "compact" => {
    if (active === "signature") return idx < 2 ? "feature" : "compact";
    return active === "skewers" ? "row" : "compact";
  };

  return (
    <div className="relative min-h-dvh ink-grain">
      {/* Warm glow behind the hero only. Absolute rather than fixed, so
          everything past the fold sits on plain charcoal instead of a
          permanently tinted backdrop. */}
      <div
        aria-hidden
        className="tp-ember pointer-events-none absolute inset-x-0 top-0 z-0 h-[70vh]"
      />

      {/* pb-32 clears the cart bar (~64px plus the safe area) in every state,
          so the footer is never hidden behind it. */}
      <main className="relative z-10 mx-auto max-w-[680px] pb-32">
        <Hero />

        {/* Above the order-type tray and outside the browse ternary, so it is
            reachable in browse mode and in ordering mode alike. */}
        <LanguageSwitch />

        {/* The order-type tray answers "how are you eating", which is not a
            question this mode can act on — a dead selector is worse than none.
            The label below says plainly what this page is, and the bar at the
            bottom is the one way out of it. */}
        {browsing ? (
          <p className="tp-rise-sm mx-5 mt-4 rounded-xl border border-[var(--color-gold)]/25 bg-[var(--color-charcoal-soft)]/60 px-4 py-2.5 text-center text-[12px] leading-relaxed text-[var(--color-gold-soft)]/80">
            瀏覽菜單 · Browse only — read the full menu here. Ordering stays off until you ask for
            it.
            <span className="mt-1 block text-[11px] text-[var(--color-gold-soft)]/60">
              Tap “Order Now” below when you are ready.
            </span>
          </p>
        ) : (
          <div className="mt-2">
            <ServiceRail
              orderType={orderType}
              onOrderTypeChange={setOrderType}
              onPopularClick={handlePopularClick}
            />
          </div>
        )}

        {availabilityWarning && (
          <p className="tp-rise-sm mx-5 mt-4 rounded-xl border border-[var(--color-gold)]/25 bg-[var(--color-charcoal-soft)]/60 px-4 py-2.5 text-center text-[12px] leading-relaxed text-[var(--color-gold-soft)]/80">
            即時供應狀態暫時無法更新 · Live availability couldn't refresh — a few items may have
            just sold out. Staff will confirm your order.
          </p>
        )}

        <div className="mt-6" ref={menuSectionRef}>
          <CategoryRail active={active} onChange={handleCategoryChange} />
        </div>

        {/* Keyed on the section so every card remounts and replays its
            entrance — the section change reads as turning a page rather than
            as content silently swapping underneath the heading. */}
        <div key={active}>
          <SectionHeading
            eyebrow={active === "signature" ? "Chef's Table" : "Section"}
            title={activeCategory.nameEn}
            zh={CATEGORY_ZH[active]}
            blurb={activeCategory.blurb}
          />

          {/* Without this a fully sold-out or hidden section is just a heading
              over blank space, which reads as a failed load. */}
          {items.length === 0 ? (
            <div className="px-5">
              <p className="tp-rise paper-grain rounded-xl border border-[var(--color-gold)]/25 px-4 py-5 text-center text-[13px] leading-relaxed text-[var(--color-ink)]/75">
                <FunctionalZh>暫時售罄 · </FunctionalZh>
                {t("menu.sectionEmpty")}
                <span className="mt-1 block text-[12px] text-[var(--color-ink)]/60">
                  {t("menu.sectionEmptyHint")}
                </span>
              </p>
            </div>
          ) : (
            <div className={`px-5 ${active === "signature" ? "space-y-4" : "space-y-2.5"}`}>
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
                    variant={variantFor(idx)}
                    qty={cart[item.id] ?? 0}
                    onAdd={addToCart}
                    onIncrease={increaseQty}
                    onDecrease={decreaseQty}
                    browseOnly={browsing}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer mark */}
        <footer className="mt-14 px-5 text-center">
          <div className="flex items-center justify-center gap-3">
            <span className="h-px w-12 bg-[var(--color-gold)]/40" />
            <span className="font-display text-[15px] tracking-[0.4em] text-[var(--color-gold-soft)]">
              第三空間
            </span>
            <span className="h-px w-12 bg-[var(--color-gold)]/40" />
          </div>
          <p className="mt-3 text-[11px] uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]">
            The Third Place · Chinese BBQ &amp; Lounge
          </p>
          <p className="mt-1 text-[11px] text-[var(--color-muted-foreground)]">
            Near Assumption University · Powered by Atlas
          </p>
        </footer>
      </main>

      {/* Browse-only mounts NEITHER: "cart and checkout unavailable" is a fact
          about the tree, not a disabled button someone could re-enable.
          No total on the bar on purpose — prices stay on the cards while
          browsing and the full breakdown lives in the checkout sheet. */}
      {browsing ? (
        /* The way OUT of browse mode, in the slot the cart bar will occupy. A
           customer who decides to order at the bottom of a long menu should
           not have to find their way back to the chat to do it. This button
           mounts the ordering tree below and nothing else — it cannot add an
           item, and it never reaches checkout on its own. */
        <div className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-[680px] px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            onClick={() => setBrowsing(false)}
            className="flex w-full items-center justify-center gap-3 rounded-2xl border border-[var(--color-vermillion-deep)] bg-[var(--color-vermillion)] px-4 py-3 text-[15px] text-[var(--color-cream)] shadow-[0_20px_40px_-18px_oklch(0.45_0.18_27/0.7)] transition-transform duration-150 ease-[var(--ease-fluid)] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-gold)]"
          >
            開始點餐 · Order Now
          </button>
        </div>
      ) : (
        <>
          <CartTray count={cartCount} hasSoldOut={cartHasSoldOut} onOpen={openCheckout} />

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
            session={session}
          />
        </>
      )}
    </div>
  );
}
