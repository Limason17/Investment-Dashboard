import type { Calc } from './calc'
import { today } from './format'
import { toast } from './toast'

/** Positionen als CSV (Semikolon, mit BOM für Excel) herunterladen. */
export function exportCsv(c: Calc) {
  const lines = [['Ticker', 'Name', 'Baustein', 'Stueck', 'Kurs', 'Kursdatum', 'Wert USD', 'Anteil %', 'Einstand USD', 'G/V USD', 'Regel'].join(';')]
  for (const r of c.rows) {
    lines.push([r.t, r.p.name || '', r.p.bucket || '', r.p.shares, r.px ?? '', r.q?.date || '', r.val != null ? r.val.toFixed(2) : '', c.valuationComplete && !c.settings.cashExcluded ? (r.w * 100).toFixed(2) : '', r.p.cost ?? '', r.pl != null ? r.pl.toFixed(2) : '', (r.p.status || '').replace(/;/g, ',')].join(';'))
  }
  if (!c.settings.cashExcluded) lines.push(['CASH', '', 'cash', '', '', '', c.cash.toFixed(2), (c.total ? (c.cash / c.total) * 100 : 0).toFixed(2), '', '', ''].join(';'))
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `depot-${today()}.csv`
  a.click()
  URL.revokeObjectURL(url)
  toast('CSV exportiert.')
}
