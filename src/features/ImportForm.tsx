import { ClipboardCopy, FileUp } from 'lucide-react'
import { useMemo, useRef, useState, type FormEvent } from 'react'
import { Chip, Segmented } from '@/components/ui'
import { COLUMNS, parseImport, template, type ImportKind } from '@/lib/bulk'
import { planImport, type ItemState } from '@/lib/bulk-plan'
import { commit } from '@/lib/commit'
import { useDepot } from '@/lib/context'
import { dfmt, sUsd } from '@/lib/format'

const KINDS: { value: ImportKind; label: string }[] = [
  { value: 'bestand', label: 'Bestand' },
  { value: 'trades', label: 'Käufe/Verkäufe' },
  { value: 'dividenden', label: 'Dividenden' },
]
const INTRO: Record<ImportKind, string> = {
  bestand: 'Setzt Stück und Einstand je Titel, z. B. für den Startbestand. Cash und Journal bleiben unverändert.',
  trades: 'Bucht jede Zeile wie ein einzelner Kauf oder Verkauf: Bestand, Einstand, realisierter Gewinn und Cash.',
  dividenden: 'Bucht erhaltene Dividenden. Passende erwartete Zahlungen werden dabei bestätigt.',
}
const STATE: Record<ItemState, { tone: 'up' | 'info' | 'mute' | 'down'; label: string }> = {
  neu: { tone: 'up', label: 'neu' },
  ändert: { tone: 'info', label: 'ändert' },
  doppelt: { tone: 'mute', label: 'schon da' },
  fehler: { tone: 'down', label: 'Fehler' },
}

export function ImportForm({ formId, initial, setBusy, onSaved }: { formId: string; initial: ImportKind; setBusy: (b: boolean) => void; onSaved: (msg: string) => void }) {
  const { db } = useDepot()
  const [kind, setKind] = useState<ImportKind>(initial)
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)
  const file = useRef<HTMLInputElement>(null)

  const parsed = useMemo(() => parseImport(kind, text), [kind, text])
  const plan = useMemo(() => planImport(db, parsed), [db, parsed])
  const errors = [...parsed.errors, ...plan.items.filter((i) => i.state === 'fehler').map((i) => ({ line: i.line, msg: `${i.kind} ${i.ticker}: ${i.msg}` }))].sort((a, b) => a.line - b.line)
  const counts = plan.items.reduce<Record<ItemState, number>>((a, i) => ({ ...a, [i.state]: a[i.state] + 1 }), { neu: 0, ändert: 0, doppelt: 0, fehler: 0 })

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(template(kind))
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setText(template(kind))
    }
  }
  const loadFile = async (f: File | undefined) => {
    if (f) setText(await f.text())
    if (file.current) file.current.value = ''
  }
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    if (errors.length) return setErr(`${errors.length} Zeile${errors.length > 1 ? 'n haben' : ' hat'} einen Fehler. Korrigiere oder lösche sie, dann übernehmen.`)
    if (!plan.count) return setErr(text.trim() ? 'Nichts Neues zum Übernehmen.' : 'Zuerst Zeilen einfügen.')
    setBusy(true)
    try {
      await commit(plan.ops)
      onSaved(`${plan.count} Einträge übernommen${counts.doppelt ? `, ${counts.doppelt} schon vorhanden` : ''}.`)
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form id={formId} onSubmit={onSubmit} className="grid gap-3.5">
      <Segmented className="flex w-full [&>button]:flex-1 [&>button]:px-1" label="Was importieren" value={kind} onChange={setKind} options={KINDS} />
      <p className="text-[12.5px] leading-[1.55] text-ink-2">{INTRO[kind]}</p>

      <details className="group rounded-xl border border-line bg-white/[0.02] px-3.5 py-2.5 text-[12.5px] leading-[1.6] text-ink-2 open:pb-3.5">
        <summary className="cursor-pointer select-none font-medium text-ink marker:text-muted">So funktioniert der Import</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-4">
          <li>Kopiere die Vorlage und füge sie in Excel, Numbers oder Google Sheets ein.</li>
          <li>Fülle eine Zeile je Eintrag aus. Die Kopfzeile bleibt stehen.</li>
          <li>Markiere alle Zellen mit Kopfzeile, kopiere sie und füge sie unten ein.</li>
          <li>Prüfe die Vorschau, dann «Übernehmen».</li>
        </ol>
        <table className="mt-3 w-full text-[12px]">
          <tbody>
            {COLUMNS[kind].map((c) => (
              <tr key={c.key} className="align-top">
                <td className="whitespace-nowrap py-0.5 pr-3 font-medium text-ink">{c.label}{c.required && <span className="text-down"> *</span>}</td>
                <td className="py-0.5 text-muted">{c.hint}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-muted">
          * Pflicht. Mit Kopfzeile ist die Reihenfolge der Spalten frei; ohne Kopfzeile gilt die Reihenfolge oben.
          Trennzeichen Tabulator, Semikolon oder Komma. Den Schwab-Export «Transaction History» (CSV) erkennt der Import selbst:
          Käufe, Verkäufe, Dividenden und Quellensteuer in einem Zug. Bereits erfasste Einträge werden übersprungen.
        </p>
      </details>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-sm" onClick={copy}><ClipboardCopy />{copied ? 'Vorlage kopiert' : 'Vorlage kopieren'}</button>
        <button type="button" className="btn btn-sm" onClick={() => file.current?.click()}><FileUp />CSV-Datei öffnen</button>
        <input ref={file} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" hidden onChange={(e) => void loadFile(e.target.files?.[0])} />
      </div>
      <textarea
        aria-label="Zeilen einfügen"
        className="input num min-h-[150px] whitespace-pre font-mono text-[12px] leading-[1.5]"
        placeholder={template(kind) + '…'}
        spellCheck={false}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      {text.trim() !== '' && (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            {parsed.format === 'schwab' && <Chip tone="info">Schwab-Export erkannt</Chip>}
            {counts.neu > 0 && <Chip tone="up">{counts.neu} neu</Chip>}
            {counts.ändert > 0 && <Chip tone="info" icon={false}>{counts.ändert} ändert</Chip>}
            {counts.doppelt > 0 && <Chip tone="mute">{counts.doppelt} schon vorhanden</Chip>}
            {errors.length > 0 && <Chip tone="down">{errors.length} Fehler</Chip>}
          </div>
          {errors.length > 0 && (
            <ul role="alert" className="max-h-28 overflow-y-auto rounded-xl border border-down/25 bg-down/[0.06] px-3.5 py-2 text-[12px] leading-[1.6] text-down">
              {errors.map((x, i) => <li key={i}><span className="num text-muted">Zeile {x.line}:</span> {x.msg}</li>)}
            </ul>
          )}
          {plan.items.length > 0 && (
            <div className="max-h-64 overflow-auto rounded-xl border border-line [&_th]:bg-[#0c0e12]">
              <table className="tbl text-[12px] [&_td]:py-2 [&_th]:py-2">
                <thead><tr><th className="r">Z.</th><th>Art</th><th>Titel</th><th>Datum</th><th>Angaben</th><th className="r">Cash</th><th>Status</th></tr></thead>
                <tbody>
                  {plan.items.map((i) => (
                    <tr key={i.kind + i.line} className={i.state === 'doppelt' ? 'opacity-50' : ''}>
                      <td className="r num text-muted">{i.line}</td>
                      <td>{i.kind}</td>
                      <td className="tk">{i.ticker}</td>
                      <td className="num whitespace-nowrap">{i.date ? dfmt(i.date) : '–'}</td>
                      <td className="num whitespace-nowrap text-muted">{i.detail}</td>
                      <td className="r num whitespace-nowrap">{i.kind === 'Bestand' ? '–' : sUsd(i.amount)}</td>
                      <td title={i.msg}><Chip tone={STATE[i.state].tone} icon={false}>{STATE[i.state].label}</Chip></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {parsed.skipped.length > 0 && (
            <details className="text-[12px] text-muted">
              <summary className="cursor-pointer">{parsed.skipped.length === 1 ? '1 Zeile' : `${parsed.skipped.length} Zeilen`} ohne Bedeutung für das Depot übersprungen</summary>
              <ul className="mt-1 max-h-24 overflow-y-auto pl-4">{parsed.skipped.map((x, i) => <li key={i}>Zeile {x.line}: {x.msg}</li>)}</ul>
            </details>
          )}
          {plan.cashDelta !== 0 && (
            <div className="text-[12.5px] text-ink-2">
              Cash-Wirkung <b className="num text-ink">{sUsd(plan.cashDelta)} USD</b>{db.meta.settings?.cashExcluded ? ' (Cash ist derzeit nicht erfasst und bleibt unverändert).' : '.'}
            </div>
          )}
        </>
      )}
      {err && <div role="alert" className="text-[12.5px] text-down">{err}</div>}
    </form>
  )
}
