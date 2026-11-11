import { COLLECTIONS } from './cloud'
import { today } from './format'
import type { DB } from './types'

export const BACKUP_KIND = 'depot-backup'

/** Alle Sammlungen als JSON-Datei herunterladen (Sicherungskopie, nicht zum Ausfüllen). */
export function downloadBackup(db: DB) {
  const data = Object.fromEntries(COLLECTIONS.filter((c) => c !== 'market').map((c) => [c, db[c]]))
  const blob = new Blob([JSON.stringify({ kind: BACKUP_KIND, version: 1, exportedAt: new Date().toISOString(), data }, null, 1)], { type: 'application/json' })
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `depot-sicherung-${today()}.json` })
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
