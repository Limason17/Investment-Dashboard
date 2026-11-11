/**
 * Einstellungen der Online-Version.
 *
 * CLOUD: true im Build für GitHub Pages (Konten, Daten in Firebase). Lokal («npm run dev») false:
 * Daten in data/, Kurse über den lokalen Server.
 *
 * FIREBASE_CONFIG: Werte aus der Firebase-Konsole (Projekteinstellungen → Meine Apps).
 * Sie sind öffentlich: Jede Web-App liefert sie an den Browser aus. Was ein Konto lesen
 * und schreiben darf, regeln die Regeln in firestore.rules.
 *
 * QUOTES_URL: Adresse des Kurs-Dienstes (Cloudflare Worker, siehe worker/).
 */
export interface FirebaseConfig {
  apiKey: string
  authDomain: string
  projectId: string
  appId: string
  storageBucket?: string
  messagingSenderId?: string
}

export const CLOUD = import.meta.env.VITE_BACKEND === 'cloud'

/** Wird nach dem Einrichten eingetragen (docs/einrichten.md). Eine Umgebungsvariable VITE_FIREBASE_CONFIG (JSON) hat Vorrang. */
const PROJECT_CONFIG: FirebaseConfig | null = {
  apiKey: 'AIzaSyBecRVll5O_ihzU6DqUs3F2OD6_-cxJK1U',
  authDomain: 'investment-dashboard-fa06a.firebaseapp.com',
  projectId: 'investment-dashboard-fa06a',
  storageBucket: 'investment-dashboard-fa06a.firebasestorage.app',
  messagingSenderId: '826841855193',
  appId: '1:826841855193:web:3d8d097e15883361f43ac8',
}
const QUOTES = 'https://depot-kurse.liambruno007.workers.dev'

function fromEnv(): FirebaseConfig | null {
  const raw = import.meta.env.VITE_FIREBASE_CONFIG as string | undefined
  if (!raw) return null
  try {
    return JSON.parse(raw) as FirebaseConfig
  } catch {
    return null
  }
}

export const FIREBASE_CONFIG: FirebaseConfig | null = fromEnv() ?? PROJECT_CONFIG
export const QUOTES_URL = ((import.meta.env.VITE_QUOTES_URL as string | undefined) || QUOTES).replace(/\/$/, '')
/** Nur für Tests mit den Firebase-Emulatoren, nie im veröffentlichten Build. */
export const EMULATOR = import.meta.env.VITE_FIREBASE_EMULATOR as string | undefined
