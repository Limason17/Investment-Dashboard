import { ClipboardCopy, Download, FileUp } from 'lucide-react'
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Chip, Segmented } from '@/components/ui'
import { COLUMNS, detectKind, EXAMPLES, LIMITS, parseImport, template, TEMPLATE_NAME, templateFile, type ImportKind } from '@/lib/bulk'
import { planImport, type ItemState } from '@/lib/bulk-plan'
import { downloadBackup } from '@/lib/backup'
import { getPortfolio } from '@/lib/store'
import type { Coll } from '@/lib/cloud'
import { commit } from '@/lib/commit'
import { useDepot } from '@/lib/context'
import { dfmt, sUsd } from '@/lib/format'
import type { Op } from '@/lib/store'
import type { DB } from '@/lib/types'

const KINDS: { value: ImportKind; label: string }[] = [
  { value: 'trades', label: 'Käufe/Verkäufe' },
  { value: 'dividenden', label: 'Dividenden' },
  { value: 'bestand', label: 'Nur Bestand' },
]
const INTRO: Record<ImportKind, string> = {
  trades: 'Alle bisherigen Käufe auf einmal, mit Datum und Preis. Daraus entstehen Bestand, Einstand, Wertverlauf und Charts.',
  dividenden: 'So lädst du alle erhaltenen Dividenden auf einmal hoch. Passende erwartete Zahlungen werden dabei bestätigt.',
  bestand: 'Setzt nur Stück und Einstand je Titel. Ohne Kaufdatum zeigt das Dashboard keinen Verlauf; nutze besser «Käufe/Verkäufe».',
}
type Mode = 'add' | 'parts' | 'all'
type Part = 'trades' | 'dividends' | 'rest'
const size = (o: object) => Object.keys(o).length
/** Bereiche, die vor dem Hochladen geleert werden können. «rest» nur bei «Alles ersetzen». */
const AREAS: { id: Part; label: string; colls: Coll[]; count: (db: DB) => number }[] = [
  { id: 'trades', label: 'Positionen und Käufe/Verkäufe', colls: ['positions', 'transactions', 'prices', 'snapshots'], count: (db) => size(db.positions) + size(db.transactions) },
  { id: 'dividends', label: 'Dividenden', colls: ['dividends'], count: (db) => size(db.dividends) },
  { id: 'rest', label: 'Watchlist, Töpfe, Termine, Journal und Einstellungen', colls: ['watchlist', 'pots', 'events', 'log', 'meta', 'market'], count: (db) => size(db.watchlist) + size(db.pots) + size(db.events) + size(db.log) },
]
const ALL = AREAS.flatMap((a) => a.colls)
const MODES: { id: Mode; label: string; text: string }[] = [
  { id: 'add', label: 'Ergänzen', text: 'Vorhandene Daten bleiben. Neue Einträge kommen dazu, doppelte werden übersprungen.' },
  { id: 'parts', label: 'Bereiche ersetzen', text: 'Die gewählten Bereiche werden zuerst geleert, alles andere bleibt.' },
  { id: 'all', label: 'Alles ersetzen', text: 'Alle Daten werden zuerst gelöscht, auch Watchlist, Termine und Journal.' },
]
/** Einstellungen nach «Alles ersetzen»: Cash zählt erst, wenn der Saldo eingetragen ist; Quellensteuer bleibt. */
const freshSettings = (db: DB) => ({ cash: 0, cashExcluded: true, withholding: db.meta.settings?.withholding ?? 0.15, caps: [], targets: {} })

const FILL: Record<ImportKind, string> = {
  trades: 'Eine Zeile je Kauf: Datum, Ticker, Stück, Preis je Stück (USD). Mehrere Käufe eines Titels einzeln.',
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

export function ImportForm({ formId, initial, initialText, initialWay, setBusy, onSaved }: { formId: string; initial: ImportKind; initialText?: string; initialWay?: 'text' | 'file'; setBusy: (b: boolean) => void; onSaved: (msg: string) => void }) {
  const { db } = useDepot()
  const [kind, setKind] = useState<ImportKind>(initial)
  const [text, setText] = useState(initialText ?? '')
  // Text einfügen ist der Standard; kommt schon eine Datei mit (Konto → Datei hochladen), gilt «Datei».
  const [way, setWay] = useState<'text' | 'file'>(initialText ? 'file' : initialWay ?? 'text')
  const [fileName, setFileName] = useState(initialText ? 'ausgefüllte Vorlage' : '')
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)
  const file = useRef<HTMLInputElement>(null)

  const parsed = useMemo(() => parseImport(kind, text), [kind, text])
  // Was mit den vorhandenen Daten geschieht: ergänzen (Standard), einzelne Bereiche oder alles vorher leeren.
  const [mode, setMode] = useState<Mode>('add')
  const [parts, setParts] = useState<Part[]>(['trades'])
  const [confirmed, setConfirmed] = useState(false)
  const hasData = AREAS.some((a) => a.count(db) > 0)
  const cleared = useMemo<Coll[]>(() => (mode === 'add' ? [] : mode === 'all' ? [...ALL] : [...new Set(AREAS.filter((a) => parts.includes(a.id)).flatMap((a) => a.colls))]), [mode, parts])
  const base = useMemo<DB>(() => {
    if (!cleared.length) return db
    const out = { ...db, ...Object.fromEntries(cleared.map((c) => [c, {}])) } as DB
    if (mode === 'all') out.meta = { settings: freshSettings(db) }
    return out
  }, [db, cleared, mode])
  const plan = useMemo(() => {
    const p = planImport(base, parsed)
    const pre: Op[] = [...cleared.map((c): Op => ({ op: 'clear', coll: c, id: '*' })), ...(mode === 'all' ? [{ op: 'set', coll: 'meta', id: 'settings', data: freshSettings(db) } as Op] : [])]
    return { ...p, ops: [...pre, ...p.ops] }
  }, [base, parsed, cleared, mode, db])
  const lost = AREAS.filter((a) => a.colls.some((c) => cleared.includes(c))).map((a) => ({ ...a, n: a.count(db) })).filter((a) => a.n > 0)
  const errors = [...parsed.errors, ...plan.items.filter((i) => i.state === 'fehler').map((i) => ({ line: i.line, msg: `${i.kind} ${i.ticker}: ${i.msg}` }))].sort((a, b) => a.line - b.line)
  const counts = plan.items.reduce<Record<ItemState, number>>((a, i) => ({ ...a, [i.state]: a[i.state] + 1 }), { neu: 0, ändert: 0, doppelt: 0, fehler: 0 })

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(template(kind))
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setText((t) => (t.trim() ? t : template(kind)))
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
  const columnHelp = (
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
  )
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    if (errors.length) return setErr(`${errors.length} Zeile${errors.length > 1 ? 'n haben' : ' hat'} einen Fehler. Korrigiere oder lösche sie, dann übernehmen.`)
    if (!plan.count) return setErr(text.trim() ? 'Nichts Neues zum Übernehmen.' : way === 'text' ? 'Zuerst die ausgefüllten Zeilen einfügen.' : 'Zuerst die ausgefüllte Datei hochladen.')
    if (mode === 'parts' && !parts.length) return setErr('Wähle mindestens einen Bereich zum Ersetzen, oder «Ergänzen».')
    if (lost.length && !confirmed) return setErr('Bestätige zuerst, dass die vorhandenen Daten gelöscht werden.')
    setBusy(true)
    try {
      await commit(plan.ops)
      onSaved(`${plan.count} Einträge übernommen${lost.length ? ', vorhandene Daten ersetzt' : counts.doppelt ? `, ${counts.doppelt} schon vorhanden` : ''}.`)
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

      {/* Zwei gleichwertige Wege: Text einfügen (Standard) oder Datei. */}
      <Segmented className="flex w-full [&>button]:flex-1" label="Wie hochladen" value={way} onChange={setWay} options={[{ value: 'text', label: 'Text einfügen' }, { value: 'file', label: 'Datei' }]} />

      {way === 'text' ? (
        <ol className="grid gap-3 text-[12.5px] leading-[1.55] text-ink-2">
          <Step n={1} title="Vorlage kopieren">
            <p>Kopfzeile und zwei Beispiele; Zeilen mit # zählen nicht.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className="btn btn-sm" onClick={copy}><ClipboardCopy />{copied ? 'Kopiert' : 'Vorlage kopieren'}</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setText((t) => (t.trim() ? t : template(kind)))}>Hier einsetzen</button>
            </div>
          </Step>
          <Step n={2} title="Ausfüllen">
            <p>{FILL[kind]} In Excel oder direkt im Feld unten.</p>
            {columnHelp}
          </Step>
          <Step n={3} title="Einfügen">
            <p>Zeilen samt Kopfzeile hier einfügen. Erst «Übernehmen» speichert.</p>
          </Step>
        </ol>
      ) : (
        <ol className="grid gap-3 text-[12.5px] leading-[1.55] text-ink-2">
          <Step n={1} title="Vorlage herunterladen">
            <p>CSV-Datei mit Kopfzeile und zwei Beispielen.</p>
            <button type="button" className="btn btn-sm mt-2" onClick={() => download(templateFile(kind), TEMPLATE_NAME[kind])}><Download />Vorlage herunterladen</button>
          </Step>
          <Step n={2} title="Ausfüllen und als CSV speichern">
            <p>{FILL[kind]}</p>
            {columnHelp}
          </Step>
          <Step n={3} title="Datei hochladen">
            <p>Darunter erscheint die Vorschau, erst «Übernehmen» speichert. Ein Schwab-Export «Transaction History» geht auch direkt.</p>
            <button type="button" className="btn btn-sm btn-primary mt-2" onClick={() => file.current?.click()}><FileUp />Datei hochladen</button>
            <input ref={file} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" hidden onChange={(e) => void loadFile(e.target.files?.[0])} />
            {fileName && <p className="mt-1.5 text-[12px] text-muted">Datei: {fileName}</p>}
          </Step>
        </ol>
      )}

      {way === 'text' && (
        <textarea
          aria-label="Zeilen einfügen"
          className="input num min-h-[150px] whitespace-pre font-mono text-[12px] leading-[1.5]"
          placeholder={'Hier einfügen, z. B.\n' + COLUMNS[kind].map((c) => c.label).join('\t') + '\n' + EXAMPLES[kind][0].join('\t')}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
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
            <>
            <ul className="max-h-72 divide-y divide-white/[0.05] overflow-y-auto rounded-xl border border-line px-3 sm:hidden">
              {plan.items.map((i) => (
                <li key={'m' + i.kind + i.line} className={'flex items-center justify-between gap-3 py-2.5 ' + (i.state === 'doppelt' ? 'opacity-50' : '')}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[13px]"><span className="tk">{i.ticker}</span><span className="text-ink-2">{i.kind}</span></div>
                    <div className="num truncate text-[11.5px] text-muted">Z. {i.line}{i.date ? ' · ' + dfmt(i.date) : ''} · {i.detail}</div>
                  </div>
                  <div className="flex flex-none flex-col items-end gap-1">
                    {i.kind !== 'Bestand' && <span className="num text-[12.5px]">{sUsd(i.amount)}</span>}
                    <span title={i.msg}><Chip tone={STATE[i.state].tone} icon={false}>{STATE[i.state].label}</Chip></span>
                  </div>
                </li>
              ))}
            </ul>
            <div className="max-h-64 overflow-auto rounded-xl border border-line max-sm:hidden [&_th]:bg-[#0c0e12]">
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
            </>
          )}
          {parsed.skipped.length > 0 && (
            <details className="text-[12px] text-muted">
              <summary className="cursor-pointer">{parsed.skipped.length === 1 ? '1 Zeile' : `${parsed.skipped.length} Zeilen`} ohne Bedeutung für das Depot übersprungen</summary>
              <ul className="mt-1 max-h-24 overflow-y-auto pl-4">{parsed.skipped.map((x, i) => <li key={i}>Zeile {x.line}: {x.msg}</li>)}</ul>
            </details>
          )}
          {plan.cashDelta !== 0 && (
            <div className="text-[12.5px] text-ink-2">
              Cash-Wirkung <b className="num text-ink">{sUsd(plan.cashDelta)} USD</b>{base.meta.settings?.cashExcluded ? ' (Cash ist derzeit nicht erfasst und bleibt unverändert).' : '.'}
            </div>
          )}

          {hasData && (
            <fieldset className="grid gap-2 rounded-xl border border-line px-3.5 py-3 text-[12.5px] text-ink-2">
              <legend className="px-1 text-[13px] font-semibold text-ink">Was passiert mit den vorhandenen Daten?</legend>
              {MODES.map((m) => (
                <label key={m.id} className="flex cursor-pointer items-start gap-2.5">
                  <input type="radio" name="import-mode" className="mt-1 accent-[var(--color-accent)]" checked={mode === m.id} onChange={() => { setMode(m.id); setConfirmed(false) }} />
                  <span><b className="font-medium text-ink">{m.label}</b><br /><span className="text-muted">{m.text}</span></span>
                </label>
              ))}
              {mode === 'parts' && (
                <div className="ml-6 grid gap-1.5">
                  {AREAS.filter((a) => a.id !== 'rest').map((a) => (
                    <label key={a.id} className="flex cursor-pointer items-center gap-2">
                      <input type="checkbox" className="accent-[var(--color-accent)]" checked={parts.includes(a.id)} onChange={(e) => { setConfirmed(false); setParts((p) => (e.target.checked ? [...p, a.id] : p.filter((x) => x !== a.id))) }} />
                      {a.label} <span className="text-muted">({a.count(db)})</span>
                    </label>
                  ))}
                </div>
              )}
              {lost.length > 0 && (
                <div className="mt-1 grid gap-2 rounded-lg border border-down/25 bg-down/[0.06] px-3 py-2.5">
                  <p><b className="text-ink">Achtung:</b> Vor dem Übernehmen wird gelöscht: {lost.map((a) => `${a.label} (${a.n})`).join(', ')}. Das lässt sich nicht rückgängig machen.</p>
                  <button type="button" className="btn btn-sm w-fit" onClick={() => downloadBackup(db, getPortfolio())}><Download />Vorher Sicherungskopie herunterladen</button>
                  <label className="flex cursor-pointer items-center gap-2 font-medium text-ink">
                    <input type="checkbox" className="accent-[var(--color-down)]" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                    Ja, diese Daten löschen und ersetzen
                  </label>
                </div>
              )}
            </fieldset>
          )}
        </>
      )}
      {err && <div role="alert" className="text-[12.5px] text-down">{err}</div>}
    </form>
  )
}
