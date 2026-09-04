import type { ReactNode } from "react";
import { useLanguage } from "@/lib/i18nContext";

/**
 * The two kinds of Chinese on this menu, made explicit.
 *
 * The customer menu was bilingual English + 中文 long before it had a language
 * picker, and those two kinds were never distinguished — which is exactly the
 * distinction a Burmese or Thai customer needs us to get right.
 */

/**
 * IDENTITY. The restaurant's own name and marks — 第三空間 beside "The Third
 * Place", the 訂 chop. This is who the place IS, not information about an
 * order, so it is preserved in EVERY language, unchanged.
 *
 * Announced rather than hidden, and tagged lang="zh-Hant" so a screen reader
 * switches voice for it instead of spelling Chinese out in English phonemes.
 * A restaurant's name is worth hearing.
 */
export function IdentityZh({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span lang="zh-Hant" className={className}>
      {children}
    </span>
  );
}

/**
 * FUNCTIONAL. Chinese that carries information and today sits beside an
 * English phrase saying the same thing — 暫時售罄 next to "Nothing in this
 * section is available right now", 堂食 under "Dine In", the 招牌/串燒 category
 * names.
 *
 * Rendered ONLY in English mode, preserving the existing English + 中文
 * pairing. In Myanmar or Thai it renders nothing: repeating the message in a
 * third language the customer did not choose, beside the one they did, is
 * noise at best and confusing at worst.
 *
 * aria-hidden because when it IS shown, the English immediately beside it
 * already says it — a screen reader should announce that once, not twice.
 *
 * Put any separator inside the children (`暫時售罄 · `) so it disappears with
 * the Chinese rather than being left stranded in front of Burmese text.
 */
export function FunctionalZh({ children, className }: { children: ReactNode; className?: string }) {
  const { showZh } = useLanguage();
  if (!showZh) return null;
  return (
    <span lang="zh-Hant" aria-hidden className={className}>
      {children}
    </span>
  );
}
