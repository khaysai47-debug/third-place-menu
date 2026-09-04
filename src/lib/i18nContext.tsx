import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_QUERY_PARAM,
  resolveInitialLanguage,
  storeLanguage,
  translate,
  type CopyKey,
  type Language,
} from "./i18n";

// The React half of the customer language seam. Everything decidable without
// React lives in ./i18n and is tested there; this file only holds the state,
// persists a change, and keeps <html lang> honest.
//
// STAFF ISOLATION. This provider is mounted by the two CUSTOMER routes
// ("/" and "/m"), never at the router root. The staff and owner dashboards
// therefore never mount it, never consume it, and — because the document
// language is set from inside the provider rather than on <html> in
// __root.tsx — never inherit a customer's language on a shared browser.
// Their existing English/Chinese labels are untouched by design.

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: CopyKey) => string;
}

/**
 * The default is a working English context rather than `null`.
 *
 * A missing provider then renders English copy instead of throwing: a
 * customer mid-order must never get a blank screen because a component was
 * mounted outside the tree. The tests assert this fallback so the behaviour
 * is a decision, not an accident.
 */
const LanguageContext = createContext<LanguageContextValue>({
  language: DEFAULT_LANGUAGE,
  setLanguage: () => {},
  t: (key) => translate(key, DEFAULT_LANGUAGE),
});

/** Read once during render initialisation — the same synchronous pattern
 *  `isBrowseOnly()` in src/routes/index.tsx and the /m token capture use,
 *  because production is a static SPA with no server loader to read it in. */
function initialLanguage(): Language {
  if (typeof window === "undefined") return DEFAULT_LANGUAGE;
  return resolveInitialLanguage({
    search: window.location.search,
    storage: safeLocalStorage(),
  });
}

/** localStorage access itself throws in some privacy modes, so even reaching
 *  for the object is guarded. */
function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(initialLanguage);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    storeLanguage(next, safeLocalStorage());
  }, []);

  // Keeps the document language in step with the copy actually on screen —
  // it is what screen readers switch voice on, and what Safari offers
  // "Translate page" from. Only ever runs on a customer route.
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo<LanguageContextValue>(
    () => ({ language, setLanguage, t: (key) => translate(key, language) }),
    [language, setLanguage],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}

/** Sugar for the common case of needing only the lookup. */
export function useT(): (key: CopyKey) => string {
  return useLanguage().t;
}

export { LANGUAGE_QUERY_PARAM };
