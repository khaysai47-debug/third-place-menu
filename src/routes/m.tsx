import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { MenuScreen } from "@/components/menu/MenuScreen";
import { SessionNotice } from "@/components/menu/SessionNotice";
import { resolveMenuSession, type MenuSessionResult } from "@/lib/menuSession";
import {
  captureMenuSessionToken,
  clearMenuSessionToken,
  hasMenuSessionFragment,
} from "@/lib/menuSessionToken";

// The secure bot-session menu link (Phase 3D): /m#<token>
//
// ONE route, no token in the path. The server and every edge/CDN/proxy log see
// exactly `GET /m`; the token lives in the fragment, which is never sent in a
// request line and is always stripped from Referer.
//
// There is NO loader here on purpose. Production is a static SPA (vite.config
// spa.enabled + the vercel.json rewrite), so TanStack server loaders do not
// run there at all — the token is resolved by a client fetch to
// /api/menu-session/resolve, which works identically in dev and production.

export const Route = createFileRoute("/m")({
  head: () => ({
    meta: [
      { title: "Your Order — The Third Place" },
      // A one-customer secure link is not a page for search engines.
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: SecureMenuPage,
});

function SecureMenuPage() {
  const router = useRouter();
  // Captured SYNCHRONOUSLY during the first render, before any effect can
  // observe or clear the fragment.
  const [token] = useState(() => captureMenuSessionToken());
  const [result, setResult] = useState<MenuSessionResult | null>(null);
  const [lookupFailed, setLookupFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // Remove the token from the address bar (and so from history, screenshots
  // and screen-shares) the moment it has been captured. Router navigation
  // rather than history.replaceState, so the router's own location stays in
  // sync. The token survives in memory + the sessionStorage bridge, which is
  // what makes refresh and iOS tab-restore still work.
  useEffect(() => {
    if (hasMenuSessionFragment()) {
      void router.navigate({ to: "/m", hash: "", replace: true });
    }
  }, [router]);

  useEffect(() => {
    if (!token) {
      clearMenuSessionToken();
      setResult({ state: "invalid", returnToChat: { platform: null, url: null } });
      return;
    }
    let cancelled = false;
    setLookupFailed(false);
    resolveMenuSession(token).then(
      (resolved) => {
        if (cancelled) return;
        // Any terminal state means the bridged token has no further use.
        if (resolved.state !== "active") clearMenuSessionToken();
        setResult(resolved);
      },
      () => {
        // Transport failure is NOT an invalid link: keep the token and offer
        // a retry, or a refresh would silently discard a working session.
        if (!cancelled) setLookupFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, attempt]);

  if (lookupFailed) {
    return (
      <SecureMenuFrame>
        <h1 className="tp-display text-[26px] text-[var(--color-gold-soft)]">
          This didn&apos;t load
        </h1>
        <p className="mt-2 max-w-[34ch] text-[13.5px] leading-relaxed text-[var(--color-cream)]/60">
          We couldn&apos;t check your link just now. Your link is still fine — please try again.
        </p>
        <button
          onClick={() => setAttempt((a) => a + 1)}
          className="relative mt-6 rounded-2xl border border-[var(--color-gold)]/30 bg-[var(--color-ink)]/60 px-6 py-3 text-[13px] uppercase tracking-[0.18em] text-[var(--color-cream)]/80 transition-[transform,background-color] duration-150 ease-[var(--ease-fluid)] active:scale-[0.985] hover:bg-[var(--color-cream)]/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-gold)]"
        >
          Try again
        </button>
      </SecureMenuFrame>
    );
  }

  // One round-trip: a still frame reads better than a spinner that flashes.
  if (!result) {
    return (
      <SecureMenuFrame>
        <div className="tp-seal relative h-[74px] w-[74px] overflow-hidden rounded-[14px] border border-[var(--color-vermillion-deep)] bg-[var(--color-vermillion)]">
          <span className="font-display absolute inset-0 flex items-center justify-center text-[38px] leading-none text-[var(--color-cream)]">
            訂
          </span>
          <span
            aria-hidden
            className="tp-sheen-loop absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-[var(--color-cream)]/35 to-transparent"
          />
        </div>
        <p className="mt-6 text-[12px] uppercase tracking-[0.2em] text-[var(--color-cream)]/45">
          開啟菜單 · Opening your menu
        </p>
      </SecureMenuFrame>
    );
  }

  // A completed/expired/revoked/invalid link never mounts the menu at all, so
  // there is no window in which items could be added to a dead session.
  if (result.state !== "active") {
    return (
      <SessionNotice
        state={result.state}
        returnToChat={result.returnToChat}
        orderNumber={result.orderNumber}
      />
    );
  }

  // The approved menu, unchanged. token is non-null here (an absent token
  // resolves to "invalid" above).
  return <MenuScreen session={{ token: token! }} />;
}

/** Shared centred frame for the loading and lookup-failure states. */
function SecureMenuFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-dvh ink-grain">
      <div
        aria-hidden
        className="tp-ember pointer-events-none absolute inset-x-0 top-0 z-0 h-[70vh]"
      />
      <main className="relative z-10 mx-auto flex min-h-dvh max-w-[680px] flex-col items-center justify-center px-5 text-center">
        {children}
      </main>
    </div>
  );
}
