import type { ReactNode } from "react";

/** Icon-box edge length per size. Exported because the rails draw their
 *  sliding indicator at exactly this size — hardcoding it in two places is
 *  how the indicator drifts off its tile. */
export const TILE_PX = { sm: 56, md: 64 } as const;

interface Props {
  icon: ReactNode;
  label: string;
  sublabel?: string;
  active?: boolean;
  onClick?: () => void;
  size?: "sm" | "md";
}

/**
 * The approved menu's icon tile: light parchment box, dark ink pictogram,
 * label beneath.
 *
 * One change from the original: the box never paints itself vermillion.
 * Selection is drawn by a single vermillion chip that slides between tiles
 * in the parent rail and covers the active box exactly, so the active state
 * reads as one object travelling rather than two fills swapping. The tile
 * itself only tints its label.
 */
export function IconTile({ icon, label, sublabel, active, onClick, size = "md" }: Props) {
  const dim = size === "sm" ? "h-14 w-14" : "h-16 w-16";
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className="group flex w-full flex-col items-center gap-2 rounded-2xl transition-transform duration-150 ease-[var(--ease-fluid)] active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-gold)]"
    >
      <span
        className={`${dim} paper-grain flex items-center justify-center rounded-2xl border border-[var(--color-gold)]/40 text-[var(--color-ink)] shadow-[inset_0_-2px_0_oklch(0.7_0.05_75/0.25)]`}
      >
        <span className={size === "sm" ? "h-7 w-7" : "h-8 w-8"}>{icon}</span>
      </span>
      <span className="flex flex-col items-center leading-tight">
        <span
          className={[
            "text-[11px] font-medium uppercase tracking-wide transition-colors duration-200 ease-[var(--ease-fluid)]",
            active ? "text-[var(--color-vermillion-text)]" : "text-[var(--color-cream)]",
          ].join(" ")}
        >
          {label}
        </span>
        {sublabel && (
          <span className="text-[10px] text-[var(--color-muted-foreground)]">{sublabel}</span>
        )}
      </span>
    </button>
  );
}
