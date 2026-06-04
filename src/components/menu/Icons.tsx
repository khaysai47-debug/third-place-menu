// Custom Chinese-inspired line-art pictogram icons.
// Ink stroke on parchment, with optional vermillion accent.

import type { SVGProps } from "react";

const base: SVGProps<SVGSVGElement> = {
  viewBox: "0 0 48 48",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

export function StarChopsticksIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M14 38 L34 12" />
      <path d="M18 38 L38 12" />
      <path d="M24 22 l1.8 3.6 4 .6 -2.9 2.8 .7 4 -3.6 -1.9 -3.6 1.9 .7 -4 -2.9 -2.8 4 -.6 z"
        className="text-[var(--color-vermillion)]" stroke="currentColor" fill="currentColor" fillOpacity="0.85"/>
    </svg>
  );
}

export function SkewerFlameIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      {/* skewer stick */}
      <path d="M6 30 L42 18" />
      <circle cx="6.5" cy="30" r="1.2" fill="currentColor" />
      {/* meat chunks */}
      <rect x="14" y="22" width="6" height="6" rx="1.2" transform="rotate(-18 17 25)" />
      <rect x="22" y="20" width="6" height="6" rx="1.2" transform="rotate(-18 25 23)" />
      <rect x="30" y="18" width="6" height="6" rx="1.2" transform="rotate(-18 33 21)" />
      {/* flame */}
      <path d="M34 36 c-3 -3 -1 -6 1 -7 c-1 4 2 3 2 6 c0 2 -1.5 3 -3 1z"
        className="text-[var(--color-vermillion)]" stroke="currentColor" fill="currentColor" fillOpacity="0.85"/>
    </svg>
  );
}

export function WokIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M6 22 h36 a16 16 0 0 1 -36 0 z" />
      <path d="M42 22 l5 -2" />
      <path d="M18 16 c1 -3 3 -3 4 -1 M26 14 c1 -3 3 -3 4 -1" />
    </svg>
  );
}

export function NoodleBowlIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M8 26 h32 a16 14 0 0 1 -32 0 z" />
      <path d="M14 22 c4 -4 8 -2 10 0 s6 4 10 0" />
      <path d="M14 18 c4 -4 8 -2 10 0 s6 4 10 0" />
      <path d="M6 38 h36" />
    </svg>
  );
}

export function SoupBowlIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M8 24 h32 a16 16 0 0 1 -32 0 z" />
      <path d="M20 14 c-1 -3 2 -3 1 -6 M28 14 c-1 -3 2 -3 1 -6"
        className="text-[var(--color-vermillion)]" stroke="currentColor"/>
      <path d="M6 38 h36" />
    </svg>
  );
}

export function ShopBagIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M10 18 h28 l-2 22 h-24 z" />
      <path d="M18 18 v-4 a6 6 0 0 1 12 0 v4" />
      <path d="M16 26 h16" />
    </svg>
  );
}

export function ScooterIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="34" r="5" />
      <circle cx="36" cy="34" r="5" />
      <path d="M17 34 h14 l-3 -10 h-6 z" />
      <path d="M28 24 l4 -8 h6" />
    </svg>
  );
}

export function TableChopsticksIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M6 28 h36" />
      <path d="M12 28 v10 M36 28 v10" />
      <path d="M20 12 L28 26 M24 12 L30 26" />
    </svg>
  );
}

export function StampStarIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <rect x="10" y="10" width="28" height="28" rx="3"
        className="text-[var(--color-vermillion)]" stroke="currentColor" />
      <path d="M24 17 l2.2 4.5 5 .7 -3.6 3.5 .85 5 -4.45 -2.35 -4.45 2.35 .85 -5 -3.6 -3.5 5 -.7 z"
        className="text-[var(--color-vermillion)]" stroke="currentColor" fill="currentColor"/>
    </svg>
  );
}

export function SmokeMotif(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 120 60" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" {...props}>
      <path d="M6 40 c10 -12 22 12 32 0 s22 -12 32 0 s22 12 32 0" />
      <path d="M6 50 c10 -12 22 12 32 0 s22 -12 32 0 s22 12 32 0" opacity="0.5"/>
    </svg>
  );
}

export function PlusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...props}>
      <path d="M12 5v14M5 12h14"/>
    </svg>
  );
}
