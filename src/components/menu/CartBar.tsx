interface CartItem {
  id: string;
  name: string;
  qty: number;
  subtotal: number;
}

interface Props {
  items: CartItem[];
  total: number;
  onIncrease: (id: string) => void;
  onDecrease: (id: string) => void;
  onClear: () => void;
  onCheckout: () => void;
}

function QtyButton({ onClick, children, label }: { onClick: () => void; children: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="h-6 w-6 rounded-full bg-[var(--color-cream)]/10 text-[var(--color-cream)] flex items-center justify-center text-[14px] leading-none hover:bg-[var(--color-cream)]/20 active:scale-90 transition"
    >
      {children}
    </button>
  );
}

export function CartBar({ items, total, onIncrease, onDecrease, onClear, onCheckout }: Props) {
  const count = items.reduce((s, i) => s + i.qty, 0);

  if (count === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 pointer-events-none">
      <div className="mx-auto max-w-[680px] px-4 pb-4">
        <div className="pointer-events-auto mb-2 rounded-2xl bg-[var(--color-ink)] border border-[var(--color-gold)]/20 px-4 pt-3 pb-2">
          <div className="overflow-y-auto max-h-[130px] space-y-2 pr-1">
            {items.map((item) => (
              <div key={item.id} className="flex items-center gap-2">
                <span className="font-display text-[14px] text-[var(--color-cream)] flex-1 truncate">{item.name}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <QtyButton onClick={() => onDecrease(item.id)} label="Decrease quantity">−</QtyButton>
                  <span className="font-display text-[13px] text-[var(--color-cream)] w-4 text-center">{item.qty}</span>
                  <QtyButton onClick={() => onIncrease(item.id)} label="Increase quantity">+</QtyButton>
                </div>
                <span className="font-display text-[14px] text-[var(--color-gold-soft)] w-12 text-right shrink-0">
                  ฿{item.subtotal}
                </span>
              </div>
            ))}
          </div>
          <div className="pt-1.5 border-t border-[var(--color-gold)]/15 flex justify-end">
            <button
              onClick={onClear}
              className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-cream)]/40 hover:text-[var(--color-cream)]/70 transition"
            >
              Clear cart
            </button>
          </div>
        </div>

        <button onClick={onCheckout} className="pointer-events-auto w-full flex items-center justify-between gap-3 rounded-2xl bg-[var(--color-vermillion)] text-[var(--color-cream)] px-5 py-3.5 shadow-[0_20px_40px_-18px_oklch(0.45_0.18_27/0.7)] border border-[var(--color-vermillion-deep)] active:scale-[0.99] transition">
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
