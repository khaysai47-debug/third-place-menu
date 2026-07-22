import { createFileRoute } from "@tanstack/react-router";
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

// No session: an order placed here is a normal direct web order
// (source "customer_menu", zero n8n executions).
function MenuPage() {
  return <MenuScreen />;
}
