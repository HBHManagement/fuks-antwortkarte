# fuks e.V. – Antwortkarte

Webseite im fuks-Design (Montserrat, Schwarz/Weiß, Akzent `#EB5E28`, Logo als Original-Vektor).
Unternehmen, die den fuks-Brief bekommen haben, fotografieren die ausgefüllte Antwortkarte ab
und senden sie über die Seite direkt an fuks – kein Brief, kein Porto.

## Aufbau

```
public/index.html    Seite: Argumente ("Noch nicht überzeugt?") + Antwortkarten-Upload
public/styles.css    Design nach fuks.org (Kantenradius 0, orange Abschnittstitel)
public/app.js        Kamera/Foto, Verkleinern im Browser, Upload
public/assets/       fuks-Logo + Fuchskopf (Original-SVG von fuks.org)
server.js            Express: statische Seite, Upload-Endpoint, interne Übersicht
Dockerfile           Deploy auf Coolify (Node 22, Port 3000, Volume /data)
```

## Ablauf für den Absender

1. Karte ausfüllen (von Hand, wie gedruckt).
2. Auf der Seite „Foto aufnehmen" – öffnet die Kamera des Telefons.
   Ohne HTTPS fällt der Knopf automatisch auf die Fotoauswahl des Systems zurück.
3. Firma eintragen, senden. Das Bild wird im Browser auf max. 2200 px verkleinert.

## Nicht in Suchmaschinen

Die Seite ist nur über den Link im Brief erreichbar und soll nirgends auftauchen:

- `public/robots.txt` – `Disallow: /` für alle Crawler (inkl. GPTBot, ClaudeBot, CCBot, archive.org)
- `<meta name="robots">` und `googlebot` im Kopf der Seite
- HTTP-Header `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex`
  (gesetzt in `server.js`, gilt für jede Antwort)
- `Referrer-Policy: no-referrer`, damit die Adresse nicht über Fremdaufrufe (z. B. Google Fonts) weitergegeben wird

## Umgebungsvariablen
| Variable | Standard | Zweck |
|---|---|---|
| `PORT` | 3000 (Docker) / 8090 (lokal) | HTTP-Port |
| `UPLOAD_DIR` | `./data/antwortkarten` | Ablage der Fotos (`index.jsonl` liegt daneben) |
| `ADMIN_TOKEN` | – | ohne Wert ist `/intern` abgeschaltet |
| `MAX_MB` | 20 | maximale Bildgröße |
| `MAIL_TO` | `kontakt@fuks.org` | Empfänger des Weiterleitens |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | – | ohne `SMTP_HOST` wird nicht gemailt, die Fotos liegen nur in `UPLOAD_DIR` |

## Endpunkte

- `POST /api/antwortkarte` – Formularfelder `foto` (Datei), `firma` (Pflicht), `name`, `email`
- `GET /api/health` – Lebenszeichen
- `GET /intern?token=…` – Liste der eingegangenen Karten (nur mit `ADMIN_TOKEN`)
- `GET /uploads/<datei>` – die abgelegten Fotos

## Deploy auf Coolify

- Repo: `https://github.com/HBHManagement/fuks-antwortkarte` (öffentlich)
- Coolify: Projekt `fuks e.V.`, Build-Pack **Dockerfile**, Port **3000**,
  Domain `https://fuks.holmebengt.com`, persistentes Volume auf **`/data`**.

Ohne Volume sind die Fotos nach einem Redeploy weg.

## Lokal starten

```bash
npm install
PORT=8090 UPLOAD_DIR=./data/antwortkarten ADMIN_TOKEN=probe npm start
```
