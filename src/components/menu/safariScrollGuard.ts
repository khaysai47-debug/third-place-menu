// Mobile Safari scroll and focus protection, without a second repositioner.
//
// WHY THIS EXISTS
//
//   vaul 1.1.2 gates BOTH of these on one `repositionInputs` prop:
//
//     usePreventScroll({ isDisabled: … || !repositionInputs || !disablePreventScroll })
//     function onVisualViewportChange() { if (!drawerRef.current || !repositionInputs) return; … }
//
//   The second is vaul's own field repositioning, which competes with
//   ./keyboardInset. The first is `preventScrollMobileSafari`, which is not
//   repositioning at all — it is the protection that stops Safari scrolling the
//   page out from under a fixed drawer. Turning the prop off to settle
//   ownership therefore also threw away protections we still need, which is
//   what this restores.
//
//   What it deliberately does NOT restore is the `scrollIntoView(target)` call
//   inside vaul's own focus handler. That is the repositioning half, and
//   ./keyboardInset owns it. Bringing it back would put two controllers on one
//   field again — the thing that made this flaky on a real device.
//
// WHAT SAFARI DOES THAT HAS TO BE PREVENTED (vaul's own list, verified in
// node_modules/vaul/dist/index.mjs):
//
//   1. With the toolbars collapsed, the page always scrolls.
//   2. The keyboard does not resize the viewport, it covers it, so the page
//      becomes scrollable underneath.
//   3. Tapping an input always scrolls the page to centre it — which can carry
//      a `position: fixed` drawer off the screen with it.
//   4. The keyboard's next/previous buttons scroll the whole page, even when a
//      nested scroller could have handled it.
//
// One thing vaul does that this does NOT need to: offsetting the body by the
// scroll position. `usePositionFixed` is not gated on `repositionInputs`, still
// runs, and already pins the body with `position: fixed; top: -scrollY` on
// Safari. Duplicating it here would mean two writers of one style.

export interface ScrollableLike {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  /** documentElement or body — i.e. scrolling it scrolls the page. */
  readonly isWindowLevel: boolean;
}

export interface InputLike {
  readonly style: { transform: string };
  readonly dataset: Record<string, string | undefined>;
  focus(): void;
}

export interface GuardEvent {
  readonly target: unknown;
  readonly changedTouches?: ReadonlyArray<{ pageY: number }>;
  preventDefault(): void;
}

/** The platform. Real globals in the browser, stubs under test. */
export interface GuardHost {
  /** iOS only. Everywhere else this whole module is a no-op. */
  readonly isSupported: boolean;
  readonly activeElement: unknown;
  on(target: "document" | "window", type: string, handler: (event: GuardEvent) => void): () => void;
  requestAnimationFrame(callback: () => void): number;
  scrollParentOf(target: unknown): ScrollableLike | null;
  /** The element as an input, or null when it is not one. */
  asInput(target: unknown): InputLike | null;
  scrollWindowToTop(): void;
}

/**
 * Marks the field ./keyboardInset must not measure right now.
 *
 * While an input is parked off-screen its rect is a lie, and a correction
 * computed from it would scroll the form to a nonsense position. Declared on
 * both sides rather than imported across, so each module compiles standalone;
 * the suite asserts the two literals are identical.
 */
export const PARKED_ATTRIBUTE = "keyboardParked";

export function attachSafariScrollGuard(host: GuardHost): () => void {
  if (!host.isSupported) return () => {};

  let scrollable: ScrollableLike | null = null;
  let lastY = 0;

  const onTouchStart = (event: GuardEvent) => {
    scrollable = host.scrollParentOf(event.target);
    if (!scrollable || scrollable.isWindowLevel) return;
    lastY = event.changedTouches?.[0]?.pageY ?? 0;
  };

  const onTouchMove = (event: GuardEvent) => {
    // Outside any scroller, the gesture would scroll the window behind a fixed
    // drawer. (1) and (2).
    if (!scrollable || scrollable.isWindowLevel) {
      event.preventDefault();
      return;
    }
    const y = event.changedTouches?.[0]?.pageY ?? 0;
    const bottom = scrollable.scrollHeight - scrollable.clientHeight;
    if (bottom === 0) return;
    // At either end Safari hands the gesture to the window instead, so the
    // page scrolls rather than the list overscrolling. This costs the bounce.
    if ((scrollable.scrollTop <= 0 && y > lastY) || (scrollable.scrollTop >= bottom && y < lastY)) {
      event.preventDefault();
    }
    lastY = y;
  };

  // Park the input far off-screen so Safari has nothing worth scrolling to,
  // then release it on the next frame. No scrollIntoView: revealing the field
  // belongs to ./keyboardInset and to nothing else.
  const park = (input: InputLike) => {
    input.style.transform = "translateY(-2000px)";
    input.dataset[PARKED_ATTRIBUTE] = "1";
    host.requestAnimationFrame(() => {
      input.style.transform = "";
      delete input.dataset[PARKED_ATTRIBUTE];
    });
  };

  // (3) Tapping an input. The park has to be in place BEFORE the focus event,
  // so the focus is taken over rather than left to Safari.
  const onTouchEnd = (event: GuardEvent) => {
    const input = host.asInput(event.target);
    if (!input || event.target === host.activeElement) return;
    event.preventDefault();
    park(input);
    input.focus();
  };

  // (4) Focus arriving some other way — the keyboard's next/previous buttons,
  // which is exactly the table-number to notes path. Parking inside the focus
  // event is enough for that case.
  const onFocus = (event: GuardEvent) => {
    const input = host.asInput(event.target);
    if (input) park(input);
  };

  // Last resort: if the page scrolled anyway, put it back. The body is already
  // pinned by vaul's usePositionFixed, so the top is where it belongs.
  const onWindowScroll = () => host.scrollWindowToTop();

  const detachers = [
    host.on("document", "touchstart", onTouchStart),
    host.on("document", "touchmove", onTouchMove),
    host.on("document", "touchend", onTouchEnd),
    host.on("document", "focus", onFocus),
    host.on("window", "scroll", onWindowScroll),
  ];
  return () => detachers.forEach((detach) => detach());
}

const INPUT_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/** The nearest ancestor that actually scrolls, mirroring vaul's getScrollParent. */
function scrollParent(node: Element | null): ScrollableLike | null {
  let current: Element | null = node;
  while (current) {
    const style = window.getComputedStyle(current);
    if (/(auto|scroll)/.test(style.overflow + style.overflowY + style.overflowX)) break;
    current = current.parentElement;
  }
  const found = current ?? document.documentElement;
  return {
    get scrollTop() {
      return found.scrollTop;
    },
    get scrollHeight() {
      return found.scrollHeight;
    },
    get clientHeight() {
      return found.clientHeight;
    },
    isWindowLevel: found === document.documentElement || found === document.body,
  };
}

export const browserGuardHost = (): GuardHost => ({
  // The same test vaul uses: every iOS browser is Safari underneath.
  isSupported:
    typeof navigator !== "undefined" &&
    (/iP(hone|ad|od)/.test(navigator.platform) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)),
  get activeElement() {
    return document.activeElement;
  },
  on(target, type, handler) {
    const node: EventTarget = target === "window" ? window : document;
    const listener = handler as EventListener;
    // Capture and non-passive, or preventDefault would be ignored.
    const options = { passive: false, capture: true };
    node.addEventListener(type, listener, options);
    return () => node.removeEventListener(type, listener, options);
  },
  requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
  scrollParentOf: (target) => scrollParent(target instanceof Element ? target : null),
  asInput: (target) =>
    target instanceof HTMLElement && INPUT_TAGS.has(target.tagName)
      ? (target as unknown as InputLike)
      : null,
  scrollWindowToTop: () => window.scrollTo(0, 0),
});
