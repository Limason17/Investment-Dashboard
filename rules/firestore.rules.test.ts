/**
 * Sicherheit der Datenbankregeln (firestore.rules) gegen den Firestore-Emulator: npm run test:rules
 * Jedes Konto darf nur seine eigenen Daten lesen und, mit bestätigter E-Mail-Adresse, schreiben.
 */
import { readFileSync } from 'node:fs'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

let env: RulesTestEnvironment
const verified = { email: 'a@example.test', email_verified: true }

beforeAll(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':')
  env = await initializeTestEnvironment({ projectId: 'demo-depot', firestore: { rules: readFileSync('firestore.rules', 'utf8'), host, port: Number(port) } })
})
afterAll(() => env?.cleanup())
beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), 'depots/bob'), { portfolios: { main: { name: 'Haupt', order: 0 } } })
    await setDoc(doc(c.firestore(), 'depots/bob/data/positions'), { VTI: { ticker: 'VTI', shares: 3 } })
    await setDoc(doc(c.firestore(), 'depots/bob/portfolios/zweit/data/meta'), { settings: { cash: 1 } })
  })
})

const alice = () => env.authenticatedContext('alice', verified).firestore()
const aliceUnverified = () => env.authenticatedContext('alice', { email: 'a@example.test', email_verified: false }).firestore()

describe('eigenes Konto', () => {
  it('liest und schreibt mit bestätigter Adresse', async () => {
    const db = alice()
    await assertSucceeds(setDoc(doc(db, 'depots/alice'), { portfolios: { main: { name: 'Haupt', order: 0 } } }))
    await assertSucceeds(setDoc(doc(db, 'depots/alice/data/positions'), { VTI: { ticker: 'VTI', shares: 1 } }))
    await assertSucceeds(updateDoc(doc(db, 'depots/alice/data/positions'), { 'VTI.shares': 2 }))
    await assertSucceeds(getDoc(doc(db, 'depots/alice/data/positions')))
    await assertSucceeds(getDocs(collection(db, 'depots/alice/data')))
    await assertSucceeds(setDoc(doc(db, 'depots/alice/portfolios/ira-2/data/transactions'), { t1: { type: 'kauf' } }))
    await assertSucceeds(deleteDoc(doc(db, 'depots/alice/portfolios/ira-2/data/transactions')))
  })
  it('ohne bestätigte Adresse: lesen und löschen ja, schreiben nein', async () => {
    const db = aliceUnverified()
    await assertFails(setDoc(doc(db, 'depots/alice/data/positions'), { VTI: { ticker: 'VTI', shares: 1 } }))
    await assertFails(setDoc(doc(db, 'depots/alice'), { portfolios: {} }))
    await assertSucceeds(getDoc(doc(db, 'depots/alice/data/positions')))
    await assertSucceeds(deleteDoc(doc(db, 'depots/alice/data/positions')))
    await assertSucceeds(deleteDoc(doc(db, 'depots/alice')))
  })
  it('«email_verified» muss wirklich true sein, nicht nur ein Text', async () => {
    const db = env.authenticatedContext('alice', { email: 'a@example.test', email_verified: 'true' as never }).firestore()
    await assertFails(setDoc(doc(db, 'depots/alice/data/positions'), {}))
  })
})

describe('fremde Konten', () => {
  it('kein Lesen, Schreiben oder Löschen fremder Daten', async () => {
    const db = alice()
    await assertFails(getDoc(doc(db, 'depots/bob')))
    await assertFails(getDoc(doc(db, 'depots/bob/data/positions')))
    await assertFails(getDocs(collection(db, 'depots/bob/data')))
    await assertFails(getDoc(doc(db, 'depots/bob/portfolios/zweit/data/meta')))
    await assertFails(setDoc(doc(db, 'depots/bob/data/positions'), { X: { ticker: 'X', shares: 1 } }))
    await assertFails(updateDoc(doc(db, 'depots/bob/data/positions'), { 'VTI.shares': 0 }))
    await assertFails(deleteDoc(doc(db, 'depots/bob/data/positions')))
    await assertFails(deleteDoc(doc(db, 'depots/bob')))
    await assertFails(setDoc(doc(db, 'depots/bob/portfolios/neu/data/meta'), {}))
  })
  it('keine Liste aller Konten', async () => {
    await assertFails(getDocs(collection(alice(), 'depots')))
  })
  it('ohne Anmeldung nichts', async () => {
    const db = env.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(db, 'depots/bob/data/positions')))
    await assertFails(setDoc(doc(db, 'depots/anon/data/positions'), {}))
  })
})

describe('Form der Daten', () => {
  it('nur bekannte Sammlungen', async () => {
    const db = alice()
    await assertFails(setDoc(doc(db, 'depots/alice/data/geheim'), { a: 1 }))
    await assertFails(setDoc(doc(db, 'depots/alice/portfolios/p1/data/geheim'), { a: 1 }))
    for (const c of ['positions', 'prices', 'watchlist', 'pots', 'events', 'log', 'transactions', 'dividends', 'snapshots', 'meta', 'market'])
      await assertSucceeds(setDoc(doc(db, `depots/alice/data/${c}`), { x: {} }))
  })
  it('Portfolio-Liste: nur das Feld «portfolios», eine Map mit höchstens 20 Einträgen', async () => {
    const db = alice()
    const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`p${i}`, { name: 'x', order: i }]))
    await assertFails(setDoc(doc(db, 'depots/alice'), { portfolios: many }))
    await assertFails(setDoc(doc(db, 'depots/alice'), { portfolios: 'x' }))
    await assertFails(setDoc(doc(db, 'depots/alice'), { portfolios: {}, admin: true }))
    const twenty = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`p${i}`, { name: 'x', order: i }]))
    await assertSucceeds(setDoc(doc(db, 'depots/alice'), { portfolios: twenty }))
  })
  it('Portfolio-IDs nur aus a–z, 0–9 und Bindestrich', async () => {
    const db = alice()
    await assertFails(setDoc(doc(db, 'depots/alice/portfolios/Gross/data/meta'), {}))
    await assertFails(setDoc(doc(db, 'depots/alice/portfolios/-start/data/meta'), {}))
    await assertFails(setDoc(doc(db, 'depots/alice/portfolios/' + 'a'.repeat(41) + '/data/meta'), {}))
    await assertSucceeds(setDoc(doc(db, 'depots/alice/portfolios/' + 'a'.repeat(40) + '/data/meta'), {}))
  })
  it('höchstens 20 000 Einträge je Sammlung', async () => {
    const big = Object.fromEntries(Array.from({ length: 20001 }, (_, i) => ['k' + i, 1]))
    await assertFails(setDoc(doc(alice(), 'depots/alice/data/log'), big))
  })
  it('nichts ausserhalb von depots/', async () => {
    const db = alice()
    await assertFails(setDoc(doc(db, 'users/alice'), { a: 1 }))
    await assertFails(getDoc(doc(db, 'users/alice')))
    await assertFails(setDoc(doc(db, 'depots/alice/portfolios/p1'), { a: 1 }))
    await assertFails(setDoc(doc(db, 'depots/alice/sonstwas/x'), { a: 1 }))
  })
})
