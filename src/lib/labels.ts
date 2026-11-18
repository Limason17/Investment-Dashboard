import type { TxType } from './types'

export const TX_LABEL: Record<TxType, string> = { kauf: 'Kauf', verkauf: 'Verkauf', einzahlung: 'Einzahlung', auszahlung: 'Auszahlung', gebuehr: 'Gebühr', korrektur: 'Cash-Stand' }
/** Bezeichnung einer Buchung. Eine Korrektur mit Titel ändert den Bestand (z. B. Split), nicht das Cash. */
export const txLabel = (x: { type: TxType; ticker?: string | null }) => (x.type === 'korrektur' && x.ticker ? 'Bestand' : (TX_LABEL[x.type] ?? x.type))
