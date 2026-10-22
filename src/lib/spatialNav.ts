/**
 * Arrow-key navigation for TV remotes and keyboards: moves focus to the nearest focusable element
 * in the pressed direction.
 */
export type Direction = 'up' | 'down' | 'left' | 'right';

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Index of the best candidate box from `from` in `dir`, or -1. Pure. */
export function pickNext(from: Box, candidates: Box[], dir: Direction): number {
  const cx = (from.left + from.right) / 2;
  const cy = (from.top + from.bottom) / 2;
  let best = -1;
  let bestScore = Infinity;
  candidates.forEach((b, i) => {
    const bx = (b.left + b.right) / 2;
    const by = (b.top + b.bottom) / 2;
    let main: number;
    let cross: number;
    switch (dir) {
      case 'right':
        main = b.left - from.right + 1;
        cross = Math.abs(by - cy);
        if (bx <= cx) return;
        break;
      case 'left':
        main = from.left - b.right + 1;
        cross = Math.abs(by - cy);
        if (bx >= cx) return;
        break;
      case 'down':
        main = b.top - from.bottom + 1;
        cross = Math.abs(bx - cx);
        if (by <= cy) return;
        break;
      case 'up':
        main = from.top - b.bottom + 1;
        cross = Math.abs(bx - cx);
        if (by >= cy) return;
        break;
    }
    // Rows matter more than columns: stay on the same row/column when possible.
    const score = Math.max(0, main) + cross * (dir === 'left' || dir === 'right' ? 3 : 0.6);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

const KEYS: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
const FOCUSABLE = 'a[href], button:not([disabled]), input, select, [tabindex]:not([tabindex="-1"])';

function visible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.bottom > -200 && r.top < window.innerHeight + 200 && getComputedStyle(el).visibility !== 'hidden';
}

/** Installs the global handler; elements inside [data-nav-ignore] (the player, inputs) handle arrows themselves. */
export function installSpatialNav(): () => void {
  const onKey = (e: KeyboardEvent) => {
    const dir = KEYS[e.key];
    if (!dir || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const active = document.activeElement as HTMLElement | null;
    if (active?.closest('[data-nav-ignore]')) return;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.tagName === 'TEXTAREA')) {
      if (dir === 'left' || dir === 'right') return;
    }
    const scope: ParentNode = (document.querySelector('[data-nav-scope]') as HTMLElement | null) ?? document;
    const els = Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el !== active && visible(el));
    if (!els.length) return;
    if (!active || active === document.body) {
      e.preventDefault();
      els[0]?.focus();
      return;
    }
    const i = pickNext(active.getBoundingClientRect(), els.map((el) => el.getBoundingClientRect()), dir);
    const target = els[i];
    if (target) {
      e.preventDefault();
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
