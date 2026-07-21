import type { ReactNode } from "react";

interface Props {
  icon: ReactNode;
  label: string;
  sublabel?: string;
  active?: boolean;
  onClick?: () => void;
  size?: "sm" | "md";
}

export function IconTile({ icon, label, sublabel, active, onClick, size = "md" }: Props) {
  const dim = size === "sm" ? "h-14 w-14" : "h-16 w-16";
  return (
    <button
      onClick={onClick}
      className={[
        "group flex flex-col items-center gap-2 transition-transform duration-150 ease-out active:scale-95",
        "rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-gold)]",
      ].join(" ")}
    >
      <span
        className={[
          dim,
          "flex items-center justify-center rounded-2xl border transition-all",
          active
            ? "bg-[var(--color-vermillion)] text-[var(--color-cream)] border-[var(--color-vermillion-deep)] shadow-[0_6px_18px_-8px_oklch(0.45_0.18_27/0.6)]"
            : "paper-grain border-[var(--color-gold)]/40 text-[var(--color-ink)] shadow-[inset_0_-2px_0_oklch(0.7_0.05_75/0.25)]",
        ].join(" ")}
      >
        <span className={size === "sm" ? "h-7 w-7" : "h-8 w-8"}>{icon}</span>
      </span>
      <span className="flex flex-col items-center leading-tight">
        <span className={[
          "text-[11px] font-medium tracking-wide uppercase",
          active ? "text-[var(--color-vermillion)]" : "text-[var(--color-cream)]"
        ].join(" ")}>{label}</span>
        {sublabel && (
          <span className="text-[10px] text-[var(--color-muted-foreground)]">{sublabel}</span>
        )}
      </span>
    </button>
  );
}
