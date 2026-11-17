import { bucketOf } from './buckets'
import type { Calc } from './calc'
import { today } from './format'
import { toast } from './toast'

/**
 * Eine CSV-Zelle: Text mit Trennzeichen, Anführungszeichen oder Umbruch in Anführungszeichen; Text, den Excel
 * als Formel ausführen würde (=, +, @, Tab, oder - ohne Zahl), bekommt ein ' davor. Zahlen bleiben Zahlen.
 */
export function csvCell(v: string | number | null | undefined): string {
  if (v == null) return ''
  let s = String(v)
  if (typeof v === 'string' && (/^[=+@\t\r]/.test(s) || (s.startsWith('-') && !/^-\d+(\.\d+)?$/.test(s)))) s = "'" + s
  return /[;",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

/** Positionen als CSV-Zeilen (Semikolon); Kategorie mit ihrem Namen, wie in der App. */
export function csvLines(c: Calc): string[] {
  const lines = [['Ticker', 'Name', 'Kategorie', 'Stueck', 'Kurs', 'Kursdatum', 'Wert USD', 'Anteil %', 'Einstand USD', 'G/V USD', 'Regel'].join(';')]
  for (const r of c.rows) {
    lines.push([r.t, r.p.name, bucketOf(r.p.bucket).name, r.p.shares, r.px, r.q?.date, r.val != null ? r.val.toFixed(2) : '', c.valuationComplete && !c.settings.cashExcluded ? (r.w * 100).toFixed(2) : '', r.p.cost, r.pl != null ? r.pl.toFixed(2) : '', r.p.status].map(csvCell).join(';'))
  }
  if (!c.settings.cashExcluded) lines.push(['CASH', '', 'Cash', '', '', '', c.cash.toFixed(2), (c.total ? (c.cash / c.total) * 100 : 0).toFixed(2), '', '', ''].join(';'))
  return lines
}

/** Positionen als CSV (Semikolon, mit BOM für Excel) herunterladen. */
export function exportCsv(c: Calc) {
  const lines = csvLines(c)
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `depot-${today()}.csv`
  a.click()
  URL.revokeObjectURL(url)
  toast('CSV exportiert.')
}
