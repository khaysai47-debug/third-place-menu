// Keeping the focused field above the iOS software keyboard.
//
// This lives outside the component for one reason: it is the only part of the
// checkout sheet whose correctness cannot be observed without a physical
// iPhone. Source-string assertions about a `useEffect` prove nothing, so the
// logic takes its platform as an argument and a test drives it with a fake
// viewport, a fake clock and fake elements.
//
// WHY IT IS NEEDED AT ALL
//
//   iOS Safari does not shrink the LAYOUT viewport when the keyboard opens,
//   only the visual one. The sheet is `fixed` and 92dvh tall, so it keeps its
//   full height while the keyboard covers the bottom of it — including the last
//   fields and the submit button.
//
// WHAT THE FIRST ATTEMPT GOT WRONG
//
//   1. It watched only `resize`. Moving from table number to notes while the
//      keyboard is ALREADY open changes no viewport, so nothing ran.
//   2. It corrected once, on one animation frame (~16ms), in the middle of the
//      iOS keyboard animation (~300ms) that keeps firing `resize` as it goes.
//   3. It used `scrollIntoView`, which asks every ancestor including the layout
//      viewport to scroll and which iOS then animates back — and at the bottom
//      of the list there was no scroll room left for any method to use.

/** The visual viewport, narrowed to what this needs. */
export interface ViewportLike {
  readonly height: number;
  readonly offsetTop: number;
  addEventListener(type: "resize" | "scroll", listener: () => void): void;
  removeEventListener(type: "resize" | "scroll", listener: () => void): void;
}

export interface FieldLike {
  getBoundingClientRect(): { top: number; bottom: number };
}

export interface ContainerLike extends FieldLike {
  scrollTop: number;
  contains(node: unknown): boolean;
  addEventListener(type: "focusin", listener: () => void): void;
  removeEventListener(type: "focusin", listener: () => void): void;
}

/** The platform. Real globals in the browser, stubs under test. */
export interface KeyboardHost {
  readonly innerHeight: number;
  readonly activeElement: FieldLike | null;
  readonly viewport: ViewportLike | null;
  requestAnimationFrame(callback: () => void): number;
  cancelAnimationFrame(handle: number): void;
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(handle: number): void;
}

/**
 * When to re-run the correction after an event.
 *
 * The iOS keyboard animates for roughly 300ms and reports a different viewport
 * throughout. Only the LAST correction matters; the earlier ones just keep the
 * field roughly in place while it moves.
 */
export const CORRECTION_DELAYS = [120, 280, 450] as const;

/** Breathing room between the field and the top of the keyboard. */
const GAP = 16;

export const browserKeyboardHost = (): KeyboardHost => ({
  get innerHeight() {
    return window.innerHeight;
  },
  get activeElement() {
    return document.activeElement as FieldLike | null;
  },
  get viewport() {
    return window.visualViewport;
  },
  requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
  cancelAnimationFrame: (handle) => window.cancelAnimationFrame(handle),
  setTimeout: (callback, delay) => window.setTimeout(callback, delay),
  clearTimeout: (handle) => window.clearTimeout(handle),
});

/**
 * Keep the focused field inside `container` above the keyboard.
 *
 * `onInsetChange` receives how much of the layout viewport the keyboard covers.
 * The caller turns that into bottom padding, which is what gives the LAST field
 * somewhere to scroll to — without it no amount of scrolling can lift it clear.
 * It is 0 whenever there is no software keyboard, so desktop and tablet get no
 * padding and no movement.
 *
 * @returns the cleanup that removes every listener and cancels every pending
 *          correction. Closing and reopening the sheet must not accumulate
 *          either, and a timer that fires after unmount would touch a detached
 *          container.
 */
export function attachKeyboardInset(
  container: ContainerLike,
  onInsetChange: (inset: number) => void,
  host: KeyboardHost = browserKeyboardHost(),
  delays: readonly number[] = CORRECTION_DELAYS,
): () => void {
  const viewport = host.viewport;

  const reveal = () => {
    const covered = viewport
      ? Math.max(0, host.innerHeight - viewport.height - viewport.offsetTop)
      : 0;
    onInsetChange(covered);

    // Nothing moves unless a field inside THIS form holds focus. A desktop
    // window resize, or a keyboard closing with nothing focused, must not
    // touch the scroll position.
    const field = host.activeElement;
    if (!field || typeof field.getBoundingClientRect !== "function") return;
    if (!container.contains(field)) return;

    const visibleBottom = viewport ? viewport.height + viewport.offsetTop : host.innerHeight;
    const box = field.getBoundingClientRect();
    const below = box.bottom + GAP - visibleBottom;
    const above = container.getBoundingClientRect().top + GAP - box.top;
    // An already-visible field is left exactly where it is.
    if (below > 0) container.scrollTop += below;
    else if (above > 0) container.scrollTop -= above;
  };

  let frame = 0;
  let timers: number[] = [];
  const schedule = () => {
    host.cancelAnimationFrame(frame);
    for (const timer of timers) host.clearTimeout(timer);
    frame = host.requestAnimationFrame(reveal);
    timers = delays.map((delay) => host.setTimeout(reveal, delay));
  };

  // `focusin` is what covers a focus change while the keyboard is already open,
  // when no viewport event fires at all. `resize` and `scroll` cover the
  // keyboard opening, closing, or being moved by the browser.
  container.addEventListener("focusin", schedule);
  viewport?.addEventListener("resize", schedule);
  viewport?.addEventListener("scroll", schedule);

  return () => {
    container.removeEventListener("focusin", schedule);
    viewport?.removeEventListener("resize", schedule);
    viewport?.removeEventListener("scroll", schedule);
    host.cancelAnimationFrame(frame);
    for (const timer of timers) host.clearTimeout(timer);
  };
}
