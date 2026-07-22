// Owner Console — 「炭」 The Brazier.
//
// Presentation primitives for the owner dashboard. Everything here is
// surface, depth and motion; nothing here fetches, writes, or knows what an
// order is. The matching CSS lives under the ".oc-" block in src/styles.css.
//
// The system in one line: cards are lacquer slabs lit from above-left, they
// sit on explicit depth planes, and warmth means "this needs you".

import {
  useEffect,
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
} from "react";
import type { LucideIcon } from "lucide-react";
import { useCountUp } from "@/components/menu/useCountUp";
import { useTilt } from "@/components/owner/useTilt";
import { cn } from "@/lib/utils";

/* ---------- Slab ---------- */

interface SlabProps extends HTMLAttributes<HTMLDivElement> {
  /** Stagger position in its row. 40ms apart. */
  index?: number;
  /** Follow the pointer. Reserve it for cards worth touching. */
  tilt?: boolean;
  /** Rise one depth plane on hover. On by default. */
  lift?: boolean;
  /** Breathe a vermillion rim. Only ever driven by real, non-zero work. */
  alert?: boolean;
  /** Sits below the working plane — table shells, wells, insets. */
  recessed?: boolean;
}

/** A lacquer slab.
 *
 *  Two nested elements on purpose: the outer one carries the entrance
 *  animation, the inner one carries the tilt. Sharing them would let the
 *  entrance's final keyframe pin `transform` and silently kill the tilt. */
export function Slab({
  index = 0,
  tilt = false,
  lift = true,
  alert = false,
  recessed = false,
  className,
  children,
  style,
  ...rest
}: SlabProps) {
  const t = useTilt();
  return (
    <div
      className="oc-rise h-full"
      style={{ "--i": index } as CSSProperties}
    >
      <div
        ref={tilt ? (t.ref as RefObject<HTMLDivElement | null>) : undefined}
        onPointerEnter={tilt ? t.onPointerEnter : undefined}
        onPointerMove={tilt ? t.onPointerMove : undefined}
        onPointerLeave={tilt ? t.onPointerLeave : undefined}
        className={cn(
          "oc-slab h-full rounded-2xl",
          recessed && "oc-slab-recessed",
          lift && "oc-lift oc-spec",
          tilt && "oc-tilt",
          alert && "oc-alert",
          className,
        )}
        style={style}
        {...rest}
      >
        {children}
      </div>
    </div>
  );
}

/* ---------- Figures ---------- */

/** Money that settles rather than snapping, so a refresh shows the owner
 *  *that* a figure moved, not just its new value. Reduced motion and hidden
 *  tabs get the exact number immediately (handled inside useCountUp). */
export function Money({
  value,
  className,
  sign = true,
}: {
  value: number;
  className?: string;
  sign?: boolean;
}) {
  const n = useCountUp(value, 520);
  return (
    <span className={cn("oc-num", className)}>
      {sign && <span className="opacity-55">฿</span>}
      {n.toLocaleString("en-US")}
    </span>
  );
}

export function Count({ value, className }: { value: number; className?: string }) {
  const n = useCountUp(value, 420);
  return <span className={cn("oc-num", className)}>{n}</span>;
}

/* ---------- Headings ---------- */

/** Console section heading. The Chinese reading sits beside the English at
 *  the same weight rather than under it as a caption — this is a bilingual
 *  room, not an English room with translations bolted on. */
export function Eyebrow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "text-[10.5px] uppercase tracking-[0.24em] text-[var(--color-gold-soft)]/75",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function PanelHead({
  eyebrow,
  title,
  meta,
  icon: Icon,
  tone,
}: {
  eyebrow: string;
  title?: string;
  meta?: ReactNode;
  icon?: LucideIcon;
  tone?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[var(--oc-rule)] px-5 py-4 sm:px-6">
      <div className="flex min-w-0 items-start gap-2.5">
        {tone && (
          <span
            aria-hidden
            className="mt-0.5 h-4 w-[3px] shrink-0 rounded-full"
            style={{ background: tone }}
          />
        )}
        {Icon && (
          <Icon
            className="mt-[3px] h-3.5 w-3.5 shrink-0 text-[var(--color-gold-soft)]/70"
            strokeWidth={1.5}
          />
        )}
        <div className="min-w-0">
          <Eyebrow className="block truncate">{eyebrow}</Eyebrow>
          {title && (
            <h2 className="mt-1 font-display text-[21px] leading-tight tracking-[-0.01em] text-[var(--color-cream)]">
              {title}
            </h2>
          )}
        </div>
      </div>
      {meta && <div className="shrink-0 text-right">{meta}</div>}
    </div>
  );
}

/* ---------- Sparkline ---------- */

/** A revenue curve etched into the lower edge of a slab. Draws itself once
 *  on mount, then holds still — it is a shape, not an animation. */
export function Sparkline({
  points,
  className,
  stroke = "var(--color-gold)",
}: {
  points: number[];
  className?: string;
  stroke?: string;
}) {
  const [drawn, setDrawn] = useState(false);
  // Gradient ids are document-global; a second sparkline would otherwise
  // silently steal the first one's fill.
  const fillId = useId();
  useEffect(() => {
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => setDrawn(true));
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const d = useMemo(() => {
    if (points.length < 2) return null;
    const max = Math.max(...points, 1);
    const step = 100 / (points.length - 1);
    return points
      .map((p, i) => `${i === 0 ? "M" : "L"} ${(i * step).toFixed(2)} ${(28 - (p / max) * 26).toFixed(2)}`)
      .join(" ");
  }, [points]);

  if (!d) return null;

  return (
    <svg
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
      className={cn("h-full w-full", className)}
      aria-hidden
    >
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d={`${d} L 100 30 L 0 30 Z`}
        fill={`url(#${fillId})`}
        style={{
          opacity: drawn ? 1 : 0,
          transition: "opacity 700ms var(--ease-fluid) 260ms",
        }}
      />
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        pathLength={1}
        style={{
          strokeDasharray: 1,
          strokeDashoffset: drawn ? 0 : 1,
          transition: "stroke-dashoffset 900ms var(--ease-fluid) 120ms",
        }}
      />
    </svg>
  );
}

/* ---------- Brand mark ---------- */

/** Round grill / fire-ring emblem. Decorative, no data. */
export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" aria-hidden>
      <circle cx="16" cy="16" r="13.5" stroke="var(--color-gold)" strokeOpacity="0.55" strokeWidth="0.8" />
      <circle cx="16" cy="16" r="9.5" stroke="var(--color-gold)" strokeOpacity="0.35" strokeWidth="0.6" />
      <line x1="6" y1="16" x2="26" y2="16" stroke="var(--color-gold)" strokeOpacity="0.55" strokeWidth="0.6" />
      <line x1="8" y1="12" x2="24" y2="12" stroke="var(--color-gold)" strokeOpacity="0.3" strokeWidth="0.5" />
      <line x1="8" y1="20" x2="24" y2="20" stroke="var(--color-gold)" strokeOpacity="0.3" strokeWidth="0.5" />
      <circle cx="16" cy="16" r="1.4" fill="var(--color-vermillion)" />
    </svg>
  );
}

/* ---------- Live seal ---------- */

/** The chop mark. It breathes while the feed is live and goes flat and grey
 *  the moment it isn't, so "are we connected" is answerable at a glance from
 *  the pass. This is the console's only ornamental-looking element and it is
 *  load-bearing. */
export function LiveSeal({ live }: { live: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden
        className={cn(
          "grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[3px] border text-[9px] leading-none",
          live
            ? "oc-seal border-[var(--color-vermillion)]/70 bg-[var(--color-vermillion)]/18 text-[var(--color-vermillion)]"
            : "border-[var(--color-muted-foreground)]/40 text-[var(--color-muted-foreground)]",
        )}
      >
        營
      </span>
      <span
        className={cn(
          "text-[11px] uppercase tracking-[0.2em]",
          live ? "text-[var(--color-gold-soft)]/85" : "text-[var(--color-muted-foreground)]",
        )}
      >
        {live ? "Live · 營業中" : "Connecting"}
      </span>
    </span>
  );
}

/* ---------- Heat bed ---------- */

/** Charcoal glow under the command bar. `heat` is 0..1 — how much of the
 *  floor is currently working. At 0 the bed is nearly black and the room
 *  reads as closed; it never switches off entirely, so the console is alive
 *  even when nobody is touching it. */
export function EmberBed({ heat }: { heat: number }) {
  const clamped = Math.max(0, Math.min(1, heat));
  return (
    <div
      aria-hidden
      className="oc-ember h-[3px] w-full"
      style={{ "--oc-heat": clamped } as CSSProperties}
    >
      <span />
    </div>
  );
}
