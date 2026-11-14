/**
 * Ticker prüfen und vereinheitlichen, für alle Eingaben (Einzeleingabe, Watchlist, Termine, Massen-Import).
 * Klassen-Aktien schreiben Broker unterschiedlich (Schwab «BRK/B», andere «BRK.B»); die Kursquelle kennt
 * nur «BRK-B». Börsenkürzel wie «NESN.SW» oder «VOD.L» und Devisen wie «CHF=X» bleiben, wie sie sind.
 */
export const TICKER = /^[A-Z0-9][A-Z0-9.\-/^=]{0,11}$/

/** Vereinheitlichter Ticker in Grossbuchstaben, oder null, wenn er ungültig ist. */
export function normTicker(raw: string | null | undefined): string | null {
  const t = (raw ?? '').trim().toUpperCase()
  if (!TICKER.test(t)) return null
  return t.replace(/\//g, '-').replace(/^([A-Z]{1,5})\.([AB])$/, '$1-$2')
}
