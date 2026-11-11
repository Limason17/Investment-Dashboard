import { Download, LogOut, Trash2, Upload } from 'lucide-react'
import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Sheet } from '@/components/Sheet'
import { Segmented } from '@/components/ui'
import { authMessage, cloudReplace, COLLECTIONS, deleteAccount, PASSWORD_MIN, resetPassword, signIn, signOut, signUp, useAccount } from '@/lib/cloud'
import { CLOUD } from '@/lib/config'
import { today } from '@/lib/format'
import { loadDb, useStore } from '@/lib/store'
import { toast } from '@/lib/toast'
import type { DB } from '@/lib/types'

/* ------------------------------------------------------------------ Backup-Datei */

const BACKUP_KIND = 'depot-backup'

/** Alle Sammlungen als JSON-Datei herunterladen. */
function downloadBackup(db: DB) {
  const data = Object.fromEntries(COLLECTIONS.filter((c) => c !== 'market').map((c) => [c, db[c]]))
  const blob = new Blob([JSON.stringify({ kind: BACKUP_KIND, version: 1, exportedAt: new Date().toISOString(), data }, null, 1)], { type: 'application/json' })
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `depot-backup-${today()}.json` })
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

/** Backup-Datei prüfen. Nimmt auch die Dateien aus data/ einzeln nicht an: nur das Backup als Ganzes. */
function readBackup(text: string): Partial<DB> {
  let j: { kind?: string; data?: Record<string, unknown> }
  try {
    j = JSON.parse(text)
  } catch {
    throw new Error('Die Datei ist kein gültiges Backup (kein JSON).')
  }
  if (j.kind !== BACKUP_KIND || !j.data || typeof j.data !== 'object') throw new Error('Die Datei ist kein Depot-Backup.')
  const out: Record<string, unknown> = {}
  for (const c of COLLECTIONS) {
    const v = j.data[c]
    if (v == null) continue
    if (typeof v !== 'object' || Array.isArray(v)) throw new Error(`Sammlung «${c}» ist beschädigt.`)
    out[c] = v
  }
  if (!Object.keys(out).length) throw new Error('Das Backup ist leer.')
  return out as Partial<DB>
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

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    setInfo('')
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
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ Konto-Blatt */

export function AccountSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAccount()
  const { db } = useStore()
  const file = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<Partial<DB> | null>(null)
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
      await cloudReplace(pending)
      await loadDb()
      setPending(null)
      toast('Backup eingespielt.')
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
  const n = (d: Partial<DB>) => Object.keys(d.positions ?? {}).length + ' Positionen, ' + Object.keys(d.transactions ?? {}).length + ' Buchungen, ' + Object.keys(d.dividends ?? {}).length + ' Dividenden'

  return (
    <Sheet open={open} onClose={onClose} title={CLOUD ? 'Konto' : 'Backup'} sub={CLOUD ? user?.email : 'Daten dieses Rechners als Datei sichern'}>
      <div className="grid gap-5">
        {CLOUD && user && !user.verified && (
          <p className="rounded-xl border border-warn/25 bg-warn/[0.07] px-3.5 py-2.5 text-[12.5px] text-ink-2">Bestätige deine E-Mail-Adresse über den Link in der Willkommens-Mail.</p>
        )}

        <section className="grid gap-2">
          <h3 className="text-[13px] font-semibold">Backup</h3>
          <p className="text-[12.5px] leading-[1.55] text-muted">
            {CLOUD
              ? 'Eine Datei mit allen Daten deines Depots. Mit «Backup einspielen» übernimmst du auch die Daten aus der lokalen Version.'
              : 'Eine Datei mit allen Daten aus data/. In der Online-Version spielst du sie unter «Konto» ein.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-sm" disabled={!db} onClick={() => db && downloadBackup(db)}><Download />Backup herunterladen</button>
            {CLOUD && <button type="button" className="btn btn-sm" onClick={() => file.current?.click()}><Upload />Backup einspielen</button>}
            <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => void pick(e.target.files?.[0])} />
          </div>
          {pending && (
            <div className="grid gap-2 rounded-xl border border-warn/25 bg-warn/[0.07] px-3.5 py-3 text-[12.5px] text-ink-2">
              <p><b className="text-ink">Achtung:</b> Das Backup ersetzt alle Daten in diesem Konto. Lade vorher ein Backup herunter, falls du die jetzigen Daten brauchst.</p>
              <p className="text-muted">Im Backup: {n(pending)}.</p>
              <div className="flex gap-2">
                <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void restore()}>{busy ? 'Spielt ein …' : 'Ersetzen'}</button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPending(null)}>Abbrechen</button>
              </div>
            </div>
          )}
        </section>

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
      </div>
    </Sheet>
  )
}
