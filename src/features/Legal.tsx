/**
 * Rechtliche Texte: Datenschutzerklärung und Nutzungsbedingungen.
 * Stand und Betreiber stehen in config.ts (OPERATOR, LEGAL_VERSION).
 */
import type { ReactNode } from 'react'
import { Sheet } from '@/components/Sheet'
import { LEGAL_VERSION, OPERATOR } from '@/lib/config'

export type LegalDoc = 'datenschutz' | 'nutzung'

const H = ({ children }: { children: ReactNode }) => <h3 className="mt-5 text-[13.5px] font-semibold text-ink first:mt-0">{children}</h3>
const P = ({ children }: { children: ReactNode }) => <p className="mt-1.5 text-[12.5px] leading-[1.6] text-ink-2">{children}</p>
const L = ({ items }: { items: ReactNode[] }) => <ul className="mt-1.5 grid list-disc gap-1 pl-5 text-[12.5px] leading-[1.55] text-ink-2">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>

const contact = OPERATOR.email ? <a className="underline underline-offset-4" href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a> : 'über die Angaben im Bereich «Betreiber»'

function Privacy() {
  return (
    <div>
      <H>Betreiber und Verantwortlicher</H>
      <P>{OPERATOR.name}, {OPERATOR.place}. Kontakt für Datenschutzfragen: {contact}.</P>

      <H>Welche Daten verarbeitet werden</H>
      <L items={[
        <><b>Konto:</b> E-Mail-Adresse, Name (freiwillig), verschlüsseltes Passwort (verwaltet Firebase; der Betreiber sieht es nie).</>,
        <><b>Depotdaten:</b> was du erfasst oder hochlädst, z. B. Positionen, Käufe, Verkäufe, Dividenden, Cash, Plan, Watchlist, Termine und Notizen.</>,
        <><b>Kursabfragen:</b> die Ticker deiner Positionen und deiner Watchlist, damit Kurse geladen werden können. Dabei wird deine IP-Adresse technisch übermittelt.</>,
        <><b>Auf deinem Gerät:</b> Anmeldung, gewähltes Portfolio und Einstellungen der Ansicht (lokaler Speicher). Es gibt keine Werbe- oder Analyse-Cookies und kein Tracking.</>,
      ]} />

      <H>Zweck</H>
      <P>Die Daten dienen nur dazu, dir dein Depot anzuzeigen und auszuwerten. Sie werden nicht verkauft, nicht für Werbung genutzt und nicht an Dritte weitergegeben, ausser an die unten genannten Dienstleister, die für den Betrieb nötig sind.</P>

      <H>Dienstleister</H>
      <L items={[
        <><b>Google Firebase</b> (Google Ireland Ltd. / Google LLC): Anmeldung und Speicherung der Depotdaten. Speicherort der Datenbank: Europa (eur3).</>,
        <><b>Cloudflare</b> (Cloudflare, Inc.): Kurs-Dienst, der Kursanfragen an Yahoo Finance weiterleitet. Er speichert keine Depotdaten und kennt kein Konto.</>,
        <><b>Yahoo Finance</b>: Quelle der Kurse und Kursverläufe (inoffizielle Schnittstelle). Yahoo erhält nur die Ticker, nicht deine Daten.</>,
        <><b>GitHub Pages</b> (GitHub, Inc.): Auslieferung der App. GitHub kann dabei technische Zugriffsdaten wie die IP-Adresse protokollieren.</>,
      ]} />
      <P>Einige Dienstleister haben ihren Sitz in den USA. Die Übermittlung stützt sich auf deren Standardvertragsklauseln bzw. Zertifizierung (EU-US und Swiss-US Data Privacy Framework).</P>

      <H>Speicherdauer</H>
      <P>Deine Daten bleiben gespeichert, bis du sie löschst. Unter «Konto → Konto löschen» löschst du dein Konto mit allen Portfolios endgültig.</P>

      <H>Deine Rechte</H>
      <P>Du kannst Auskunft, Berichtigung und Löschung verlangen. Eine Kopie aller Daten lädst du jederzeit unter «Konto → Sicherungskopie herunterladen» herunter. Für Fragen wende dich an {contact}. Du kannst dich zudem bei der zuständigen Aufsichtsbehörde beschweren (Schweiz: EDÖB; EU: Datenschutzbehörde deines Landes).</P>

      <H>Sicherheit</H>
      <P>Die Verbindung ist verschlüsselt (HTTPS). Zugriffsregeln der Datenbank erlauben nur dem eigenen Konto Zugriff auf seine Daten. Der Kurs-Dienst nimmt nur Anfragen dieser App an.</P>

      <p className="mt-5 text-[11.5px] text-muted">Stand: {LEGAL_VERSION}. Grundlage: Schweizer Datenschutzgesetz (DSG) und, soweit anwendbar, EU-Datenschutz-Grundverordnung (DSGVO).</p>
    </div>
  )
}

function Terms() {
  return (
    <div>
      <H>Was die App ist</H>
      <P>Depot ist ein Werkzeug, um ein eigenes Wertschriften-Depot zu erfassen und auszuwerten. Die App platziert keine Aufträge, verwahrt kein Geld und ist mit keinem Broker verbunden.</P>

      <H>Keine Anlageberatung</H>
      <P>Inhalte, Kennzahlen, Ziele, Limits und Hinweise sind keine Anlageberatung, keine Empfehlung und kein Angebot zum Kauf oder Verkauf von Finanzinstrumenten. Entscheide triffst du selbst und auf eigenes Risiko.</P>

      <H>Kurse und Berechnungen ohne Gewähr</H>
      <P>Kurse stammen von Yahoo Finance über eine inoffizielle Schnittstelle und können verzögert, unvollständig oder falsch sein. Wertverlauf, Rendite und Steuern sind Näherungen aus deinen Eingaben. Massgebend sind allein die Abrechnungen und Auszüge deines Brokers.</P>

      <H>Dein Konto</H>
      <L items={[
        'Halte dein Passwort geheim. Du bist für Eingaben in deinem Konto verantwortlich.',
        'Erfasse nur eigene Daten und keine Daten Dritter ohne deren Einverständnis.',
        'Missbrauch, z. B. automatisierte Massenabfragen über den Kurs-Dienst, ist nicht erlaubt.',
      ]} />

      <H>Verfügbarkeit und Haftung</H>
      <P>Die App wird kostenlos und ohne Gewähr für ständige Verfügbarkeit angeboten. Funktionen können sich ändern oder eingestellt werden. Lade regelmässig eine Sicherungskopie herunter. Soweit gesetzlich zulässig, ist jede Haftung für Schäden aus der Nutzung ausgeschlossen, insbesondere für Anlageentscheide und Datenverlust.</P>

      <H>Kündigung</H>
      <P>Du kannst dein Konto jederzeit unter «Konto → Konto löschen» löschen. Bei Missbrauch kann der Betreiber ein Konto sperren.</P>

      <H>Recht und Gerichtsstand</H>
      <P>Es gilt Schweizer Recht. Zwingende Verbraucherschutzvorschriften deines Wohnsitzlandes bleiben vorbehalten.</P>

      <p className="mt-5 text-[11.5px] text-muted">Betreiber: {OPERATOR.name}, {OPERATOR.place}. Stand: {LEGAL_VERSION}.</p>
    </div>
  )
}

export function LegalSheet({ doc, onClose }: { doc: LegalDoc | null; onClose: () => void }) {
  return (
    <Sheet open={!!doc} onClose={onClose} title={doc === 'nutzung' ? 'Nutzungsbedingungen' : 'Datenschutzerklärung'} sub={`Stand ${LEGAL_VERSION}`}>
      {doc === 'nutzung' ? <Terms /> : <Privacy />}
    </Sheet>
  )
}

/** Kleine Links «Datenschutz · Nutzungsbedingungen» */
export function LegalLinks({ onOpen, className }: { onOpen: (d: LegalDoc) => void; className?: string }) {
  const a = 'underline decoration-line-2 underline-offset-4 hover:text-ink'
  return (
    <span className={className}>
      <button type="button" className={a} onClick={() => onOpen('datenschutz')}>Datenschutz</button>
      <span className="px-1.5 text-faint">·</span>
      <button type="button" className={a} onClick={() => onOpen('nutzung')}>Nutzungsbedingungen</button>
    </span>
  )
}
