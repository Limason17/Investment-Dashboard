import type { TxType } from './types'

export const TX_LABEL: Record<TxType, string> = { kauf: 'Kauf', verkauf: 'Verkauf', einzahlung: 'Einzahlung', auszahlung: 'Auszahlung', gebuehr: 'Gebühr', korrektur: 'Cash-Stand' }
