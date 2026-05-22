# SMART APP & Landingpage Builder

Lokale Browser-App zum Erstellen von zehn hochwertigen Landingpages aus Vorlage, Inhaltsquelle und optionalem App-Screenshot.

## Start für Nutzer

macOS:

1. Im Projektordner `SMART APP & Landingpage Builder.app` doppelklicken.
2. Die App startet den lokalen Node-Server im Hintergrund.
3. Der Browser öffnet automatisch `http://127.0.0.1:8173/`.

Windows:

1. `SMART APP & Landingpage Builder starten.vbs` doppelklicken.
2. Der lokale Server startet ohne dauerhaft sichtbares Konsolenfenster.
3. Der Browser öffnet automatisch `http://127.0.0.1:8173/`.

Technischer Start:

```bash
npm start
```

## Wichtiger Hinweis zu GitHub Pages

GitHub Pages kann nur die statische Oberfläche anzeigen. KI-Anfragen, URL-Auslesen und Anthropic-Verbindung brauchen weiterhin den lokalen Proxy unter `http://127.0.0.1:8173/api/...`.

Wenn die App über GitHub Pages oder als Datei geöffnet wird, erkennt das Frontend dies automatisch und sendet API-Anfragen an den lokalen Proxy auf `127.0.0.1:8173`.

## Struktur

- Browser-Frontend in `public/`
- Lokaler Node-Proxy in `server.js`
- macOS-Launcher: `SMART APP & Landingpage Builder.app`
- Windows-Launcher: `SMART APP & Landingpage Builder starten.vbs`
- Logs: `logs/landingpage-builder-server.log`

Die `.app` bitte nicht allein aus dem Projektordner heraus verschieben, weil sie die Projektdateien daneben benötigt. Sie kann aber aus dem Projektordner heraus ins Dock gezogen werden.
