/**
 * Erzeugt Testdaten für die Vorschau in data-demo/*.json. Die echten Daten in data/ werden nie angefasst.
 *
 *   npm run seed   Testdaten neu schreiben: Stand 22.10.2026 aus vorlage/seed + erfundener Verlauf
 *                  (Kurse, Einstände, ältere Buchungen, Dividenden, Tageswerte). Alles Erfundene trägt demo: true.
 *   npm run demo   Testdaten schreiben und die Vorschau auf http://localhost:5175 starten.
 *
 * Optional ein Datum als Argument (JJJJ-MM-TT), sonst gilt das heutige Datum.
 * Deterministisch: gleicher Aufruf, gleiche Daten.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'vorlage', 'seed')
const OUT = path.join(ROOT, 'data-demo')
const args = process.argv.slice(2)
const pad = (n) => String(n).padStart(2, '0')
const localISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const TODAY = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? localISO(new Date())

const load = (name) => JSON.parse(fs.readFileSync(path.join(SRC, name + '.json'), 'utf8'))
const save = (name, data) => {
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(path.join(OUT, name + '.json'), JSON.stringify(data, null, 1) + '\n', 'utf8')
}
const r2 = (v) => Math.round(v * 100) / 100
const r4 = (v) => Math.round(v * 10000) / 10000

const NAMES = ['positions', 'prices', 'watchlist', 'pots', 'events', 'log', 'transactions', 'dividends', 'snapshots', 'meta']
const seed = Object.fromEntries(NAMES.map((n) => [n, load(n)]))


/* ------------------------------------------------------------------ Kalender */
const HOLIDAYS = new Set([
  '2025-11-27', '2025-12-25', '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19',
  '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25', '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26',
  '2027-05-31', '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
])
const iso = (d) => d.toISOString().slice(0, 10)
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d) }
const isTrading = (s) => { const wd = new Date(s + 'T12:00:00Z').getUTCDay(); return wd !== 0 && wd !== 6 && !HOLIDAYS.has(s) }
const nextTrading = (s) => { while (!isTrading(s)) s = addDays(s, 1); return s }

const START = '2025-11-03'
const ANCHOR = '2026-10-22' // letzter bestätigter Depotstand: echte Schlusskurse
let END = addDays(TODAY, -1)
while (!isTrading(END)) END = addDays(END, -1)
if (END < ANCHOR) END = ANCHOR

const days = []
for (let d = START; d <= END; d = addDays(d, 1)) if (isTrading(d)) days.push(d)
const idx = Object.fromEntries(days.map((d, i) => [d, i]))
const iA = idx[ANCHOR]
const N = days.length - 1

/* ------------------------------------------------------------------ Zufall (fest) */
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const rnd = mulberry32(Number(process.env.SEED ?? 82)) // fester Startwert: gleiche Testdaten bei jedem Aufruf
const gauss = () => { let u = 0, v = 0; while (u === 0) u = rnd(); while (v === 0) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) }

/* ------------------------------------------------------------------ Testkurse
   Ticker: [Kurs am START (erfunden), Kurs am END (erfunden), Jahresvolatilität, Beta zum Marktfaktor]
   Der Schlusskurs vom 22.10.2026 (und bei Positionen der Vortag) ist echt und bleibt der Ankerpunkt. */
const CFG = {
  VTI: [331.0, 381.42, 0.15, 1.0], VXUS: [71.5, 83.95, 0.14, 0.85], QQQM: [252.0, 297.6, 0.2, 1.2], VTV: [205.0, 228.1, 0.13, 0.8],
  ADBE: [338.0, 262.3, 0.33, 1.2], CI: [296.0, 322.75, 0.26, 0.6], RMD: [238.0, 249.4, 0.27, 0.8], INTU: [392.0, 361.2, 0.3, 1.2],
  DECK: [98.0, 81.15, 0.4, 1.2], UHS: [201.0, 193.6, 0.3, 0.8], UBER: [74.0, 67.84, 0.36, 1.3], NICE: [141.0, 119.8, 0.34, 1.1],
  JANX: [24.5, 18.42, 0.7, 1.2], BEAM: [21.8, 23.1, 0.68, 1.4], SLDP: [3.4, 1.94, 0.75, 1.6],
  GLDM: [62.0, 81.3, 0.15, 0.1], IBIT: [52.0, 48.75, 0.5, 1.3], SIVR: [38.0, 53.2, 0.28, 0.3], ETHA: [44.0, 51.6, 0.65, 1.5],
  NVDA: [178.0, 198.4, 0.42, 1.7], SYK: [322.0, 303.9, 0.2, 0.8], LDOS: [148.0, 131.2, 0.26, 0.7], NBIX: [128.0, 138.6, 0.34, 0.8],
  ARGX: [790.0, 861.0, 0.32, 0.7], G: [44.0, 38.95, 0.28, 0.9], SE: [92.0, 71.3, 0.45, 1.4], ACN: [305.0, 251.1, 0.25, 1.0],
  HDB: [24.5, 21.85, 0.22, 0.7], EVER: [24.0, 20.4, 0.55, 1.2], VICI: [27.5, 22.35, 0.2, 0.6], ZTS: [96.0, 80.55, 0.24, 0.7],
  LULU: [142.0, 98.7, 0.42, 1.2], NFLX: [79.0, 63.9, 0.33, 1.1],
}
const MKT_SD = 0.0085
const PHI = 0.985 // leichte Rückkehr zum Trend, damit kein Pfad unplausibel weit ausreisst
const mkt = Array.from({ length: N + 1 }, () => gauss() * MKT_SD) // mkt[i]: Marktbewegung von Tag i-1 auf i

function bridge(i0, i1, p0, p1, vol, beta) {
  const n = i1 - i0
  if (n <= 0) return [p0]
  const sd = Math.sqrt(Math.max(vol * vol / 252 - beta * beta * MKT_SD * MKT_SD, 0.00002))
  const w = [0]
  for (let k = 1; k <= n; k++) w[k] = PHI * w[k - 1] + beta * mkt[i0 + k] + gauss() * sd
  const l0 = Math.log(p0), l1 = Math.log(p1)
  return w.map((x, k) => Math.exp(l0 + (x - (k / n) * w[n]) + (k / n) * (l1 - l0)))
}

const series = {}
for (const [t, [pStart, pEnd, vol, beta]] of Object.entries(CFG)) {
  const real = seed.prices[t]
  if (!real) throw new Error('Kein Originalkurs für ' + t)
  const s = new Array(N + 1)
  if (real.prev != null) {
    bridge(0, iA - 1, pStart, real.prev, vol, beta).forEach((v, k) => (s[k] = v))
  } else {
    bridge(0, iA, pStart, real.close, vol, beta).forEach((v, k) => (s[k] = v))
  }
  s[iA] = real.close
  if (N > iA) bridge(iA, N, real.close, pEnd, vol, beta).forEach((v, k) => (s[iA + k] = v))
  series[t] = s.map(r2)
  series[t][iA] = real.close
  if (real.prev != null) series[t][iA - 1] = real.prev
}
const px = (t, date) => series[t][idx[date]]

/* ------------------------------------------------------------------ Testbuchungen
   Käufe so gewählt, dass am Ende exakt der echte Bestand herauskommt. */
const BUYS = [
  ['2025-11-04', 'VTI', 1], ['2025-11-05', 'VXUS', 2], ['2025-11-17', 'ADBE', 2], ['2025-11-24', 'GLDM', 2],
  ['2025-12-08', 'QQQM', 1], ['2025-12-15', 'IBIT', 2],
  ['2026-01-12', 'VTV', 1], ['2026-01-20', 'CI', 1], ['2026-01-26', 'SLDP', 20],
  ['2026-02-02', 'DECK', 1.5], ['2026-02-09', 'VTI', 1], ['2026-02-17', 'SIVR', 2], ['2026-02-23', 'ADBE', 1],
  ['2026-03-09', 'VXUS', 2], ['2026-03-16', 'RMD', 1], ['2026-03-23', 'JANX', 10],
  ['2026-04-06', 'GLDM', 2], ['2026-04-13', 'INTU', 0.7], ['2026-04-20', 'BEAM', 4],
  ['2026-05-04', 'IBIT', 2], ['2026-05-11', 'VTI', 1], ['2026-05-18', 'UHS', 1],
  ['2026-06-01', 'ETHA', 1], ['2026-06-08', 'VXUS', 1], ['2026-06-15', 'ADBE', 1], ['2026-06-22', 'NICE', 0.5079],
  ['2026-07-13', 'DECK', 1.25], ['2026-07-20', 'GLDM', 1],
  ['2026-08-10', 'JANX', 8], ['2026-08-24', 'BEAM', 3],
]
const DEPOSITS = [
  ['2025-11-03', null, 'Übertrag aus altem Depot'], // Betrag wird so berechnet, dass das Cash am Ende exakt stimmt
  ...['2025-12-01', '2026-01-02', '2026-02-02', '2026-03-02', '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-03', '2026-09-01', '2026-10-01']
    .map((d) => [d, 600, 'Monatliche Einzahlung']),
]

const tx = {}
let n = 0
const demoId = () => 'd' + String(++n).padStart(3, '0')
for (const [date, ticker, shares] of BUYS) {
  const d = nextTrading(date)
  const price = r2(px(ticker, d) * (1 + gauss() * 0.004))
  tx[demoId()] = { type: 'kauf', date: d, ticker, shares, price, fees: 0, cashDelta: -r2(shares * price), note: 'Testbuchung', by: 'Testdaten', demo: true }
}
for (const [id, t] of Object.entries(seed.transactions)) tx[id] = { ...t }

/* ------------------------------------------------------------------ Testdividenden */
const WHT = seed.meta.settings.withholding ?? 0.15
const DIV = {
  VTI: { pays: ['2025-12-29', '2026-03-30', '2026-06-29', '2026-09-29', '2026-12-28', '2027-03-29'], lag: 4, vary: true },
  VXUS: { pays: ['2025-12-22', '2026-03-23', '2026-06-22', '2026-09-21', '2026-12-21', '2027-03-22'], lag: 4, vary: true },
  QQQM: { pays: ['2025-12-26', '2026-03-27', '2026-06-26', '2026-09-25', '2026-12-24', '2027-03-26'], lag: 4, vary: true },
  VTV: { pays: ['2025-12-30', '2026-03-31', '2026-06-30', '2026-09-30', '2026-12-29', '2027-03-30'], lag: 4, vary: true },
  CI: { pays: ['2026-03-19', '2026-06-18', '2026-09-17', '2026-12-17', '2027-03-18'], lag: 14 },
  UHS: { pays: ['2026-06-16', '2026-09-15', '2026-12-15', '2027-03-16'], lag: 14 },
  RMD: { pays: ['2026-06-11', '2026-09-17', '2026-12-10', '2027-03-18'], lag: 28 },
  INTU: { pays: ['2026-07-17', '2027-01-15', '2027-04-16'], lag: 8, rates: { '2026-07-17': 1.2 } },
}
const sharesAt = (ticker, date) =>
  Object.values(tx).reduce((s, t) => (t.ticker === ticker && t.date <= date ? s + (t.type === 'kauf' ? t.shares : t.type === 'verkauf' ? -t.shares : 0) : s), 0)

const dividends = {}
for (const [ticker, cfg] of Object.entries(DIV)) {
  const annual = seed.prices[ticker].divAnnual
  for (const pay of cfg.pays) {
    const ex = addDays(pay, -cfg.lag)
    const future = pay > END
    const sh = future ? seed.positions[ticker].shares : r4(sharesAt(ticker, addDays(ex, -1)))
    if (!(sh > 0)) continue
    const perShare = r4(cfg.rates?.[pay] ?? (annual / 4) * (cfg.vary && !future ? 1 + (rnd() - 0.5) * 0.14 : 1))
    const gross = r2(sh * perShare), tax = r2(gross * WHT)
    dividends[`${ticker}-${ex}`] = {
      ticker, exDate: ex, payDate: pay, perShare, shares: sh, gross, tax, net: r2(gross - tax),
      status: future ? 'erwartet' : 'erhalten',
      source: future ? `Prognose: ${sh} × ${perShare}` : 'Testdaten',
      ...(future ? { payDateEstimated: true } : {}), demo: true,
    }
  }
}
for (const [id, d] of Object.entries(seed.dividends)) dividends[id] = { ...d } // echter Eintrag (INTU, noch zu bestätigen)

/* ------------------------------------------------------------------ Simulation: Bestand, Cash, Tageswerte */
const REAL_CASH = seed.meta.settings.cash
function simulate(firstDeposit) {
  const flows = []
  for (const [date, amt, note] of DEPOSITS) flows.push({ date, kind: 'dep', amt: amt ?? firstDeposit, note })
  for (const t of Object.values(tx)) flows.push({ date: t.date, kind: 'tx', t })
  for (const d of Object.values(dividends)) if (d.status === 'erhalten') flows.push({ date: d.payDate, kind: 'div', amt: d.net })
  const order = { dep: 0, div: 1, tx: 2 }
  flows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : order[a.kind] - order[b.kind]))
  const sh = {}, cost = {}
  let cash = 0, invested = 0, p = 0, minCash = Infinity
  const out = []
  for (const day of days) {
    while (p < flows.length && flows[p].date <= day) {
      const f = flows[p++]
      if (f.kind === 'dep') { cash += f.amt; invested += f.amt }
      else if (f.kind === 'div') cash += f.amt
      else {
        const t = f.t
        cash += t.cashDelta
        if (t.type === 'kauf') { sh[t.ticker] = (sh[t.ticker] ?? 0) + t.shares; cost[t.ticker] = (cost[t.ticker] ?? 0) - t.cashDelta }
        if (t.type === 'verkauf') {
          const avg = cost[t.ticker] / sh[t.ticker]
          t._avg = avg
          sh[t.ticker] -= t.shares; cost[t.ticker] -= avg * t.shares
        }
      }
      minCash = Math.min(minCash, cash)
    }
    let sec = 0
    for (const [t, q] of Object.entries(sh)) sec += q * px(t, day)
    out.push({ date: day, total: r2(sec + cash), securities: r2(sec), cash: r2(cash), invested: r2(invested) })
  }
  return { out, sh, cost, cash, minCash }
}
const firstDeposit = r2(REAL_CASH - simulate(0).cash)
const sim = simulate(firstDeposit)
if (Math.abs(sim.cash - REAL_CASH) > 0.005) throw new Error(`Cash stimmt nicht: ${sim.cash} statt ${REAL_CASH}`)
if (sim.minCash < 0) throw new Error(`Cash wird negativ (${sim.minCash.toFixed(2)}): Buchungsplan anpassen`)
for (const [t, p] of Object.entries(seed.positions)) {
  if (Math.abs((sim.sh[t] ?? 0) - p.shares) > 1e-6) throw new Error(`Bestand ${t}: ${sim.sh[t]} statt ${p.shares}`)
}

// Einzahlungen als Buchungen
DEPOSITS.forEach(([date, amt, note], i) => {
  tx['e' + String(i + 1).padStart(2, '0')] = { type: 'einzahlung', date, cashDelta: amt ?? firstDeposit, note: note + ' (Testbuchung)', by: 'Testdaten', demo: true }
})
// realisierter Gewinn des echten Adobe-Verkaufs gegen den Test-Einstand
for (const t of Object.values(tx)) {
  if (t.type === 'verkauf' && t._avg != null) { t.realized = r2(t.cashDelta - t._avg * t.shares); t.realizedDemo = true }
  delete t._avg
}

/* Tageswerte: echte Stichtage exakt treffen (sanfte Korrektur des Testverlaufs davor) */
const anchors = Object.values(seed.snapshots).filter((s) => idx[s.date] != null).sort((a, b) => (a.date < b.date ? -1 : 1))
const factorAt = (i) => {
  const pts = anchors.map((a) => ({ i: idx[a.date], f: a.total / sim.out[idx[a.date]].total }))
  const first = pts[0], last = pts[pts.length - 1]
  if (i >= last.i) return i === last.i ? last.f : 1
  if (i <= first.i) { const ramp = 25, k = Math.max(0, 1 - (first.i - i) / ramp); return 1 + (first.f - 1) * k }
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k], b = pts[k + 1]
    if (i >= a.i && i <= b.i) return a.f + ((b.f - a.f) * (i - a.i)) / (b.i - a.i)
  }
  return 1
}
const snapshots = {}
sim.out.forEach((s, i) => {
  const real = seed.snapshots[s.date]
  const total = real ? real.total : r2(s.total * factorAt(i))
  snapshots[s.date] = real
    ? { ...real, cash: real.cash ?? s.cash, securities: real.securities ?? r2(real.total - s.cash), invested: s.invested }
    : { date: s.date, total, securities: r2(total - s.cash), cash: s.cash, invested: s.invested, demo: true }
})
const lastSim = sim.out[N]
snapshots[END] = { date: END, total: lastSim.total, securities: lastSim.securities, cash: lastSim.cash, invested: lastSim.invested, note: 'Testkurse', demo: true }

/* ------------------------------------------------------------------ Ausgabe */
const positions = {}
for (const [t, p] of Object.entries(seed.positions)) positions[t] = { ...p, cost: r2(sim.cost[t]), costDemo: true }

const prices = {}
for (const [t, q] of Object.entries(seed.prices)) {
  const real = END === ANCHOR
  prices[t] = {
    ...q, close: series[t][N], prev: series[t][N - 1], date: END,
    source: real ? q.source : 'Testkurs (Zufallspfad ab Schlusskurs 22.10.2026)', ...(real ? {} : { demo: true }),
  }
}
const watchlist = {}
for (const [t, w] of Object.entries(seed.watchlist)) watchlist[t] = { ...w, price: series[t][N], priceDate: END }

const KIND = { e1: ['pruefen', 'UBER'], e2: ['pruefen', 'G'], e3: ['zahlen', 'ZTS'], e4: ['zahlen', 'NVDA'], e5: ['tranche', 'VXUS'], e6: ['tranche', 'VXUS'], e7: ['stichtag', null], e8: ['tranche', 'VTI'] }
const events = {}
for (const [id, e] of Object.entries(seed.events)) events[id] = { ...e, kind: KIND[id]?.[0] ?? 'termin', ...(KIND[id]?.[1] ? { ticker: KIND[id][1] } : {}) }
;[
  ['2026-11-17', 'Sea Ltd. Q3-Zahlen', 'Watchlist: Grenze 64.76 nach den Zahlen prüfen', 'SE'],
  ['2026-11-19', 'Intuit Q1-Zahlen (GJ 2027)', 'Position halten; Ausblick und Marge ansehen', 'INTU'],
  ['2026-12-03', 'Lululemon Q3-Zahlen', 'Watchlist: Obergrenze 74.92', 'LULU'],
  ['2026-12-10', 'Adobe Q4-Zahlen', 'Position halten, keine Aufstockung', 'ADBE'],
  ['2026-12-17', 'Accenture Q1-Zahlen (GJ 2027)', 'Watchlist: alter Bereich 180–195', 'ACN'],
  ['2027-01-21', 'Netflix Q4-Zahlen', 'Watchlist: Obergrenze 52.68', 'NFLX'],
].forEach(([date, title, detail, ticker], i) => {
  events['x' + (i + 1)] = { date, title, detail, kind: 'zahlen', ticker, tentative: true, demo: true }
})

const log = { ...seed.log }
log.l8 = {
  date: TODAY, title: 'Lokales Dashboard mit Testdaten',
  text: 'Bestand, Grenzen, Töpfe, Termine und Regeln entsprechen dem Stand 22.10.2026. Kursverlauf, Einstandspreise, ältere Buchungen und Dividenden sind Testwerte.',
  by: 'Testdaten',
}

const s = seed.meta.settings
const meta = {
  settings: {
    ...s,
    demo: true,
    demoNote: 'Bestand, Grenzen, Töpfe, Termine und Regeln: Stand 22.10.2026. Kursverlauf seit 22.10., Einstandspreise, Buchungen vor dem 21.10. und Dividenden sind Testwerte.',
    usdchf: 0.795,
    usdchfDemo: true,
    priceSource: `Testkurse bis ${END.split('-').reverse().join('.')}: Zufallspfad, verankert an den Schlusskursen vom 22.10.2026`,
    refresh: { at: TODAY, by: 'Testdaten' },
    openItems: [
      s.openItems[0],
      { title: 'Einstandspreise sind Testwerte', detail: 'Für den echten Gewinn/Verlust die Schwab-Exporte «Positions» und «Transaction History» einspielen.' },
    ],
  },
}

save('positions', positions)
save('prices', prices)
save('watchlist', watchlist)
save('pots', seed.pots)
save('events', events)
save('log', log)
save('transactions', tx)
save('dividends', dividends)
save('snapshots', snapshots)
save('meta', meta)
save('history', { dates: days, series })

/* ------------------------------------------------------------------ Kontrolle */
const sec = Object.entries(positions).reduce((a, [t, p]) => a + p.shares * prices[t].close, 0)
const cost = Object.values(positions).reduce((a, p) => a + p.cost, 0)
console.log(`Testdaten nach data-demo/ geschrieben: ${days.length} Handelstage ${START} bis ${END} (heute ${TODAY})`)
console.log(`  Anker 22.10.: Simulation ${sim.out[iA].total} / echt ${seed.snapshots[ANCHOR].total}`)
console.log(`  Korrekturfaktoren an echten Stichtagen: ${anchors.map((a) => a.date.slice(5) + ' ' + (a.total / sim.out[idx[a.date]].total).toFixed(4)).join(', ')}`)
console.log(`  Wertpapiere ${r2(sec)} · Cash ${REAL_CASH} · Gesamt ${r2(sec + REAL_CASH)} USD`)
console.log(`  Einstand ${r2(cost)} · unrealisiert ${r2(sec - cost)} USD · Übertrag am Start ${firstDeposit} · tiefstes Cash ${r2(sim.minCash)}`)
console.log(`  Buchungen ${Object.keys(tx).length} · Dividenden ${Object.keys(dividends).length} · Tageswerte ${Object.keys(snapshots).length}`)
