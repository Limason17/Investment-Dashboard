# Depot

Depot-Dashboard (USD) für Positionen, Dividenden, Limits und Plan. Es platziert nie Orders.

Zwei Varianten aus demselben Code:

| Variante | Daten | Kurse | Start |
|---|---|---|---|
| Lokal | `data/*.json` in diesem Ordner | lokaler Server | `npm run dev` |
| Online (PWA) | Firebase, ein Konto je Person | Cloudflare Worker (`worker/`) | <https://limason17.github.io/Investment-Dashboard/> |

Online einrichten: [docs/einrichten.md](docs/einrichten.md). Jeder Push auf `main` veröffentlicht die Online-Version.

## Starten

| Was | Doppelklick | Befehl | Adresse |
|---|---|---|---|
| Dashboard mit den echten Daten | `Dashboard starten.cmd` | `npm run dev` | http://localhost:5173 |
| Vorschau mit Testdaten | `Vorschau mit Testdaten.cmd` | `npm run demo` | http://localhost:5175 |

Beide können gleichzeitig laufen. Die Vorschau zeigt das volle Dashboard mit Kursverlauf, Rendite,
Allokation und Tagesbewegung; alles Erfundene trägt dort die Marke «Test».

## Daten

- `data/` enthält die echten Daten, eine JSON-Datei je Sammlung (`positions`, `transactions`,
  `dividends`, `watchlist`, `pots`, `events`, `log`, `prices`, `snapshots`, `history`, `meta`, `market`).
  Einträge im Dashboard (Kauf, Verkauf, Dividende, Cash, Notiz) werden direkt dorthin geschrieben.
  Ändert ein anderes Programm eine dieser Dateien, lädt die Seite von selbst neu.
- `data-demo/` enthält die Testdaten der Vorschau. `npm run seed` schreibt sie neu. Dieses Skript
  fasst `data/` nie an.
- `import-backups/` enthält die Sicherungen des Schwab-Imports vom 10.11.2026.
- `vorlage/` enthält die Dateien der früheren Version (Stand 22.10.2026) und die alte Kurs-Routine.

Damit Gesamtwert, Tagesänderung, Rendite und Allokation erscheinen, braucht `data/`:

- `prices.json`: je Titel `{ "close": 123.45, "prev": 122.10, "date": "2026-11-09" }`,
  optional `divAnnual` und `divFreq` für die Dividendenprognose
- `snapshots.json`: je Tag `{ "date", "total", "securities", "cash", "invested" }` für den Wertverlauf
- `history.json`: `{ "dates": [...], "series": { "VTI": [...] } }` für die Kursverläufe je Titel
- in `meta.json` den Cash-Stand (`cash`) und `cashExcluded: false`

## Live-Kurse

Das Dashboard holt die Kurse aller gehaltenen Titel und der Watchlist selbst, solange die Seite offen ist:
während einer Sitzung alle 20 Sekunden, sonst alle 5 Minuten. Wert, Tagesänderung, Gewinn/Verlust,
Allokation und Watchlist-Abstände rechnen mit dem neuesten Kurs.

| Sitzung (New York / Zürich, Winterzeit) | Quelle | Schlüssel |
|---|---|---|
| Pre-Market 04:00–09:30 / 10:00–15:30 | Yahoo Finance | keiner |
| Regulär 09:30–16:00 / 15:30–22:00 | Yahoo Finance | keiner |
| After-Hours 16:00–20:00 / 22:00–02:00 | Yahoo Finance | keiner |
| Overnight 20:00–04:00 / 02:00–10:00, So–Do | Alpaca (Mittelkurs aus Geld/Brief) | Gratis-Schlüssel in `.env.local` |

- Tagesänderung = neuester Kurs gegen den letzten Schlusskurs; die Overnight-Sitzung zählt wie bei Schwab
  zum nächsten Handelstag.
- Ohne Alpaca-Schlüssel zeigt die Nacht den letzten After-Hours-Kurs. Einrichten: `.env.local.example`
  in `.env.local` umbenennen, Schlüssel eintragen, Dashboard neu starten.
- Nach Börsenschluss schreibt der Server einmal am Tag die Schlusskurse in `data/prices.json` und den
  Depotwert in `data/snapshots.json`. So entstehen Wertverlauf und Rendite. Die Testdaten-Vorschau
  zeigt Live-Kurse, schreibt aber nichts fest.
- Code: `server/live-quotes.ts` (Abfrage, `/api/live`), `withLive` in `src/lib/calc.ts`.
- Yahoo ist eine inoffizielle Schnittstelle: Sie kann sich ohne Ankündigung ändern. Fällt sie aus,
  gelten die gespeicherten Schlusskurse.

## Mehrere Portfolios

Auswahl oben links (Handy: über dem Titel). Jedes Portfolio hat eigene Positionen, Buchungen, Cash, Plan und Watchlist.

- «Portfolios verwalten»: anlegen, umbenennen, sortieren, löschen. Das Hauptportfolio bleibt immer.
- «Alle Portfolios (Gesamt)» zählt alles zusammen: Positionen je Ticker addiert, Cash summiert. Dort lässt sich nichts ändern.
- Lokal: das Hauptportfolio liegt in `data/`, weitere in `data/p/{id}/`, die Liste in `data/portfolios.json`.
- Online: `depots/{uid}` (Liste), `depots/{uid}/data` (Hauptportfolio), `depots/{uid}/portfolios/{id}/data` (weitere).
- Code: `src/lib/portfolios.ts` (Liste, Gesamtansicht), `src/features/Portfolios.tsx` (Auswahl, Verwaltung).

## Positionen hochladen

Unten links «Konto» (lokal «Daten hochladen und sichern»), oder der Knopf «Hochladen» bei Positionen und Dividenden.

1. Vorlage herunterladen: CSV mit Erklärung und zwei Beispielen als Kommentar (`#`, wird nie übernommen).
2. In Excel ausfüllen: eine Zeile je Kauf mit Datum. Das Datum braucht es für Wertverlauf und Charts.
3. Ausgefüllte Vorlage hochladen, Vorschau prüfen, «Übernehmen».

- Arten: Käufe/Verkäufe, Dividenden, Nur Bestand (ohne Datum, darum ohne Verlauf).
- Die «Sicherungskopie» (JSON) ist davon getrennt: zum Aufbewahren und Wiederherstellen, nicht zum Ausfüllen.
- Die Vorschau zeigt neue Einträge, Änderungen, schon vorhandene Einträge und Fehler je Zeile.
  Mit Fehlern übernimmt der Import nichts.
- Den Schwab-Export «Transaction History» (CSV) erkennt der Import selbst.
- Code: `src/lib/bulk.ts` (lesen), `src/lib/bulk-plan.ts` (Änderungen planen), `src/features/ImportForm.tsx`.

## Bedienung

- `Ctrl K` öffnet die Schnellsuche (Ansichten, Titel, Aktionen), `1` bis `6` wechseln die Ansicht,
  `N` öffnet einen neuen Eintrag, `R` holt Kurse und Daten neu (auch der Knopf «Aktualisieren» oben).
- Ein Klick auf eine Position oder einen Watchlist-Titel öffnet das Detailblatt mit Kursverlauf.
- In den Charts liest die Maus oder die Pfeiltaste Tag für Tag ab.

## Aufbau

- `src/views/` die sechs Ansichten, `src/features/` Eingabe- und Detailblätter und die Schnellsuche
- `src/components/charts/` die Charts (eigene SVG-Charts auf d3-scale und d3-shape)
- `src/lib/calc.ts` alle Kennzahlen: Bewertung, Allokation, Watchlist-Status, zeitgewichtete Rendite
- `server/depot-api.ts` die lokale Datenschnittstelle (`/api/db`, `/api/history`, `/api/batch`)
- `src/lib/cloud.ts` Konten und Daten der Online-Version (Firebase), `src/lib/config.ts` ihre Einstellungen
- `worker/` der Kurs-Dienst der Online-Version, `firestore.rules` die Zugriffsregeln
- `scripts/seed-demo.mjs` erzeugt die Testdaten

Prüfen: `npx tsc -b` und `npm run lint`. Stack: Vite, React, TypeScript, Tailwind, Motion, Radix, cmdk, Firebase, vite-plugin-pwa.
