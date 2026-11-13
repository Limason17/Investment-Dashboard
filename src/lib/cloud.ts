/**
 * Konten und Daten der Online-Version: Firebase Authentication und Firestore (Gratis-Tarif «Spark»).
 * Firebase wird erst geladen, wenn die Online-Version startet; die lokale Version lädt es nie.
 *
 * Aufbau in Firestore: depots/{uid}/data/{Sammlung}, ein Dokument je Sammlung ({id: Eintrag}),
 * also derselbe Aufbau wie data/*.json lokal. Nur das eigene Konto darf lesen und schreiben (firestore.rules).
 */
import type { Auth, User } from 'firebase/auth'
import type { Firestore } from 'firebase/firestore/lite'
import { useSyncExternalStore } from 'react'
import { EMULATOR, FIREBASE_CONFIG } from './config'
import { MAIN, portfolioList, toMap, type PortfolioInfo, type PortfolioMap } from './portfolios'
import type { DB } from './types'

type AuthModule = typeof import('firebase/auth')
type StoreModule = typeof import('firebase/firestore/lite')
interface Api { auth: Auth; db: Firestore; a: AuthModule; f: StoreModule }

export const COLLECTIONS = ['positions', 'prices', 'watchlist', 'pots', 'events', 'log', 'transactions', 'dividends', 'snapshots', 'meta', 'market'] as const
export type Coll = (typeof COLLECTIONS)[number]
/** «clear» leert eine ganze Sammlung (id beliebig, z. B. «*»); folgende Operationen derselben Sammlung bauen darauf auf. */
export type Op = { op: 'set' | 'merge' | 'delete' | 'clear'; coll: Coll; id: string; data?: object }

/* ------------------------------------------------------------------ Konto-Zustand */

export interface Account { uid: string; email: string; name: string; verified: boolean }
type AccountState = { status: 'loading' | 'out' | 'in'; user: Account | null }
let account: AccountState = { status: 'loading', user: null }
const listeners = new Set<() => void>()
const setAccount = (s: AccountState) => {
  account = s
  listeners.forEach((l) => l())
}
export const getAccount = () => account
export const subscribeAccount = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
export const useAccount = () => useSyncExternalStore(subscribeAccount, getAccount)

const toAccount = (u: User): Account => ({ uid: u.uid, email: u.email ?? '', name: u.displayName ?? '', verified: u.emailVerified })

let api: Promise<Api> | null = null
function load(): Promise<Api> {
  if (!FIREBASE_CONFIG) return Promise.reject(new Error('Die Online-Version ist noch nicht eingerichtet (Firebase fehlt).'))
  api ??= (async () => {
    const [{ initializeApp }, a, f] = await Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore/lite')])
    const app = initializeApp(FIREBASE_CONFIG)
    const auth = a.initializeAuth(app, { persistence: [a.indexedDBLocalPersistence, a.browserLocalPersistence] })
    auth.languageCode = 'de'
    const db = f.getFirestore(app)
    if (EMULATOR) {
      a.connectAuthEmulator(auth, `http://${EMULATOR}:9099`, { disableWarnings: true })
      f.connectFirestoreEmulator(db, EMULATOR, 8080)
    }
    a.onAuthStateChanged(auth, (u) => setAccount(u ? { status: 'in', user: toAccount(u) } : { status: 'out', user: null }))
    return { auth, db, a, f }
  })()
  return api
}

/** Startet Firebase und meldet, ob jemand angemeldet ist. */
export function initCloud() {
  load().catch(() => setAccount({ status: 'out', user: null }))
}

/* ------------------------------------------------------------------ Anmelden */

/** Fehlercodes von Firebase in verständliche Sätze. */
export function authMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? ''
  const map: Record<string, string> = {
    'auth/invalid-email': 'Die E-Mail-Adresse ist ungültig.',
    'auth/missing-password': 'Bitte ein Passwort eingeben.',
    'auth/weak-password': 'Das Passwort braucht mindestens 8 Zeichen.',
    'auth/email-already-in-use': 'Für diese E-Mail-Adresse gibt es schon ein Konto. Melde dich an.',
    'auth/invalid-credential': 'E-Mail oder Passwort stimmt nicht.',
    'auth/wrong-password': 'E-Mail oder Passwort stimmt nicht.',
    'auth/user-not-found': 'E-Mail oder Passwort stimmt nicht.',
    'auth/too-many-requests': 'Zu viele Versuche. Warte einige Minuten.',
    'auth/network-request-failed': 'Keine Verbindung. Prüfe das Internet.',
    'auth/requires-recent-login': 'Melde dich zuerst neu an.',
  }
  return map[code] ?? (e instanceof Error ? e.message : 'Unbekannter Fehler.')
}

export const PASSWORD_MIN = 8

export async function signUp(email: string, password: string, name: string) {
  if (password.length < PASSWORD_MIN) throw Object.assign(new Error(), { code: 'auth/weak-password' })
  const x = await load()
  const cred = await x.a.createUserWithEmailAndPassword(x.auth, email.trim(), password)
  if (name.trim()) await x.a.updateProfile(cred.user, { displayName: name.trim().slice(0, 40) })
  await x.a.sendEmailVerification(cred.user).catch(() => {})
  setAccount({ status: 'in', user: toAccount(cred.user) })
}
export async function signIn(email: string, password: string) {
  const x = await load()
  await x.a.signInWithEmailAndPassword(x.auth, email.trim(), password)
}
export async function resetPassword(email: string) {
  const x = await load()
  await x.a.sendPasswordResetEmail(x.auth, email.trim())
}
/** Bestätigungs-Mail erneut senden */
export async function resendVerification() {
  const x = await load()
  const u = x.auth.currentUser
  if (u) await x.a.sendEmailVerification(u)
}
/** Holt den Stand der E-Mail-Bestätigung neu; nach der Bestätigung auch ein neues Token für die Datenbankregeln. */
export async function checkVerified(): Promise<boolean> {
  const x = await load()
  const u = x.auth.currentUser
  if (!u) return false
  await u.reload()
  if (u.emailVerified) await u.getIdToken(true)
  setAccount({ status: 'in', user: toAccount(u) })
  return u.emailVerified
}
export async function signOut() {
  const x = await load()
  await x.a.signOut(x.auth)
}

/** Löscht alle Daten und das Konto. Verlangt das Passwort, damit niemand an einem offenen Gerät das Konto löscht. */
export async function deleteAccount(password: string) {
  const x = await load()
  const u = x.auth.currentUser
  if (!u?.email) throw new Error('Nicht angemeldet.')
  await x.a.reauthenticateWithCredential(u, x.a.EmailAuthProvider.credential(u.email, password))
  // Alle Portfolios und die Portfolio-Liste löschen, dann das Konto.
  const list = await cloudPortfolios()
  const b = x.f.writeBatch(x.db)
  for (const pf of list) for (const c of COLLECTIONS) b.delete(x.f.doc(x.db, ...collPath(u.uid, pf.id), c))
  b.delete(x.f.doc(x.db, 'depots', u.uid))
  await b.commit()
  await x.a.deleteUser(u)
}

/* ------------------------------------------------------------------ Daten */

/** Firestore-Pfad der Sammlungen eines Portfolios: das erste am bisherigen Ort, weitere darunter. */
const collPath = (uid: string, pid: string): [string, ...string[]] => (pid === MAIN ? ['depots', uid, 'data'] : ['depots', uid, 'portfolios', pid, 'data'])
/** Welche Sammlungs-Dokumente es schon gibt, je Portfolio (neue werden ganz geschrieben, bestehende feldweise). */
const existingBy = new Map<string, Set<Coll>>()
const existingOf = (pid: string) => {
  let e = existingBy.get(pid)
  if (!e) existingBy.set(pid, (e = new Set()))
  return e
}

/** Portfolio-Liste des Kontos (Dokument depots/{uid}). */
export async function cloudPortfolios(): Promise<PortfolioInfo[]> {
  const x = await load()
  const snap = await x.f.getDoc(x.f.doc(x.db, 'depots', uidNow()))
  return portfolioList(snap.exists() ? (snap.data().portfolios as PortfolioMap) : null)
}
export async function cloudSavePortfolios(list: PortfolioInfo[]) {
  const x = await load()
  await x.f.setDoc(x.f.doc(x.db, 'depots', uidNow()), { portfolios: toMap(list) })
}
/** Alle Daten eines Portfolios löschen. */
export async function cloudDeletePortfolio(pid: string) {
  const x = await load()
  const b = x.f.writeBatch(x.db)
  for (const c of COLLECTIONS) b.delete(x.f.doc(x.db, ...collPath(uidNow(), pid), c))
  await b.commit()
  existingBy.delete(pid)
}
const uidNow = () => {
  const u = account.user
  if (!u) throw new Error('Nicht angemeldet.')
  return u.uid
}

/** Alle Sammlungen des Kontos lesen. */
export async function cloudLoad(pid = MAIN): Promise<Partial<DB>> {
  const x = await load()
  const uid = uidNow()
  const snap = await x.f.getDocs(x.f.collection(x.db, ...collPath(uid, pid)))
  const existing = existingOf(pid)
  const out: Record<string, unknown> = {}
  existing.clear()
  snap.forEach((d) => {
    if (!(COLLECTIONS as readonly string[]).includes(d.id)) return
    existing.add(d.id as Coll)
    out[d.id] = d.data()
  })
  return out as Partial<DB>
}

/** Firestore nimmt kein «undefined» an. */
const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v ?? null))

/**
 * Änderungen wie /api/batch anwenden und in einem Zug schreiben.
 * Einzelne Einträge werden per Feldpfad geändert; so überschreiben sich zwei Geräte nicht ganze Sammlungen.
 */
export async function cloudBatch(db: DB, ops: Op[], pid = MAIN): Promise<Partial<DB>> {
  const x = await load()
  const uid = uidNow()
  const touched = new Map<Coll, Record<string, unknown>>()
  const fields = new Map<Coll, Map<string, unknown>>()
  const full = new Set<Coll>()
  for (const o of ops) {
    if (!(COLLECTIONS as readonly string[]).includes(o.coll) || typeof o.id !== 'string' || !o.id || o.id === '__proto__') throw new Error('ungültige Operation')
    const data = touched.get(o.coll) ?? { ...(db[o.coll] as Record<string, unknown>) }
    const f = fields.get(o.coll) ?? new Map<string, unknown>()
    if (o.op === 'clear') {
      touched.set(o.coll, {})
      fields.set(o.coll, new Map())
      full.add(o.coll)
      continue
    }
    if (o.op === 'delete') {
      delete data[o.id]
      f.set(o.id, x.f.deleteField())
    } else {
      data[o.id] = clean(o.op === 'merge' ? { ...(data[o.id] as object), ...o.data } : (o.data ?? {}))
      f.set(o.id, data[o.id])
    }
    touched.set(o.coll, data)
    fields.set(o.coll, f)
  }
  const b = x.f.writeBatch(x.db)
  for (const [c, data] of touched) {
    const ref = x.f.doc(x.db, ...collPath(uid, pid), c)
    if (!existingOf(pid).has(c) || full.has(c)) b.set(ref, data)
    else {
      const pairs = [...fields.get(c)!.entries()].flatMap(([id, v]) => [new x.f.FieldPath(id), v])
      if (pairs.length) b.update(ref, pairs[0] as InstanceType<StoreModule['FieldPath']>, pairs[1], ...pairs.slice(2))
    }
  }
  await b.commit()
  for (const c of touched.keys()) existingOf(pid).add(c)
  return Object.fromEntries(touched) as Partial<DB>
}

/** Ersetzt alle Daten des Kontos (Backup einspielen). */
export async function cloudReplace(all: Partial<DB>, pid = MAIN) {
  const x = await load()
  const uid = uidNow()
  const b = x.f.writeBatch(x.db)
  for (const c of COLLECTIONS) {
    const ref = x.f.doc(x.db, ...collPath(uid, pid), c)
    const v = all[c]
    if (v && typeof v === 'object' && Object.keys(v).length) {
      b.set(ref, clean(v))
      existingOf(pid).add(c)
    } else {
      b.delete(ref)
      existingOf(pid).delete(c)
    }
  }
  await b.commit()
}
