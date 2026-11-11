# Online-Version einrichten

Die Online-Version läuft gratis auf GitHub Pages. Konten und Daten liegen in Firebase (Tarif «Spark»,
keine Kreditkarte). Die Kurse holt ein Cloudflare Worker (Gratis-Tarif). Dauer: etwa 20 Minuten.

Die lokale Version (`npm run dev`, Daten in `data/`) bleibt unverändert.

## 1. Firebase-Projekt anlegen

1. Öffne <https://console.firebase.google.com> und melde dich mit deinem Google-Konto an.
2. Klicke **Projekt erstellen**. Name: `investment-dashboard`. Schalte Google Analytics aus.
3. Links **Build → Authentication → Jetzt starten**.
4. Reiter **Sign-in method → E-Mail/Passwort**: den ersten Schalter aktivieren, speichern.
5. Reiter **Einstellungen → Autorisierte Domains → Domain hinzufügen**: `limason17.github.io`.
6. Optional: Reiter **Vorlagen**, Sprache **Deutsch** (Mails zum Bestätigen und Zurücksetzen).

## 2. Datenbank anlegen

1. Links **Build → Firestore Database → Datenbank erstellen**.
2. Edition Standard, Standort **eur3 (Europa)**, **Im Produktionsmodus starten**.
3. Reiter **Regeln**: alles löschen, den Inhalt von [`firestore.rules`](../firestore.rules) einfügen, **Veröffentlichen**.

Die Regeln sorgen dafür, dass jedes Konto nur seine eigenen Daten lesen und ändern kann.

## 3. Web-App registrieren

1. Zahnrad → **Projekteinstellungen** → unten bei «Meine Apps» das Symbol **`</>`**.
2. Name `Depot`, Hosting **nicht** ankreuzen, **App registrieren**.
3. Kopiere den Block `const firebaseConfig = { … }` und trage die Werte in
   [`src/lib/config.ts`](../src/lib/config.ts) bei `PROJECT_CONFIG` ein.

Diese Werte sind kein Geheimnis: Jede Web-App liefert sie an den Browser aus.

## 4. Kurs-Dienst (Cloudflare Worker)

1. Erstelle ein Gratis-Konto auf <https://dash.cloudflare.com/sign-up>.
2. Im Ordner `worker/`:

   ```bash
   npx wrangler login
   ```

   ```bash
   npx wrangler deploy
   ```

3. Wrangler zeigt die Adresse, z. B. `https://depot-kurse.<name>.workers.dev`.
   Trage sie in [`src/lib/config.ts`](../src/lib/config.ts) bei `QUOTES` ein.
4. Optional, für Overnight-Kurse: `npx wrangler secret put ALPACA_KEY_ID` und
   `npx wrangler secret put ALPACA_SECRET_KEY`.

Der Worker speichert nichts und kennt keine Konten. Er nimmt nur Anfragen von
`limason17.github.io` und `localhost` an.

## 5. GitHub Pages einschalten

1. Repo auf GitHub → **Settings → Pages → Source: GitHub Actions**.
2. Jeder Push auf `main` baut und veröffentlicht die Seite:
   <https://limason17.github.io/Investment-Dashboard/>

## 6. Deine Daten übernehmen

1. Lokal (`npm run dev`): unten links **Daten hochladen und sichern → Sicherungskopie herunterladen**.
2. Online: registrieren, dann **Konto → Sicherungskopie → Wiederherstellen**, die Datei wählen, **Alle Daten ersetzen**.

Ohne lokale Version: **Konto → Bestehende Positionen hochladen**. Vorlage herunterladen, in Excel ausfüllen (eine Zeile je Kauf mit Datum), hochladen, Vorschau prüfen, übernehmen.

## Als App installieren

- iPhone/iPad: Seite in Safari öffnen → Teilen → **Zum Home-Bildschirm**.
- Android/Chrome/Edge: Menü → **App installieren**.

## Kostenlos bleiben

Spark erlaubt pro Tag 50 000 Lese- und 20 000 Schreibzugriffe. Das Dashboard braucht pro Person und
Tag grob 20 Lese- und 30 Schreibzugriffe. Der Cloudflare-Gratis-Tarif erlaubt 100 000 Anfragen pro Tag.

## Lokal mit Emulatoren testen

1. `.env.cloud.local` anlegen:

   ```
   VITE_FIREBASE_CONFIG={"apiKey":"demo-key","authDomain":"demo-depot.firebaseapp.com","projectId":"demo-depot","appId":"demo"}
   VITE_FIREBASE_EMULATOR=127.0.0.1
   VITE_QUOTES_URL=http://localhost:8787
   ```

2. `npx firebase-tools emulators:start --only auth,firestore --project demo-depot`
3. `cd worker && npx wrangler dev`
4. `npm run dev:cloud` → <http://localhost:5177>
