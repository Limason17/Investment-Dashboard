import type { ImportKind } from './bulk'
import { createContext, useContext } from 'react'
import type { Calc } from './calc'
import type { DB, ViewId } from './types'

export type EntryType = 'kauf' | 'verkauf' | 'dividende' | 'einzahlung' | 'notiz' | 'import'

export interface Nav {
  view: ViewId
  goto: (v: ViewId) => void
  openPosition: (t: string) => void
  openWatch: (t: string) => void
  openEntry: (type?: EntryType, opt?: { fromId?: string; ticker?: string; kind?: ImportKind; text?: string }) => void
}
export const NavContext = createContext<Nav>(null!)
export const useNav = () => useContext(NavContext)

export interface Depot {
  db: DB
  c: Calc
  /** heutiges Datum, JJJJ-MM-TT */
  now: string
}
export const DepotContext = createContext<Depot>(null!)
export const useDepot = () => useContext(DepotContext)
