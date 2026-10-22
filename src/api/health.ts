/** Remembers whether the last catalog request failed on the network; provider detection listens to every outcome. */
let failed = false;
const listeners = new Set<(ok: boolean) => void>();

function emit(ok: boolean): void {
  failed = !ok;
  listeners.forEach((l) => l(ok));
}

/** A catalog request ended without any answer (offline, blocked, DNS, timeout). */
export const reportCatalogFailure = (): void => emit(false);
export const reportCatalogOk = (): void => emit(true);
export const catalogFailed = (): boolean => failed;

/** Called on every reported outcome: true for an answer, false for a network failure. */
export function onCatalogOutcome(l: (ok: boolean) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
