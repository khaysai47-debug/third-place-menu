interface Props { count: number; total: number; }

export function CartBar({ count, total }: Props) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 pointer-events-none">
      <div className="mx-auto max-w-[680px] px-4 pb-4">
        <button
          className="pointer-events-auto w-full flex items-center justify-between gap-3 rounded-2xl bg-[var(--color-vermillion)] text-[var(--color-cream)] px-5 py-3.5 shadow-[0_20px_40px_-18px_oklch(0.45_0.18_27/0.7)] border border-[var(--color-vermillion-deep)] active:scale-[0.99] transition"
        >
          <span className="flex items-center gap-3">
            <span className="h-9 w-9 rounded-full bg-[var(--color-cream)]/15 flex items-center justify-center font-display text-[15px]">
              {count}
            </span>
            <span className="flex flex-col items-start leading-tight">
              <span className="text-[11px] uppercase tracking-[0.2em] opacity-80">Your order</span>
              <span className="font-display text-[17px]">฿{total.toLocaleString()}</span>
            </span>
          </span>
          <span className="text-[12px] uppercase tracking-[0.22em] font-medium">View Cart →</span>
        </button>
      </div>
    </div>
  );
}
