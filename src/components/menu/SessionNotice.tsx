import type { MenuSessionPlatform, MenuSessionState } from "@/lib/menuSession";

// Terminal states of a secure bot-session link (Phase 3D).
//
// Deliberately built from the visual vocabulary the approved menu already
// uses — ink-grain ground, gold hairline borders, the vermillion 訂 seal,
// bilingual headings, tp-rise entrances. No new design language, no restyling
// of anything that already exists.
//
// START NEW ORDER: the browser is structurally incapable of minting a session
// (only the trusted server route can), so this action returns the customer to
// the conversation instead of calling an endpoint. The deep link is built
// server-side from the BUSINESS's own public handle — never from the
// customer's chat id — and is null when no handle is configured, in which case
// this shows generic instructions rather than a broken or invented button.

type TerminalState = Exclude<MenuSessionState, "active">;

interface Props {
  state: TerminalState;
  returnToChat: { platform: MenuSessionPlatform | null; url: string | null };
  /** Present only for a completed session. */
  orderNumber?: string;
}

const PLATFORM_LABEL: Record<MenuSessionPlatform, string> = {
  instagram: "Instagram",
  messenger: "Messenger",
};

const COPY: Record<TerminalState, { zh: string; en: string; blurb: string }> = {
  completed: {
    zh: "訂單已送出",
    en: "Order received",
    blurb: "This link has already been used for your order. It can't place another one.",
  },
  expired: {
    zh: "連結已過期",
    en: "This link has expired",
    blurb: "Secure menu links stay open for 24 hours. This one has closed.",
  },
  revoked: {
    zh: "連結已更新",
    en: "This link was replaced",
    blurb: "A newer menu link was sent to your chat. Please use the most recent one.",
  },
  invalid: {
    zh: "連結無效",
    en: "This link isn't valid",
    blurb: "The link may be incomplete, or it was opened without its secure part.",
  },
};

export function SessionNotice({ state, returnToChat, orderNumber }: Props) {
  const copy = COPY[state];
  const { platform, url } = returnToChat;
  const chatName = platform ? PLATFORM_LABEL[platform] : null;

  return (
    <div className="relative min-h-dvh ink-grain">
      <div
        aria-hidden
        className="tp-ember pointer-events-none absolute inset-x-0 top-0 z-0 h-[70vh]"
      />

      <main className="relative z-10 mx-auto flex min-h-dvh max-w-[680px] flex-col items-center justify-center px-5 py-16 text-center">
        {/* The same chop mark the checkout confirmation stamps. */}
        <div className="tp-seal relative h-[74px] w-[74px] overflow-hidden rounded-[14px] border border-[var(--color-vermillion-deep)] bg-[var(--color-vermillion)] shadow-[0_20px_44px_-18px_oklch(0.45_0.18_27/0.9)]">
          <span className="font-display absolute inset-0 flex items-center justify-center text-[38px] leading-none text-[var(--color-cream)]">
            訂
          </span>
          <span
            aria-hidden
            className="tp-sheen absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-[var(--color-cream)]/45 to-transparent"
          />
        </div>

        <h1
          className="tp-display tp-rise mt-6 text-[30px] text-[var(--color-gold-soft)]"
          style={{ ["--i" as string]: 6 }}
        >
          {copy.en}
        </h1>
        <p
          className="tp-rise mt-1 text-[13px] tracking-[0.22em] text-[var(--color-cream)]/45"
          style={{ ["--i" as string]: 7 }}
        >
          {copy.zh}
        </p>

        {orderNumber && (
          <p
            className="tp-rise mt-4 rounded-full border border-[var(--color-gold)]/25 bg-[var(--color-ink)]/60 px-4 py-1.5 text-[12px] text-[var(--color-cream)]/55"
            style={{ ["--i" as string]: 8 }}
          >
            Order <span className="tp-num text-[var(--color-cream)]/85">{orderNumber}</span>
          </p>
        )}

        <p
          className="tp-rise mt-4 max-w-[38ch] text-[13.5px] leading-relaxed text-[var(--color-cream)]/60"
          style={{ ["--i" as string]: 9 }}
        >
          {copy.blurb}
        </p>

        {/* ── Start New Order ─────────────────────────────────────────────── */}
        <div
          className="tp-rise mt-8 w-full max-w-[420px] rounded-2xl border border-[var(--color-gold)]/15 bg-[var(--color-ink)]/60 px-5 py-5"
          style={{ ["--i" as string]: 10 }}
        >
          <h2 className="text-[10px] uppercase tracking-[0.24em] text-[var(--color-cream)]/45">
            再下一單 · Start New Order
          </h2>

          <p className="mt-3 text-[13.5px] leading-relaxed text-[var(--color-cream)]/70">
            {chatName
              ? `Return to your ${chatName} chat with us and send `
              : "Return to your chat with The Third Place and send "}
            <span className="text-[var(--color-gold-soft)]">menu</span>,{" "}
            <span className="text-[var(--color-gold-soft)]">order</span>, or{" "}
            <span className="text-[var(--color-gold-soft)]">start order</span> — we'll reply with a
            fresh secure link.
          </p>

          {url ? (
            <a
              href={url}
              rel="noreferrer"
              className="relative mt-4 flex w-full items-center justify-center rounded-2xl border border-[var(--color-vermillion-deep)] bg-[var(--color-vermillion)] py-3.5 text-[15px] font-semibold text-[var(--color-cream)] shadow-[0_22px_44px_-20px_oklch(0.45_0.18_27/0.8)] transition-transform duration-150 ease-[var(--ease-fluid)] active:scale-[0.985] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-gold)]"
            >
              Start New Order{chatName ? ` on ${chatName}` : ""}
            </a>
          ) : (
            // No configured handle — instructions only. Never a button that
            // goes nowhere, and never an invented destination.
            <p className="mt-3 text-[12px] leading-relaxed text-[var(--color-cream)]/45">
              Open the same conversation you received this link in.
            </p>
          )}
        </div>

        {/* ── Secondary: the ordinary public menu ─────────────────────────── */}
        <div className="tp-rise mt-6 max-w-[420px]" style={{ ["--i" as string]: 11 }}>
          <a
            href="/"
            className="relative text-[12px] uppercase tracking-[0.2em] text-[var(--color-cream)]/65 underline-offset-4 transition-colors duration-150 ease-[var(--ease-fluid)] hover:text-[var(--color-cream)]/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-gold)]"
          >
            Browse Public Menu
          </a>
          <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--color-cream)]/40">
            This opens our normal web menu. An order placed there is a direct web order and is
            {chatName
              ? ` not connected to your ${chatName} chat with us.`
              : " not connected to your chat with us."}
          </p>
        </div>
      </main>
    </div>
  );
}
