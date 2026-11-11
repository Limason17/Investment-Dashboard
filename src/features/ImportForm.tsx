import { ClipboardCopy, Download, FileUp } from 'lucide-react'
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Chip, Segmented } from '@/components/ui'
import { COLUMNS, detectKind, EXAMPLES, LIMITS, parseImport, template, TEMPLATE_NAME, templateFile, type ImportKind } from '@/lib/bulk'
import { planImport, type ItemState } from '@/lib/bulk-plan'
import { commit } from '@/lib/commit'
import { useDepot } from '@/lib/context'
import { dfmt, sUsd } from '@/lib/format'

const KINDS: { value: ImportKind; label: string }[] = [
  { value: 'trades', label: 'Käufe/Verkäufe' },
  { value: 'dividenden', label: 'Dividenden' },
  { value: 'bestand', label: 'Nur Bestand' },
]
const INTRO: Record<ImportKind, string> = {
  trades: 'So lädst du alle bestehenden Positionen auf einmal hoch: jeden Kauf mit Datum und Preis. Daraus entstehen Bestand, Einstand, Wertverlauf und Charts.',
  dividenden: 'So lädst du alle erhaltenen Dividenden auf einmal hoch. Passende erwartete Zahlungen werden dabei bestätigt.',
  bestand: 'Setzt nur Stück und Einstand je Titel. Ohne Kaufdatum zeigt das Dashboard keinen Verlauf; nutze besser «Käufe/Verkäufe».',
}
const FILL: Record<ImportKind, string> = {
  trades: 'Eine Zeile je Kauf (oder Verkauf) mit Datum, Ticker, Stück und Preis je Stück in USD. Hast du einen Titel in mehreren Käufen gekauft, trägst du jeden Kauf einzeln ein.',
  dividenden: 'Eine Zeile je Zahlung mit Zahltag, Ticker und Bruttobetrag in USD.',
  bestand: 'Eine Zeile je Titel mit Stück und Einstand gesamt in USD.',
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[22px_1fr] gap-x-2.5">
      <span className="num mt-px grid size-[22px] place-items-center rounded-full border border-line-2 text-[11.5px] font-semibold text-ink">{n}</span>
      <div><div className="font-semibold text-ink">{title}</div>{children}</div>
    </li>
  )
}

/** Text als Datei herunterladen. */
function download(text: string, name: string) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })), download: name })
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
const STATE: Record<ItemState, { tone: 'up' | 'info' | 'mute' | 'down'; label: string }> = {
  neu: { tone: 'up', label: 'neu' },
  ändert: { tone: 'info', label: 'ändert' },
  doppelt: { tone: 'mute', label: 'schon da' },
  fehler: { tone: 'down', label: 'Fehler' },
}

export function ImportForm({ formId, initial, initialText, setBusy, onSaved }: { formId: string; initial: ImportKind; initialText?: string; setBusy: (b: boolean) => void; onSaved: (msg: string) => void }) {
  const { db } = useDepot()
  const [kind, setKind] = useState<ImportKind>(initial)
  const [text, setText] = useState(initialText ?? '')
  const [paste, setPaste] = useState(false)
  const [fileName, setFileName] = useState(initialText ? 'ausgefüllte Vorlage' : '')
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
      setPaste(true)
      setText(template(kind))
    }
  }
  const loadFile = async (f: File | undefined) => {
    if (file.current) file.current.value = ''
    if (!f) return
    setErr('')
    if (f.size > LIMITS.bytes) return setErr('Die Datei ist zu gross (höchstens 2 MB).')
    const t = await f.text()
    const k = detectKind(t)
    if (k) setKind(k)
    setFileName(f.name)
    setText(t)
  }
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    if (errors.length) return setErr(`${errors.length} Zeile${errors.length > 1 ? 'n haben' : ' hat'} einen Fehler. Korrigiere oder lösche sie, dann übernehmen.`)
    if (!plan.count) return setErr(text.trim() ? 'Nichts Neues zum Übernehmen.' : 'Zuerst die ausgefüllte Vorlage hochladen.')
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
    <form id={formId} onSubmit={onSubmit} className="grid gap-4">
      <Segmented className="flex w-full [&>button]:flex-1 [&>button]:px-1" label="Was hochladen" value={kind} onChange={setKind} options={KINDS} />
      <p className="text-[12.5px] leading-[1.55] text-ink-2">{INTRO[kind]}</p>

      <ol className="grid gap-3 text-[12.5px] leading-[1.55] text-ink-2">
        <Step n={1} title="Vorlage herunterladen">
          <p>Eine CSV-Datei für Excel, Numbers oder Google Sheets. Oben stehen Erklärung und zwei Beispiele als Kommentar (#); sie werden nie übernommen.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="btn btn-sm" onClick={() => download(templateFile(kind), TEMPLATE_NAME[kind])}><Download />Vorlage herunterladen</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={copy}><ClipboardCopy />{copied ? 'Kopiert' : 'Oder kopieren'}</button>
          </div>
        </Step>
        <Step n={2} title="Ausfüllen">
          <p>{FILL[kind]} Die Kopfzeile bleibt stehen. Danach als CSV speichern.</p>
          <details className="mt-1.5">
            <summary className="cursor-pointer select-none text-muted hover:text-ink">Spalten und Beispiele</summary>
            <div className="mt-2 overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-[11.5px]">
                <thead><tr>{COLUMNS[kind].map((c) => <th key={c.key} className="whitespace-nowrap border-b border-line px-2 py-1.5 text-left font-medium text-ink">{c.label}{c.required && <span className="text-down">*</span>}</th>)}</tr></thead>
                <tbody>{EXAMPLES[kind].map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className="num whitespace-nowrap px-2 py-1 text-muted">{v || '–'}</td>)}</tr>)}</tbody>
              </table>
            </div>
            <ul className="mt-2 grid gap-0.5 text-[12px] text-muted">{COLUMNS[kind].map((c) => <li key={c.key}><b className="font-medium text-ink-2">{c.label}{c.required ? '*' : ''}</b>: {c.hint}</li>)}</ul>
            <p className="mt-1.5 text-[12px] text-muted">* Pflicht. Zahlen mit Punkt oder Komma, Datum als 2025-03-14 oder 14.03.2025.</p>
          </details>
        </Step>
        <Step n={3} title="Ausgefüllte Vorlage hochladen">
          <p>Du siehst zuerst eine Vorschau. Erst «Übernehmen» speichert. Einträge, die schon da sind, werden übersprungen. Den Schwab-Export «Transaction History» kannst du direkt hochladen.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="btn btn-sm btn-primary" onClick={() => file.current?.click()}><FileUp />Ausgefüllte Vorlage hochladen</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPaste((p) => !p)}>{paste ? 'Einfügen ausblenden' : 'Oder Zeilen einfügen'}</button>
          </div>
          <input ref={file} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" hidden onChange={(e) => void loadFile(e.target.files?.[0])} />
          {fileName && <p className="mt-1.5 text-[12px] text-muted">Datei: {fileName}</p>}
        </Step>
      </ol>

      {paste && (
        <textarea
          aria-label="Zeilen einfügen"
          className="input num min-h-[140px] whitespace-pre font-mono text-[12px] leading-[1.5]"
          placeholder={COLUMNS[kind].map((c) => c.label).join('\t') + '\n' + EXAMPLES[kind][0].join('\t')}
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      )}

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
