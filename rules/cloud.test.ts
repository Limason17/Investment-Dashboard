/**
 * Speichern in Firestore wie die App (src/lib/cloud.ts) gegen die Emulatoren: npm run test:rules
 * Zwei Geräte gleichzeitig, von einem anderen Gerät gelöschte Dokumente, Sonderzeichen in Tickern, grosse Sammlungen.
 */
import { initializeApp, deleteApp } from 'firebase/app'
import { connectFirestoreEmulator, deleteDoc, doc, getDoc, getFirestore, updateDoc } from 'firebase/firestore/lite'
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkVerified, cloudBatch, cloudLoad, ConflictError, cloudReplace, getAccount, initCloud, signUp } from '../src/lib/cloud'
import type { DB } from '../src/lib/types'

const EMAIL = `cloud-${Date.now()}@example.test`, PW = 'Testpass-123'
const AUTH = 'http://127.0.0.1:9099'
let uid = ''
const empty = (): DB => ({ positions: {}, prices: {}, watchlist: {}, pots: {}, events: {}, log: {}, transactions: {}, dividends: {}, snapshots: {}, meta: {}, market: {} })
// «zweites Gerät»: eigene Firebase-Instanz mit demselben Konto
let other: ReturnType<typeof getFirestore>
let otherApp: ReturnType<typeof initializeApp>

beforeAll(async () => {
  initCloud()
  await signUp(EMAIL, PW, 'Cloud Test')
  const codes = await (await fetch(`${AUTH}/emulator/v1/projects/demo-depot/oobCodes`)).json()
  await fetch(codes.oobCodes.find((c: { email: string }) => c.email === EMAIL).oobLink)
  expect(await checkVerified()).toBe(true)
  uid = getAccount().user!.uid
  otherApp = initializeApp({ apiKey: 'demo-key', projectId: 'demo-depot', appId: 'demo' }, 'zweites-geraet')
  const a = getAuth(otherApp)
  connectAuthEmulator(a, AUTH, { disableWarnings: true })
  await signInWithEmailAndPassword(a, EMAIL, PW)
  other = getFirestore(otherApp)
  connectFirestoreEmulator(other, '127.0.0.1', 8080)
}, 60_000)
afterAll(async () => { if (otherApp) await deleteApp(otherApp) })

describe('Speichern wie die App', () => {
  it('neue Sammlung, danach feldweise Änderungen', async () => {
    let db = { ...empty(), ...(await cloudLoad()) }
    db = { ...db, ...(await cloudBatch(db, [{ op: 'set', coll: 'positions', id: 'VTI', data: { ticker: 'VTI', shares: 1 } }])) }
    db = { ...db, ...(await cloudBatch(db, [{ op: 'merge', coll: 'positions', id: 'VTI', data: { shares: 2 } }, { op: 'set', coll: 'positions', id: 'BRK.B', data: { ticker: 'BRK.B', shares: 1 } }, { op: 'set', coll: 'positions', id: 'a/b c', data: { ticker: 'x', shares: 1 } }])) }
    const fresh = await cloudLoad()
    expect(fresh.positions).toEqual({ VTI: { ticker: 'VTI', shares: 2 }, 'BRK.B': { ticker: 'BRK.B', shares: 1 }, 'a/b c': { ticker: 'x', shares: 1 } })
  })
  it('zwei Geräte: Änderungen verschiedener Einträge überschreiben sich nicht', async () => {
    const db = { ...empty(), ...(await cloudLoad()) }
    await updateDoc(doc(other, 'depots', uid, 'data', 'positions'), { MSFT: { ticker: 'MSFT', shares: 5 } })
    await cloudBatch(db, [{ op: 'set', coll: 'positions', id: 'KO', data: { ticker: 'KO', shares: 3 } }])
    const fresh = await cloudLoad()
    expect(Object.keys(fresh.positions!).sort()).toEqual(['BRK.B', 'KO', 'MSFT', 'VTI', 'a/b c'])
  })
  it('Sammlung auf dem anderen Gerät gelöscht: Hinweis statt Wiederbeleben, nach dem Neuladen klappt Speichern', async () => {
    const db = { ...empty(), ...(await cloudLoad()) }
    await deleteDoc(doc(other, 'depots', uid, 'data', 'positions'))
    await expect(cloudBatch(db, [{ op: 'merge', coll: 'positions', id: 'KO', data: { shares: 4 } }])).rejects.toBeInstanceOf(ConflictError)
    const fresh = { ...empty(), ...(await cloudLoad()) }
    await cloudBatch(fresh, [{ op: 'set', coll: 'positions', id: 'KO', data: { ticker: 'KO', shares: 4 } }])
    const snap = await getDoc(doc(other, 'depots', uid, 'data', 'positions'))
    expect(snap.exists()).toBe(true)
    expect(snap.data()!.KO).toMatchObject({ shares: 4 })
  })
  it('anderes Gerät hat den Cash-Stand geändert: nichts wird überschrieben', async () => {
    const db0 = { ...empty(), ...(await cloudLoad()) }
    await cloudBatch(db0, [{ op: 'merge', coll: 'meta', id: 'settings', data: { cash: 1000 } }])
    const stale = { ...empty(), ...(await cloudLoad()) }
    // Gerät B bucht: Cash 1000 → 900
    await updateDoc(doc(other, 'depots', uid, 'data', 'meta'), { settings: { ...stale.meta.settings, cash: 900 } })
    // Dieses Gerät rechnet noch mit 1000 und will 950 schreiben
    await expect(cloudBatch(stale, [{ op: 'merge', coll: 'meta', id: 'settings', data: { cash: 950 } }])).rejects.toBeInstanceOf(ConflictError)
    const fresh = { ...empty(), ...(await cloudLoad()) }
    expect(fresh.meta.settings!.cash).toBe(900)
    // Andere Einträge derselben Sammlung stören nicht
    await updateDoc(doc(other, 'depots', uid, 'data', 'meta'), { other: { x: 1 } })
    await cloudBatch(fresh, [{ op: 'merge', coll: 'meta', id: 'settings', data: { cash: 850 } }])
    expect((await cloudLoad()).meta!.settings!.cash).toBe(850)
  })
  it('«clear» leert eine Sammlung, folgende Einträge bauen darauf auf', async () => {
    const db = { ...empty(), ...(await cloudLoad()) }
    await cloudBatch(db, [{ op: 'clear', coll: 'positions', id: '*' }, { op: 'set', coll: 'positions', id: 'NEU', data: { ticker: 'NEU', shares: 1 } }])
    expect((await cloudLoad()).positions).toEqual({ NEU: { ticker: 'NEU', shares: 1 } })
  })
  it('Wiederherstellen ersetzt alles und löscht leere Sammlungen', async () => {
    await cloudReplace({ positions: { A: { ticker: 'A', name: 'A', shares: 1, bucket: 'etf', cost: 1 } }, log: {} })
    const fresh = await cloudLoad()
    expect(Object.keys(fresh)).toEqual(['positions'])
  })
  it('zu grosse Sammlung: verständliche Meldung statt Firebase-Fehler', async () => {
    const db = { ...empty(), ...(await cloudLoad()) }
    const ops = Array.from({ length: 3000 }, (_, i) => ({ op: 'set' as const, coll: 'log' as const, id: 'n' + i, data: { date: '2026-11-14', title: 'x'.repeat(100), text: 'y'.repeat(300) } }))
    await expect(cloudBatch(db, ops)).rejects.toThrow(/zu gross|Speicherplatz|1 MB/i)
  })
  it('Firestore lehnt «undefined» nicht ab (wird entfernt)', async () => {
    const db = { ...empty(), ...(await cloudLoad()) }
    await cloudBatch(db, [{ op: 'set', coll: 'events', id: 'e1', data: { title: 'T', date: '2026-12-01', ticker: undefined } }])
    expect((await cloudLoad()).events).toEqual({ e1: { title: 'T', date: '2026-12-01' } })
  })
  it('Einträge löschen und Felder in Einstellungen entfernen', async () => {
    let db = { ...empty(), ...(await cloudLoad()) }
    db = { ...db, ...(await cloudBatch(db, [{ op: 'set', coll: 'meta', id: 'settings', data: { cash: 1, fx: 'CHF' } }, { op: 'set', coll: 'events', id: 'e2', data: { title: 'U', date: '2026-12-02' } }])) }
    db = { ...db, ...(await cloudBatch(db, [{ op: 'merge', coll: 'meta', id: 'settings', data: { fx: undefined } }, { op: 'delete', coll: 'events', id: 'e1' }])) }
    const fresh = await cloudLoad()
    expect(fresh.meta).toEqual({ settings: { cash: 1 } })
    expect(Object.keys(fresh.events!)).toEqual(['e2'])
  })
  it('kein Schreiben mit ungültiger Sammlung oder Id', async () => {
    const db = { ...empty(), ...(await cloudLoad()) }
    await expect(cloudBatch(db, [{ op: 'set', coll: 'geheim' as never, id: 'x', data: {} }])).rejects.toThrow(/ungültig/)
    await expect(cloudBatch(db, [{ op: 'set', coll: 'log', id: '__proto__', data: {} }])).rejects.toThrow(/ungültig/)
  })
})
