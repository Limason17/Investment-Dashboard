import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** «view»: nur eine Ansicht ist betroffen, Navigation und Konto bleiben bedienbar */
  scope?: 'view' | 'app'
}

/** Fängt Fehler beim Anzeigen ab, damit die App nicht leer wird. */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error) {
    console.error('Anzeigefehler:', error)
  }
  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const view = this.props.scope === 'view'
    return (
      <div role="alert" className={view ? 'card mx-auto max-w-xl p-6 text-center' : 'grid min-h-dvh place-items-center px-6 text-center'}>
        <div>
          <p className="text-[15px] font-semibold">{view ? 'Diese Ansicht lässt sich nicht anzeigen.' : 'Das Dashboard lässt sich nicht anzeigen.'}</p>
          <p className="mx-auto mt-2 max-w-sm text-[13px] text-ink-2">
            Wahrscheinlich ist ein Eintrag beschädigt. Deine Daten sind nicht verloren.{view ? ' Die anderen Ansichten und das Konto-Menü funktionieren weiter.' : ''}
          </p>
          <p className="mx-auto mt-2 max-w-sm break-words font-mono text-[11.5px] text-faint">{error.message}</p>
          <div className="mt-4 flex justify-center gap-2">
            {view && <button type="button" className="btn" onClick={() => this.setState({ error: null })}>Erneut versuchen</button>}
            <button type="button" className="btn btn-primary" onClick={() => location.reload()}>Seite neu laden</button>
          </div>
        </div>
      </div>
    )
  }
}
