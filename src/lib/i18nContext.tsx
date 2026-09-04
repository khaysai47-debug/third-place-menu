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
  applyDocumentLanguage,
  DEFAULT_LANGUAGE,
  hasLanguageParam,
  LANGUAGE_QUERY_PARAM,
  resolveInitialLanguage,
  showFunctionalChinese,
  storeLanguage,
  translate,
  withLanguageParam,
  type CopyKey,
  type CopyParams,
  type Language,
} from "./i18n";

// The React half of the customer language seam. Everything decidable without
// React lives in ./i18n and is tested there; this file only holds the state,
// persists a change, keeps the URL honest, and keeps <html lang> honest.
//
// STAFF ISOLATION. This provider is mounted by the two CUSTOMER routes
// ("/" and "/m"), never at the router root. The staff and owner dashboards
// therefore never mount it, never consume it, and — because the document
// language is set from inside the provider AND restored when it unmounts —
// never inherit a customer's language on a shared browser. Their existing
// English/Chinese labels are untouched by design.

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: CopyKey, params?: CopyParams) => string;
  /** Whether information-bearing Chinese should render beside the English.
   *  See showFunctionalChinese in ./i18n for the policy this implements. */
  showZh: boolean;
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
  t: (key, params) => translate(key, DEFAULT_LANGUAGE, params),
  showZh: showFunctionalChinese(DEFAULT_LANGUAGE),
});

/** localStorage access itself throws in some privacy modes, so even reaching
 *  for the object is guarded. */
function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

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

/**
 * Keeps a `?lang=` already in the address bar pointing at the language the
 * customer is actually looking at.
 *
 * ONLY when the parameter is already there. A customer who arrived on a plain
 * "/" keeps a clean URL and relies on the stored preference; a customer who
 * arrived on "/m?lang=my#token" and then picks Thai gets "?lang=th", so a
 * refresh keeps Thai instead of the link forcing Myanmar back.
 *
 * replaceState, not push: choosing a language is not a place in history a
 * customer should have to press Back through.
 */
function syncLanguageParam(language: Language): void {
  if (typeof window === "undefined") return;
  const { pathname, search, hash } = window.location;
  if (!hasLanguageParam(search)) return;
  const nextSearch = withLanguageParam(search, language);
  if (nextSearch === search) return;
  try {
    window.history.replaceState(window.history.state, "", `${pathname}${nextSearch}${hash}`);
  } catch {
    // Non-fatal: the stored preference still carries the choice.
  }
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(initialLanguage);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    storeLanguage(next, safeLocalStorage());
    syncLanguageParam(next);
  }, []);

  // Sets the document language and restores whatever was there when this
  // provider goes away. The restore is the load-bearing half: navigating from
  // the customer menu to /staff unmounts this, and the dashboard must not be
  // left announcing itself as Burmese.
  useEffect(() => applyDocumentLanguage(document.documentElement, language), [language]);

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      setLanguage,
      t: (key, params) => translate(key, language, params),
      showZh: showFunctionalChinese(language),
    }),
    [language, setLanguage],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}

/** Sugar for the common case of needing only the lookup. */
export function useT(): (key: CopyKey, params?: CopyParams) => string {
  return useLanguage().t;
}

export { LANGUAGE_QUERY_PARAM };
