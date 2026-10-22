// iOS-style edge swipe-back for the native shell, driven in JS so the
// screen visibly follows the finger and the app — not WKWebView — decides
// what "back" means (App.tsx's history model: the gesture ends in the same
// `history.back()` the on-screen arrow uses, so the navigation-history
// behaviour is unchanged).
//
// The pure helpers are unit-tested (scripts/tests/native-swipe-back.test.mjs);
// `useSwipeBack` is the DOM/React wiring and is a no-op unless `enabled`.
import { useEffect, type RefObject } from 'react';

/** Touches must start within this many CSS px of the leading edge. */
export const EDGE_WIDTH = 28;
/** Commit when the finger travelled this fraction of the screen width… */
export const COMMIT_FRACTION = 0.35;
/** …or when it moved at least this far at this speed (px per ms). */
export const FLICK_MIN_DISTANCE = 40;
export const FLICK_MIN_VELOCITY = 0.45;
/** Beyond this much vertical travel before horizontal intent, it's a scroll. */
export const INTENT_SLOP = 10;

export type SwipeVerdict = 'commit' | 'cancel';

/** True when a touch at `x` starts on the leading edge (left in LTR, right in RTL). */
export function isEdgeStart(x: number, width: number, rtl: boolean): boolean {
  if (width <= 0) return false;
  return rtl ? x >= width - EDGE_WIDTH : x <= EDGE_WIDTH;
}

/**
 * Progress of a swipe along the back direction, in px (never negative).
 * In LTR the finger moves right (dx > 0); in RTL it moves left (dx < 0).
 */
export function backProgress(dx: number, rtl: boolean): number {
  const along = rtl ? -dx : dx;
  return along > 0 ? along : 0;
}

/** Decides whether a finished swipe goes back or snaps the screen home. */
export function evaluateSwipe(input: { progress: number; width: number; elapsedMs: number }): SwipeVerdict {
  const { progress, width, elapsedMs } = input;
  if (width <= 0 || progress <= 0) return 'cancel';
  if (progress >= width * COMMIT_FRACTION) return 'commit';
  const velocity = elapsedMs > 0 ? progress / elapsedMs : 0;
  if (progress >= FLICK_MIN_DISTANCE && velocity >= FLICK_MIN_VELOCITY) return 'commit';
  return 'cancel';
}

/** Once the finger has moved more than the slop, horizontal wins over vertical or the gesture is abandoned. */
export function resolveIntent(dx: number, dy: number, rtl: boolean): 'horizontal' | 'vertical' | 'undecided' {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < INTENT_SLOP && ay < INTENT_SLOP) return 'undecided';
  if (ax > ay && backProgress(dx, rtl) > 0) return 'horizontal';
  return 'vertical';
}

type Options = {
  enabled: boolean;
  rtl: boolean;
  /** The element that follows the finger (the screen wrapper). */
  target: RefObject<HTMLElement | null>;
  /** Called once a swipe commits; the caller performs the real navigation. */
  onBack: () => void;
};

/**
 * Attaches the edge gesture to `document` while `enabled`. The wrapper is
 * translated during the drag (class `screen-view-dragging`), then either
 * slides fully out and `onBack()` fires, or snaps back (class
 * `screen-view-settling` for the short transition). The inline transform
 * is always cleared afterwards so the screen-change animation in CSS can
 * take over on the next mount.
 */
export function useSwipeBack({ enabled, rtl, target, onBack }: Options): void {
  useEffect(() => {
    if (!enabled) return;
    let tracking = false;
    let intent: 'horizontal' | 'vertical' | 'undecided' = 'undecided';
    let startX = 0;
    let startY = 0;
    let startedAt = 0;
    let lastProgress = 0;

    const el = () => target.current;
    const clear = () => {
      const node = el();
      if (!node) return;
      node.style.transform = '';
      node.classList.remove('screen-view-dragging', 'screen-view-settling');
    };
    const setProgress = (progress: number) => {
      const node = el();
      if (!node) return;
      node.style.transform = `translateX(${rtl ? -progress : progress}px)`;
    };

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      if (!isEdgeStart(touch.clientX, window.innerWidth, rtl)) return;
      tracking = true;
      intent = 'undecided';
      startX = touch.clientX;
      startY = touch.clientY;
      startedAt = event.timeStamp;
      lastProgress = 0;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!tracking || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (intent === 'undecided') {
        intent = resolveIntent(dx, dy, rtl);
        if (intent === 'vertical') { tracking = false; return; }
        if (intent === 'undecided') return;
        el()?.classList.add('screen-view-dragging');
      }
      // Horizontal: the screen follows the finger and the page must not scroll.
      if (event.cancelable) event.preventDefault();
      lastProgress = backProgress(dx, rtl);
      setProgress(lastProgress);
    };
    const finish = (event: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      if (intent !== 'horizontal') { clear(); return; }
      const node = el();
      const width = window.innerWidth;
      const verdict = evaluateSwipe({ progress: lastProgress, width, elapsedMs: event.timeStamp - startedAt });
      if (!node) { if (verdict === 'commit') onBack(); return; }
      node.classList.remove('screen-view-dragging');
      node.classList.add('screen-view-settling');
      if (verdict === 'commit') {
        setProgress(width);
        // Let the slide-out play, then navigate; the new screen mounts fresh.
        window.setTimeout(() => { clear(); onBack(); }, 160);
      } else {
        setProgress(0);
        window.setTimeout(clear, 200);
      }
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', finish, { passive: true });
    document.addEventListener('touchcancel', finish, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', finish);
      document.removeEventListener('touchcancel', finish);
      clear();
    };
  }, [enabled, rtl, target, onBack]);
}
