// Staff expense view: add-expense form + today's expense list.
// Data goes through the expense repository (n8n bridge today, Supabase after
// separation). No localStorage — all data lives in the backend.

import { useCallback, useEffect, useRef, useState } from "react";
import { getExpenseRepository } from "@/lib/data/expenseRepository";
import type { Expense, ExpenseCategory, ExpensePaidFrom } from "@/lib/expenses";

const expenseRepo = getExpenseRepository();

type LoadState = "loading" | "error" | "ready";

const baht = (n: number) => `฿${n.toLocaleString("en-US")}`;

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/* ── Dropdown option definitions ──────────────────────────────────────────── */

interface DropdownOption<T> {
  value: T;
  emoji: string;
  label: string;
}

const PAID_FROM_OPTIONS: DropdownOption<ExpensePaidFrom>[] = [
  { value: "Cash",       emoji: "💵", label: "Cash" },
  { value: "Transfer",   emoji: "🏦", label: "Transfer" },
  { value: "Owner Paid", emoji: "👑", label: "Owner Paid" },
  { value: "Other",      emoji: "❓", label: "Other" },
];

const CATEGORY_OPTIONS: DropdownOption<ExpenseCategory>[] = [
  { value: "Drinks",       emoji: "🥤", label: "Drinks" },
  { value: "Ingredient",   emoji: "🥩", label: "Ingredient" },
  { value: "Stock Refill", emoji: "📦", label: "Stock Refill" },
  { value: "Utility",      emoji: "🔧", label: "Utility" },
  { value: "Delivery",     emoji: "🛵", label: "Delivery" },
  { value: "Other",        emoji: "❓", label: "Other" },
];

/* Paid-from short labels used in expense list badges (no emoji — badge is small) */
const PAID_FROM_LABEL: Record<ExpensePaidFrom, string> = {
  Cash: "Cash",
  Transfer: "Transfer",
  "Owner Paid": "Owner",
  Other: "Other",
};

const CATEGORY_COLOR: Record<ExpenseCategory, string> = {
  Drinks:        "bg-sky-500/15 text-sky-300",
  Ingredient:    "bg-emerald-500/15 text-emerald-300",
  "Stock Refill":"bg-amber-500/15 text-amber-300",
  Utility:       "bg-violet-500/15 text-violet-300",
  Delivery:      "bg-orange-500/15 text-orange-300",
  Other:         "bg-stone-500/15 text-stone-300",
};

const inputCls =
  "w-full rounded-2xl border border-[var(--color-gold)]/20 bg-[var(--color-charcoal-soft)]/70 px-4 text-[16px] text-[var(--color-cream)] placeholder:text-[var(--color-muted-foreground)] focus:outline-none focus:border-[var(--color-gold)]/50 transition";

const labelCls =
  "block text-[11px] uppercase tracking-[0.18em] text-[var(--color-gold-soft)]/80 mb-2";

/* ── Custom themed dropdown ───────────────────────────────────────────────── */
// Replaces native <select> so the panel matches the Atlas dark theme.
// Value submitted to the backend is always the raw option.value (no emoji).

function SelectDropdown<T extends string>({
  id,
  value,
  options,
  onChange,
}: {
  id?: string;
  value: T;
  options: readonly DropdownOption<T>[];
  onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value) ?? options[0];

  // Close when clicking outside
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative" onKeyDown={handleKeyDown}>
      {/* Trigger button */}
      <button
        id={id}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-14 w-full items-center justify-between gap-2 rounded-2xl border border-[var(--color-gold)]/20 bg-[var(--color-charcoal-soft)]/70 px-4 text-[16px] text-[var(--color-cream)] transition hover:border-[var(--color-gold)]/40 focus:border-[var(--color-gold)]/50 focus:outline-none"
      >
        <span>
          {selected.emoji}{" "}
          <span className="ml-0.5">{selected.label}</span>
        </span>
        {/* Chevron — flips when open */}
        <svg
          viewBox="0 0 12 8"
          className={`h-3 w-3 shrink-0 text-[var(--color-muted-foreground)] transition-transform duration-150 ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M1 1l5 5 5-5" />
        </svg>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-2xl border border-[var(--color-gold)]/22 bg-[var(--color-charcoal)] shadow-[0_10px_40px_-10px_oklch(0_0_0/0.75)]"
        >
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`flex h-12 w-full items-center gap-3 px-4 text-left text-[15px] transition-colors ${
                  isSelected
                    ? "bg-[var(--color-gold)]/12 text-[var(--color-gold)]"
                    : "text-[var(--color-cream)]/85 hover:bg-[var(--color-gold)]/8 hover:text-[var(--color-cream)]"
                }`}
              >
                <span className="text-[18px] leading-none">{opt.emoji}</span>
                <span className="flex-1">{opt.label}</span>
                {isSelected && (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-gold)]" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Main view ────────────────────────────────────────────────────────────── */

export function ExpenseView() {
  // ── form state ──────────────────────────────────────────────────────────
  const [itemName, setItemName] = useState("");
  const [amount, setAmount] = useState("");
  const [paidFrom, setPaidFrom] = useState<ExpensePaidFrom>("Cash");
  const [category, setCategory] = useState<ExpenseCategory>("Drinks");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── list state ──────────────────────────────────────────────────────────
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const loadingRef = useRef(false);

  const loadExpenses = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoadState("loading");
    try {
      setExpenses(await expenseRepo.listExpenses());
      setLoadState("ready");
    } catch (err) {
      console.error("Failed to load expenses", err);
      setLoadState("error");
    } finally {
      loadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    void loadExpenses();
  }, [loadExpenses]);

  // ── form submit ─────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedName = itemName.trim();
    const parsedAmount = parseFloat(amount);

    if (!trimmedName) {
      setFormError("Item name is required.");
      return;
    }
    if (!amount || Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      setFormError("Enter a valid amount greater than 0.");
      return;
    }

    setSubmitting(true);
    const result = await expenseRepo.addExpense({
      item_name: trimmedName,
      amount: parsedAmount,
      paid_from: paidFrom,
      category,
      note: note.trim() || undefined,
      created_by: "Staff iPad",
    });
    setSubmitting(false);

    if (!result.success) {
      setFormError(result.error);
      return;
    }

    // Success — reset form, show banner, reload list
    setItemName("");
    setAmount("");
    setPaidFrom("Cash");
    setCategory("Drinks");
    setNote("");

    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    setSuccessMsg(`Logged: ${trimmedName} — ${baht(parsedAmount)}`);
    successTimerRef.current = setTimeout(() => setSuccessMsg(null), 4000);

    void loadExpenses();
  };

  const todayTotal = expenses.reduce((sum, e) => sum + e.amount, 0);

  return (
    <div className="px-5 pb-16">
      {/* ── Add expense form ─────────────────────────────────────────── */}
      <section className="mt-5 rounded-2xl border border-[var(--color-gold)]/20 bg-[var(--color-charcoal-soft)]/50 px-5 py-6">
        <div className="mb-5 flex items-baseline justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--color-gold-soft)]/80">
              Record Purchase
            </div>
            <h2 className="mt-0.5 font-display text-[22px] leading-tight text-[var(--color-cream)]">
              Add Expense
            </h2>
          </div>
          <span className="text-[11px] text-[var(--color-muted-foreground)]">Staff iPad</span>
        </div>

        {/* Success banner */}
        {successMsg && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
            <span className="flex items-center gap-2 text-[14px] text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {successMsg}
            </span>
            <button
              type="button"
              onClick={() => setSuccessMsg(null)}
              className="text-[16px] leading-none text-emerald-400/60 transition hover:text-emerald-300"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        )}

        {/* Error banner */}
        {formError && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-[var(--color-vermillion)]/35 bg-[var(--color-vermillion)]/10 px-4 py-3">
            <p className="text-[14px] text-[var(--color-cream)]/90">{formError}</p>
            <button
              type="button"
              onClick={() => setFormError(null)}
              className="text-[16px] leading-none text-[var(--color-cream)]/50 transition hover:text-[var(--color-cream)]/80"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} noValidate className="space-y-4">
          {/* Item name */}
          <div>
            <label htmlFor="exp-item" className={labelCls}>
              Item / What was bought
            </label>
            <input
              id="exp-item"
              type="text"
              required
              placeholder="e.g. Ice, Beer, Charcoal"
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              className={`${inputCls} h-14`}
            />
          </div>

          {/* Amount */}
          <div>
            <label htmlFor="exp-amount" className={labelCls}>
              Amount (THB ฿)
            </label>
            <input
              id="exp-amount"
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              required
              placeholder="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={`${inputCls} h-14`}
            />
          </div>

          {/* Paid From + Category — custom themed dropdowns */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="exp-paid-from" className={labelCls}>
                Paid From
              </label>
              <SelectDropdown
                id="exp-paid-from"
                value={paidFrom}
                options={PAID_FROM_OPTIONS}
                onChange={setPaidFrom}
              />
            </div>

            <div>
              <label htmlFor="exp-category" className={labelCls}>
                Category
              </label>
              <SelectDropdown
                id="exp-category"
                value={category}
                options={CATEGORY_OPTIONS}
                onChange={setCategory}
              />
            </div>
          </div>

          {/* Note (optional) */}
          <div>
            <label htmlFor="exp-note" className={labelCls}>
              Note{" "}
              <span className="normal-case tracking-normal text-[var(--color-muted-foreground)]">
                (optional)
              </span>
            </label>
            <textarea
              id="exp-note"
              rows={2}
              placeholder="e.g. emergency restock before dinner service"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={`${inputCls} py-3.5 resize-none`}
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting}
            className="h-14 w-full rounded-2xl bg-[var(--color-vermillion)] text-[16px] font-semibold tracking-[0.02em] text-[var(--color-cream)] transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Logging…" : "Log Expense"}
          </button>
        </form>
      </section>

      {/* ── Today's expense list ──────────────────────────────────────── */}
      <section className="mt-8">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--color-gold-soft)]/80">
              Today
            </div>
            <h2 className="mt-0.5 font-display text-[20px] leading-tight text-[var(--color-cream)]">
              Expenses
              {loadState === "ready" && expenses.length > 0 && (
                <span className="ml-3 staff-num text-[16px] text-[var(--color-gold)]">
                  {baht(todayTotal)}
                </span>
              )}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => void loadExpenses()}
            disabled={loadState === "loading"}
            className="flex items-center gap-1.5 rounded-full border border-[var(--color-gold)]/20 bg-[var(--color-charcoal-soft)]/60 px-3.5 py-2 text-[12px] text-[var(--color-gold-soft)]/90 transition hover:text-[var(--color-cream)] active:scale-[0.97] disabled:opacity-50"
          >
            <RefreshIcon spinning={loadState === "loading"} />
            Refresh
          </button>
        </div>

        {loadState === "loading" ? (
          <ExpenseLoadingState />
        ) : loadState === "error" ? (
          <ExpenseErrorState onRetry={() => void loadExpenses()} />
        ) : expenses.length === 0 ? (
          <ExpenseEmptyState />
        ) : (
          <ul className="space-y-3">
            {expenses.map((exp) => (
              <ExpenseRow key={exp.id} expense={exp} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ── Sub-components ───────────────────────────────────────────────────────── */

function ExpenseRow({ expense }: { expense: Expense }) {
  return (
    <li className="rounded-2xl border border-[var(--color-gold)]/15 bg-[var(--color-charcoal-soft)]/50 px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-medium text-[var(--color-cream)]">
            {expense.itemName}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${CATEGORY_COLOR[expense.category]}`}
            >
              {expense.category}
            </span>
            <span className="inline-flex items-center rounded-full bg-[var(--color-gold)]/10 px-2.5 py-0.5 text-[11px] font-medium text-[var(--color-gold-soft)]">
              {PAID_FROM_LABEL[expense.paidFrom]}
            </span>
            {expense.note && (
              <span className="truncate text-[12px] text-[var(--color-muted-foreground)]">
                {expense.note}
              </span>
            )}
          </div>
        </div>

        <div className="shrink-0 text-right">
          <div className="staff-num text-[22px] font-semibold text-[var(--color-gold)]">
            {baht(expense.amount)}
          </div>
          <div className="staff-num mt-0.5 text-[11px] text-[var(--color-muted-foreground)]">
            {formatTime(expense.createdAt)}
          </div>
        </div>
      </div>
    </li>
  );
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`h-3.5 w-3.5 ${spinning ? "animate-spin" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M13.5 8A5.5 5.5 0 1 1 8 2.5a5.5 5.5 0 0 1 4.5 2.33" />
      <polyline points="13.5 2.5 13.5 4.83 11.17 4.83" />
    </svg>
  );
}

function ExpenseLoadingState() {
  return (
    <div className="mt-4 flex items-center justify-center gap-1.5 py-8">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-2 w-2 rounded-full bg-[var(--color-gold)]/60 animate-pulse"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </div>
  );
}

function ExpenseErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-[var(--color-vermillion)]/35 bg-[var(--color-charcoal-soft)]/60 px-5 py-8 text-center">
      <p className="font-display text-[18px] text-[var(--color-cream)]">
        Could not load expenses
      </p>
      <p className="mt-1.5 text-[13px] text-[var(--color-muted-foreground)]">
        Check connection and try again.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 h-12 rounded-full bg-[var(--color-vermillion)] px-8 text-[15px] font-semibold text-[var(--color-cream)] transition active:scale-[0.97]"
      >
        Retry
      </button>
    </div>
  );
}

function ExpenseEmptyState() {
  return (
    <div className="py-10 text-center">
      <div className="mx-auto mb-3 flex items-center justify-center gap-3">
        <span className="h-px w-10 bg-[var(--color-gold)]/35" />
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-gold)]/50" />
        <span className="h-px w-10 bg-[var(--color-gold)]/35" />
      </div>
      <p className="font-display text-[18px] text-[var(--color-gold-soft)]/75">
        No expenses logged today
      </p>
      <p className="mt-1 text-[12px] text-[var(--color-muted-foreground)]">
        Use the form above to record a purchase.
      </p>
    </div>
  );
}
