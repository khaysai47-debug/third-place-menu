import { LANGUAGES, LANGUAGE_NAMES } from "@/lib/i18n";
import { useLanguage } from "@/lib/i18nContext";

/**
 * The customer language picker.
 *
 * Deliberately the smallest thing that works: a three-option radiogroup in
 * the vocabulary the menu already speaks (ink tray, gold hairline, vermillion
 * for the chosen one), matching ServiceRail's structure so it reads as part
 * of the same page rather than a control bolted on. No redesign, no new
 * design language, no dropdown to open.
 *
 * Each option is labelled in its OWN script — a customer who cannot read the
 * current language must still be able to find theirs.
 */
export function LanguageSwitch() {
  const { language, setLanguage, t } = useLanguage();

  return (
    <div className="flex justify-center px-5 pt-3">
      <div
        role="radiogroup"
        aria-label={t("language.label")}
        className="inline-flex items-center gap-1 rounded-full border border-[var(--color-gold)]/30 bg-[var(--color-ink)] p-1"
      >
        {LANGUAGES.map((option) => {
          const active = option === language;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={active}
              lang={option}
              onClick={() => setLanguage(option)}
              className={`rounded-full px-3 py-1.5 text-[12px] leading-none transition-[background-color,color] duration-200 ease-[var(--ease-fluid)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-gold)] ${
                active
                  ? "border border-[var(--color-vermillion-deep)] bg-[var(--color-vermillion)] text-[var(--color-cream)]"
                  : "border border-transparent text-[var(--color-cream)]/60"
              }`}
            >
              {LANGUAGE_NAMES[option]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
