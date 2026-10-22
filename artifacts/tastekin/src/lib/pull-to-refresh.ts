// Pull-to-refresh for the native shell. The page scrolls on the document
// and the WebView's own bounce is off (Capacitor sets scrollView.bounces =
// false; the CSS sets overscroll-behavior none), so the gesture is tracked
// in JS: a downward drag that starts with the page at the very top shows an
// indicator that follows the finger with resistance, ticks at the threshold,
// and on release runs the screen's refresh while a spinner shows.
//
// Pure helpers are unit-tested (scripts/tests/native-pull-to-refresh.test.mjs);
// `usePullToRefresh` is the DOM/React wiring and is a no-op unless `enabled`.
import { useCallback, useEffect, useRef, useState } from 'react';

/** Finger travel (px) at which releasing triggers a refresh. */
export const PULL_THRESHOLD = 72;
/** The indicator never travels further than this, whatever the finger does. */
export const PULL_MAX = 110;
/** Vertical travel before the gesture is treated as a pull at all. */
export const PULL_SLOP = 8;

/**
 * Indicator offset for a given finger travel: 1:1 up to the threshold, then
 * a square-root easing that approaches PULL_MAX, so a long drag feels heavy
 * rather than detaching the indicator.
 */
export function pullDistance(dy: number): number {
  if (dy <= 0) return 0;
  if (dy <= PULL_THRESHOLD) return dy;
  const extra = Math.sqrt(dy - PULL_THRESHOLD) * 3;
  return Math.min(PULL_MAX, PULL_THRESHOLD + extra);
}

/** 0..1 progress towards the threshold, for the indicator's arrow rotation. */
export function pullProgress(dy: number): number {
  return Math.max(0, Math.min(1, dy / PULL_THRESHOLD));
}

/** True when a release at this travel should refresh. */
export function shouldRefresh(dy: number): boolean {
  return dy >= PULL_THRESHOLD;
}

/** A pull only starts with the page scrolled to the very top and no text field focused. */
export function canStartPull(scrollTop: number, activeTag: string | null | undefined): boolean {
  if (scrollTop > 0) return false;
  const tag = (activeTag || '').toLowerCase();
  return tag !== 'input' && tag !== 'textarea' && tag !== 'select';
}

export type PullState = { pulling: boolean; refreshing: boolean; distance: number; progress: number; armed: boolean };

const IDLE: PullState = { pulling: false, refreshing: false, distance: 0, progress: 0, armed: false };

type Options = {
  enabled: boolean;
  onRefresh: () => Promise<unknown> | unknown;
  /** Fired once per pull when the threshold is first crossed (haptic hook). */
  onArm?: () => void;
};

export function usePullToRefresh({ enabled, onRefresh, onArm }: Options): PullState {
  const [state, setState] = useState<PullState>(IDLE);
  const refreshRef = useRef(onRefresh);
  const armRef = useRef(onArm);
  refreshRef.current = onRefresh;
  armRef.current = onArm;
  const refreshingRef = useRef(false);

  const runRefresh = useCallback(async () => {
    refreshingRef.current = true;
    setState({ pulling: false, refreshing: true, distance: PULL_THRESHOLD * 0.75, progress: 1, armed: true });
    const startedAt = Date.now();
    try { await refreshRef.current(); } catch { /* the screen shows its own error state */ }
    // Keep the spinner visible long enough to read as a refresh, not a flicker.
    const remaining = 450 - (Date.now() - startedAt);
    if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
    refreshingRef.current = false;
    setState(IDLE);
  }, []);

  useEffect(() => {
    if (!enabled) { setState(IDLE); return; }
    let tracking = false;
    let intent: 'pull' | 'other' | 'undecided' = 'undecided';
    let startY = 0;
    let startX = 0;
    let armed = false;
    let lastDy = 0;

    const onTouchStart = (event: TouchEvent) => {
      if (refreshingRef.current || event.touches.length !== 1) return;
      const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
      if (!canStartPull(scrollTop, document.activeElement?.tagName)) return;
      tracking = true;
      intent = 'undecided';
      armed = false;
      lastDy = 0;
      startY = event.touches[0].clientY;
      startX = event.touches[0].clientX;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!tracking || event.touches.length !== 1) return;
      const dy = event.touches[0].clientY - startY;
      const dx = event.touches[0].clientX - startX;
      if (intent === 'undecided') {
        if (Math.abs(dy) < PULL_SLOP && Math.abs(dx) < PULL_SLOP) return;
        intent = dy > 0 && dy > Math.abs(dx) ? 'pull' : 'other';
        if (intent === 'other') { tracking = false; return; }
      }
      if (dy <= 0) { lastDy = 0; setState({ ...IDLE, pulling: true }); return; }
      lastDy = dy;
      const nowArmed = shouldRefresh(dy);
      if (nowArmed && !armed) { armed = true; armRef.current?.(); }
      if (!nowArmed) armed = false;
      setState({ pulling: true, refreshing: false, distance: pullDistance(dy), progress: pullProgress(dy), armed: nowArmed });
    };
    const finish = () => {
      if (!tracking) return;
      tracking = false;
      if (intent !== 'pull') return;
      if (shouldRefresh(lastDy)) void runRefresh();
      else setState(IDLE);
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('touchend', finish, { passive: true });
    document.addEventListener('touchcancel', finish, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', finish);
      document.removeEventListener('touchcancel', finish);
    };
  }, [enabled, runRefresh]);

  return state;
}
