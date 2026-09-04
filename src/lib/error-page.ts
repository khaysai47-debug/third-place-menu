import { DEFAULT_LANGUAGE, parseLanguage, translate, type CopyKey, type Language } from "./i18n";

// The catastrophic-failure page: what a customer gets when the app itself
// could not be served. It is a STRING of HTML with no React, no bundle, no
// storage and no i18n runtime — which is the whole point, because the reason
// it is showing may be that none of those loaded.
//
// It therefore takes its language as an ARGUMENT rather than reading one. The
// caller may have a `?lang=` or an Accept-Language to hand; when it has
// nothing, English. An unrecognised value is not an error and not a guess: it
// resolves to English through the same parseLanguage the rest of the app uses,
// so "zh" or "en-US" can never reach the markup or the lang attribute.

/** HTML-escape. The copy here comes from the dictionary rather than from a
 *  request, but it is INTERPOLATED INTO MARKUP, and text that becomes markup
 *  gets escaped on principle — an apostrophe or an ampersand in a future
 *  translation must render, not break the document. */
function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char] ?? char,
  );
}

/**
 * @param language A language tag from the request when one is known — a
 *   `?lang=` value, or an Accept-Language prefix. Anything unrecognised,
 *   absent or malformed renders English.
 */
export function renderErrorPage(language?: string | Language | null): string {
  const lang = parseLanguage(typeof language === "string" ? language : null) ?? DEFAULT_LANGUAGE;
  // Escaped at the point of interpolation, so every string below is safe by
  // construction rather than by remembering to do it.
  const copy = (key: CopyKey) => escapeHtml(translate(key, lang));

  return `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="utf-8" />
    <title>${copy("errorPage.title")}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font: 15px/1.5 system-ui, -apple-system, sans-serif; background: #fafafa; color: #111; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
      .card { max-width: 28rem; width: 100%; text-align: center; padding: 2rem; }
      h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
      p { color: #4b5563; margin: 0 0 1.5rem; }
      .actions { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
      a, button { padding: 0.5rem 1rem; border-radius: 0.375rem; font: inherit; cursor: pointer; text-decoration: none; border: 1px solid transparent; }
      .primary { background: #111; color: #fff; }
      .secondary { background: #fff; color: #111; border-color: #d1d5db; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${copy("errorPage.title")}</h1>
      <p>${copy("errorPage.blurb")}</p>
      <div class="actions">
        <button class="primary" onclick="location.reload()">${copy("errorPage.tryAgain")}</button>
        <a class="secondary" href="/">${copy("errorPage.goHome")}</a>
      </div>
    </div>
  </body>
</html>`;
}
