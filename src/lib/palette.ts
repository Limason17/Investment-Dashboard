import { defaultFilter } from 'cmdk'

/**
 * Trefferliste: Ein Ticker, der genau passt, steht zuoberst (Enter öffnet ihn), dann Ticker, die so beginnen,
 * dann Einträge, die das Gesuchte als Wortteil enthalten; unscharfe Treffer nur bei ein oder zwei Zeichen.
 */
export function paletteFilter(value: string, search: string, keywords?: string[]) {
  const q = search.trim().toLowerCase()
  const base = defaultFilter ? defaultFilter(value, search, keywords) : 0
  if (!q || !base) return base
  const v = value.toLowerCase()
  const tk = /^(position|watchlist) (\S+)/.exec(v)?.[2]
  if (tk === q) return 4
  if (tk?.startsWith(q)) return 3
  if (v.split(/\s+/).some((w) => w.startsWith(q))) return 2 + base / 10
  if (v.includes(q)) return 1 + base / 10
  // Ab drei Zeichen nur noch echte Teiltreffer: «nvda» soll nicht «Vanguard» finden (n…v…d…a)
  if (q.length >= 3) return 0
  return base / 10
}
