import { ClipboardPaste, Download, LogOut, RotateCcw, Trash2, Upload } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Sheet } from '@/components/Sheet'
import { Segmented } from '@/components/ui'
import { authMessage, checkVerified, cloudReplace, COLLECTIONS, deleteAccount, PASSWORD_MIN, resendVerification, resetPassword, signIn, signOut, signUp, useAccount } from '@/lib/cloud'
import { detectKind, LIMITS, TEMPLATE_NAME, templateFile, type ImportKind } from '@/lib/bulk'
import { BACKUP_KIND, downloadBackup } from '@/lib/backup'
import { CLOUD } from '@/lib/config'
import { LegalLinks, LegalSheet, type LegalDoc } from './Legal'
import { ALL } from '@/lib/portfolios'
import { useNav } from '@/lib/context'
import { loadDb, useStore } from '@/lib/store'
import { toast } from '@/lib/toast'
import type { DB } from '@/lib/types'

/* ------------------------------------------------------------------ Backup-Datei */

const BACKUP_MAX_BYTES = 5_000_000
const MAX_ENTRIES = 20_000
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Sicherungskopie prüfen, bevor sie etwas ersetzt: nur bekannte Sammlungen, jeder Eintrag ein Objekt,
 * gültige Schlüssel, Positionen mit Ticker und Stückzahl. Unbekanntes wird verworfen, nie übernommen.
 */
function readBackup(text: string): Partial<DB> {
  if (text.length > BACKUP_MAX_BYTES) throw new Error('Die Datei ist zu gross (höchstens 5 MB).')
  let j: unknown
  try {
    j = JSON.parse(text)
  } catch {
    throw new Error('Die Datei ist keine Sicherungskopie. Eine ausgefüllte Vorlage lädst du oben unter «Positionen hochladen» hoch.')
  }
  if (!isObj(j) || j.kind !== BACKUP_KIND || !isObj(j.data)) throw new Error('Die Datei ist keine Sicherungskopie dieses Dashboards.')
  const out: Record<string, Record<string, unknown>> = {}
  for (const c of COLLECTIONS) {
    const v = j.data[c]
    if (v == null) continue
    if (!isObj(v)) throw new Error(`Sammlung «${c}» ist beschädigt.`)
    const entries = Object.entries(v)
    if (entries.length > MAX_ENTRIES) throw new Error(`Sammlung «${c}» hat zu viele Einträge.`)
    const clean: Record<string, unknown> = {}
    for (const [id, e] of entries) {
      if (!id || id.length > 200 || id === '__proto__' || id === 'constructor' || !isObj(e)) throw new Error(`Sammlung «${c}» enthält einen ungültigen Eintrag.`)
      if (c === 'positions' && (typeof e.ticker !== 'string' || typeof e.shares !== 'number' || !Number.isFinite(e.shares))) throw new Error(`Position «${id}» ist unvollständig.`)
      clean[id] = e
    }
    out[c] = clean
  }
  return out as Partial<DB>
}

/** Ausgefüllte Vorlage lesen und das Upload-Blatt mit Vorschau öffnen. */
async function readTemplate(f: File): Promise<{ kind: ImportKind; text: string }> {
  if (f.size > LIMITS.bytes) throw new Error('Die Datei ist zu gross (höchstens 2 MB).')
  if (/\.json$/i.test(f.name)) throw new Error('Das ist eine Sicherungskopie (JSON). Sie stellst du unten unter «Sicherungskopie» wieder her.')
  const text = await f.text()
  const kind = detectKind(text)
  if (!kind) throw new Error('Die Datei passt zu keiner Vorlage. Lade zuerst eine Vorlage herunter und fülle sie aus.')
  return { kind, text }
}

function download(text: string, name: string) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })), download: name })
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

/* ------------------------------------------------------------------ Anmelden und Registrieren */

function Field({ label, children, hint }: { label: string; children: (id: string) => ReactNode; hint?: string }) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <div className="text-[11.5px] text-muted">{hint}</div>}
    </div>
  )
}

type Mode = 'login' | 'register' | 'reset'

export function AuthScreen({ brand }: { brand: ReactNode }) {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')
  const [agree, setAgree] = useState(false)
  const [legal, setLegal] = useState<LegalDoc | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    setInfo('')
    if (mode === 'register' && !agree) return setErr('Bitte bestätige die Nutzungsbedingungen und die Datenschutzerklärung.')
    setBusy(true)
    try {
      if (mode === 'login') await signIn(email, password)
      else if (mode === 'register') await signUp(email, password, name)
      else {
        await resetPassword(email)
        setInfo('Falls ein Konto zu dieser Adresse besteht, ist eine E-Mail zum Zurücksetzen unterwegs.')
      }
    } catch (x) {
      setErr(authMessage(x))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-[380px]">
        <div className="mb-7 flex justify-center">{brand}</div>
        <div className="card p-5 sm:p-6">
          <h1 className="text-[18px] font-semibold tracking-[-0.02em]">{mode === 'login' ? 'Anmelden' : mode === 'register' ? 'Konto erstellen' : 'Passwort zurücksetzen'}</h1>
          <p className="mt-1 text-[12.5px] text-muted">
            {mode === 'reset' ? 'Du bekommst einen Link per E-Mail.' : 'Dein Depot, deine Daten. Nur du siehst dein Konto. Es werden nie Orders platziert.'}
          </p>
          {mode !== 'reset' && (
            <Segmented className="mt-4 flex w-full [&>button]:flex-1" label="Anmelden oder registrieren" value={mode} onChange={(m) => { setMode(m); setErr('') }} options={[{ value: 'login', label: 'Anmelden' }, { value: 'register', label: 'Registrieren' }]} />
          )}
          <form onSubmit={submit} className="mt-4 grid gap-3.5">
            {mode === 'register' && <Field label="Name">{(id) => <input id={id} className="input" autoComplete="name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />}</Field>}
            <Field label="E-Mail">{(id) => <input id={id} className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />}</Field>
            {mode !== 'reset' && (
              <Field label="Passwort" hint={mode === 'register' ? `mindestens ${PASSWORD_MIN} Zeichen` : undefined}>
                {(id) => <input id={id} className="input" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required minLength={mode === 'register' ? PASSWORD_MIN : undefined} value={password} onChange={(e) => setPassword(e.target.value)} />}
              </Field>
            )}
            {mode === 'register' && (
              <label className="flex cursor-pointer items-start gap-2.5 text-[12.5px] leading-[1.5] text-ink-2">
                <input type="checkbox" className="mt-0.5 size-4 flex-none accent-[var(--color-accent)]" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                <span>
                  Ich akzeptiere die <button type="button" className="underline underline-offset-4" onClick={() => setLegal('nutzung')}>Nutzungsbedingungen</button> und habe die <button type="button" className="underline underline-offset-4" onClick={() => setLegal('datenschutz')}>Datenschutzerklärung</button> gelesen. Depot ist keine Anlageberatung.
                </span>
              </label>
            )}
            {err && <div role="alert" className="text-[12.5px] text-down">{err}</div>}
            {info && <div role="status" className="text-[12.5px] text-up">{info}</div>}
            <button type="submit" className="btn btn-primary w-full" disabled={busy}>
              {busy ? 'Bitte warten …' : mode === 'login' ? 'Anmelden' : mode === 'register' ? 'Konto erstellen' : 'Link senden'}
            </button>
          </form>
          <button type="button" className="mt-4 text-[12.5px] text-muted underline decoration-line-2 underline-offset-4 hover:text-ink" onClick={() => { setMode(mode === 'reset' ? 'login' : 'reset'); setErr(''); setInfo('') }}>
            {mode === 'reset' ? 'Zurück zur Anmeldung' : 'Passwort vergessen?'}
          </button>
        </div>
        <LegalLinks className="mt-5 block text-center text-[12px] text-muted" onOpen={setLegal} />
      </div>
      <LegalSheet doc={legal} onClose={() => setLegal(null)} />
    </div>
  )
}

/* ------------------------------------------------------------------ E-Mail bestätigen */

/** Neues Konto: erst nach bestätigter E-Mail-Adresse geht es weiter. Prüft beim Zurückkehren ins Fenster selbst. */
export function VerifyScreen({ brand }: { brand: ReactNode }) {
  const { user } = useAccount()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')
  const [sent, setSent] = useState(false)

  useEffect(() => {
    const again = () => { if (document.visibilityState === 'visible') void checkVerified().catch(() => {}) }
    document.addEventListener('visibilitychange', again)
    window.addEventListener('focus', again)
    const t = window.setInterval(again, 15000)
    return () => { document.removeEventListener('visibilitychange', again); window.removeEventListener('focus', again); window.clearInterval(t) }
  }, [])

  const check = async () => {
    setBusy(true); setErr(''); setInfo('')
    try {
      if (!(await checkVerified())) setErr('Noch nicht bestätigt. Öffne den Link in der E-Mail und tippe dann noch einmal hier.')
    } catch (x) { setErr(authMessage(x)) } finally { setBusy(false) }
  }
  const resend = async () => {
    setErr(''); setInfo('')
    try { await resendVerification(); setSent(true); setInfo('Neue E-Mail gesendet. Schau auch im Spam-Ordner nach.') } catch (x) { setErr(authMessage(x)) }
  }

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-[380px]">
        <div className="mb-7 flex justify-center">{brand}</div>
        <div className="card p-5 sm:p-6">
          <h1 className="text-[18px] font-semibold tracking-[-0.02em]">E-Mail bestätigen</h1>
          <p className="mt-1.5 text-[13px] leading-[1.55] text-ink-2">
            Wir haben einen Link an <b className="font-medium text-ink">{user?.email}</b> gesendet. Öffne ihn, dann geht es hier weiter. So stellen wir sicher, dass die Adresse dir gehört und du dein Passwort zurücksetzen kannst.
          </p>
          {err && <div role="alert" className="mt-3 text-[12.5px] text-down">{err}</div>}
          {info && <div role="status" className="mt-3 text-[12.5px] text-up">{info}</div>}
          <button type="button" className="btn btn-primary mt-4 w-full" disabled={busy} onClick={check}>{busy ? 'Bitte warten …' : 'Ich habe bestätigt'}</button>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
            <button type="button" className="text-muted underline decoration-line-2 underline-offset-4 hover:text-ink disabled:opacity-50" disabled={sent} onClick={resend}>E-Mail erneut senden</button>
            <button type="button" className="text-muted underline decoration-line-2 underline-offset-4 hover:text-ink" onClick={() => void signOut()}>Andere Adresse verwenden</button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ Konto-Blatt */

export function AccountSheet({ open, onClose, onPortfolios, onTour }: { open: boolean; onClose: () => void; onPortfolios: () => void; onTour: () => void }) {
  const { user } = useAccount()
  const { db, portfolio, portfolios } = useStore()
  const allView = portfolio === ALL
  const pfName = portfolios.length > 1 ? portfolios.find((p) => p.id === portfolio)?.name : undefined
  const file = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<Partial<DB> | null>(null)
  const [legal, setLegal] = useState<LegalDoc | null>(null)
  const [del, setDel] = useState(false)
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const pick = async (f: File | undefined) => {
    setErr('')
    if (file.current) file.current.value = ''
    if (!f) return
    try {
      setPending(readBackup(await f.text()))
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x))
    }
  }
  const restore = async () => {
    if (!pending) return
    setBusy(true)
    try {
      if (allView) throw new Error('In der Gesamtansicht lässt sich nichts wiederherstellen. Wähle zuerst ein Portfolio.')
      await cloudReplace(pending, portfolio)
      await loadDb()
      setPending(null)
      toast('Sicherungskopie wiederhergestellt.')
      onClose()
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x))
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    setBusy(true)
    setErr('')
    try {
      await deleteAccount(pw)
      location.reload()
    } catch (x) {
      setErr(authMessage(x))
      setBusy(false)
    }
  }
  const nav = useNav()
  const tpl = useRef<HTMLInputElement>(null)
  const empty = !!db && !Object.keys(db.positions).length && !Object.keys(db.transactions).length && !Object.keys(db.dividends).length
  const upload = async (f: File | undefined) => {
    setErr('')
    if (tpl.current) tpl.current.value = ''
    if (!f) return
    try {
      const { kind, text } = await readTemplate(f)
      onClose()
      nav.openEntry('import', { kind, text })
    } catch (x) {
      setErr(x instanceof Error ? x.message : String(x))
    }
  }
  const n = (d: Partial<DB>) => Object.keys(d.positions ?? {}).length + ' Positionen, ' + Object.keys(d.transactions ?? {}).length + ' Buchungen, ' + Object.keys(d.dividends ?? {}).length + ' Dividenden'

  return (
    <Sheet open={open} onClose={onClose} title={CLOUD ? 'Konto und Daten' : 'Daten'} sub={CLOUD ? user?.email : 'Positionen hochladen und Daten sichern'}>
      <div className="grid gap-5">

        <section className="flex items-center justify-between gap-3 rounded-xl border border-line px-3.5 py-3">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold">Portfolios</div>
            <div className="truncate text-[12px] text-muted">{portfolios.length > 1 ? `${portfolios.length} Portfolios · offen: ${allView ? 'Gesamtansicht' : portfolios.find((p) => p.id === portfolio)?.name}` : 'Getrennte Depots anlegen, z. B. je Broker'}</div>
          </div>
          <button type="button" className="btn btn-sm flex-none" onClick={onPortfolios}>Verwalten</button>
        </section>
        <section className="flex items-center justify-between gap-3 rounded-xl border border-line px-3.5 py-3">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold">Einführung</div>
            <div className="truncate text-[12px] text-muted">Die wichtigsten Stellen in einer Minute</div>
          </div>
          <button type="button" className="btn btn-sm flex-none" onClick={onTour}>Ansehen</button>
        </section>

        {allView ? (
          <p className="rounded-xl border border-line px-3.5 py-3 text-[12.5px] text-muted">Du siehst die Gesamtansicht. Zum Hochladen oder Sichern wähle zuerst ein Portfolio.</p>
        ) : (<>
        <section className="grid gap-3">
          <div>
            <h3 className="text-[14px] font-semibold">Bestehende Positionen hochladen</h3>
            <p className="mt-1 text-[12.5px] leading-[1.55] text-muted">Alle Käufe oder Dividenden auf einmal statt jeden einzeln. Mit Kaufdatum, damit Wertverlauf und Charts stimmen.</p>
          </div>
          <div className="grid grid-cols-1 gap-2 min-[440px]:grid-cols-2">
            <button type="button" className="btn h-auto min-w-0 flex-col items-start gap-0.5 whitespace-normal px-3.5 py-3 text-left" onClick={() => { onClose(); nav.openEntry('import', { kind: 'trades' }) }}>
              <span className="flex items-center gap-2 font-semibold"><ClipboardPaste />Text einfügen</span>
              <span className="text-[12px] font-normal text-muted">Vorlage kopieren, ausfüllen, einfügen</span>
            </button>
            <button type="button" className="btn h-auto min-w-0 flex-col items-start gap-0.5 whitespace-normal px-3.5 py-3 text-left" onClick={() => tpl.current?.click()}>
              <span className="flex items-center gap-2 font-semibold"><Upload />Datei hochladen</span>
              <span className="text-[12px] font-normal text-muted">Ausgefüllte CSV-Vorlage oder Schwab-Export</span>
            </button>
          </div>
          <input ref={tpl} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" hidden onChange={(e) => void upload(e.target.files?.[0])} />
          <p className="text-[12px] text-muted">Vorlagen als Datei: <button type="button" className="underline decoration-line-2 underline-offset-4 hover:text-ink" onClick={() => download(templateFile('trades'), TEMPLATE_NAME.trades)}>Käufe/Verkäufe</button> · <button type="button" className="underline decoration-line-2 underline-offset-4 hover:text-ink" onClick={() => download(templateFile('dividenden'), TEMPLATE_NAME.dividenden)}>Dividenden</button></p>
        </section>

        <section className="grid gap-2 border-t border-line pt-5">
          <h3 className="text-[13px] font-semibold">Sicherungskopie</h3>
          <p className="text-[12.5px] leading-[1.55] text-muted">
            {CLOUD
              ? `Eine Kopie aller Daten ${pfName ? `des Portfolios «${pfName}»` : 'deines Depots'} zum Aufbewahren. Nicht zum Ausfüllen gedacht. «Wiederherstellen» ersetzt alle Daten dieses Portfolios durch die Kopie.`
              : 'Eine Kopie aller Daten dieses Rechners zum Aufbewahren. In der Online-Version stellst du sie unter «Konto» wieder her.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-sm" disabled={!db || empty} title={empty ? 'Dein Depot ist noch leer.' : undefined} onClick={() => db && downloadBackup(db, portfolio)}><Download />Sicherungskopie herunterladen</button>
            {CLOUD && <button type="button" className="btn btn-sm btn-ghost" onClick={() => file.current?.click()}><RotateCcw />Wiederherstellen</button>}
            <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => void pick(e.target.files?.[0])} />
          </div>
          {empty && <p className="text-[12px] text-muted">Dein Depot ist noch leer. Lade zuerst deine Positionen hoch.</p>}
          {pending && (
            <div className="grid gap-2 rounded-xl border border-warn/25 bg-warn/[0.07] px-3.5 py-3 text-[12.5px] text-ink-2">
              <p><b className="text-ink">Achtung:</b> Die Kopie ersetzt alle Daten in diesem Konto. Das lässt sich nicht rückgängig machen. Lade vorher eine Sicherungskopie herunter, falls du die jetzigen Daten brauchst.</p>
              <p className="text-muted">In der Kopie: {n(pending)}.</p>
              <div className="flex gap-2">
                <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void restore()}>{busy ? 'Stellt wieder her …' : 'Alle Daten ersetzen'}</button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPending(null)}>Abbrechen</button>
              </div>
            </div>
          )}
        </section>
        </>)}

        {CLOUD && (
          <>
            <section className="grid gap-2 border-t border-line pt-5">
              <button type="button" className="btn btn-sm w-fit" onClick={() => void signOut().then(() => location.reload())}><LogOut />Abmelden</button>
            </section>
            <section className="grid gap-2 border-t border-line pt-5">
              {!del ? (
                <button type="button" className="btn btn-sm btn-ghost w-fit text-down" onClick={() => setDel(true)}><Trash2 />Konto löschen</button>
              ) : (
                <div className="grid gap-2 rounded-xl border border-down/25 bg-down/[0.06] px-3.5 py-3 text-[12.5px] text-ink-2">
                  <p><b className="text-ink">Achtung:</b> Das löscht dein Konto und alle Daten darin. Das lässt sich nicht rückgängig machen.</p>
                  <input className="input" type="password" autoComplete="current-password" placeholder="Passwort zur Bestätigung" value={pw} onChange={(e) => setPw(e.target.value)} />
                  <div className="flex gap-2">
                    <button type="button" className="btn btn-sm btn-primary" disabled={busy || !pw} onClick={() => void remove()}>{busy ? 'Löscht …' : 'Endgültig löschen'}</button>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setDel(false); setPw('') }}>Abbrechen</button>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
        {err && <div role="alert" className="text-[12.5px] text-down">{err}</div>}
        <LegalLinks className="border-t border-line pt-4 text-[12px] text-muted" onOpen={setLegal} />
      </div>
      <LegalSheet doc={legal} onClose={() => setLegal(null)} />
    </Sheet>
  )
}
