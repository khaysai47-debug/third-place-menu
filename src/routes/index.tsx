import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { MenuScreen } from "@/components/menu/MenuScreen";

// The public customer menu. The screen itself lives in
// src/components/menu/MenuScreen.tsx so that the Phase 3D secure bot-session
// link ("/m") renders the IDENTICAL menu rather than a copy of it. This route
// keeps the public page's own head/SEO metadata; "/m" deliberately does not
// carry it (a one-customer secure link is not a page for search engines).

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "The Third Place — Chinese BBQ & Lounge | E-Menu" },
      {
        name: "description",
        content:
          "Chinese BBQ made for sharing. Browse the menu and order for dine-in, pickup, or delivery from The Third Place, near Assumption University.",
      },
      { property: "og:title", content: "The Third Place — Chinese BBQ & Lounge" },
      {
        property: "og:description",
        content:
          "Chinese BBQ made for sharing. Browse the menu and order for dine-in, pickup, or delivery from The Third Place.",
      },
    ],
  }),
  component: MenuPage,
});

/**
 * `?browse=1` is what the Messenger "Menu" option opens: the SAME screen and
 * the SAME src/data/menu.ts, read-only. It is a query parameter on this route
 * rather than a route of its own precisely so there is no second copy of the
 * menu to drift.
 *
 * Read synchronously during render initialisation, the way /m captures its
 * token — production is a static SPA (vite spa.enabled + the vercel.json
 * rewrite), so there is no loader to read it in. Exact "1" only: nothing is
 * inferred from a bare or unexpected value.
 */
function isBrowseOnly(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("browse") === "1";
}

// No session: an order placed here is a normal direct web order
// (source "customer_menu", zero n8n executions).
function MenuPage() {
  const [browseOnly] = useState(isBrowseOnly);
  return <MenuScreen browseOnly={browseOnly} />;
}
