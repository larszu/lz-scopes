# Online stellen (Sichtbarkeit, Pages, erster Release)

Stand: 29.09.2026. Das Repo ist **privat**, Pages ist **nicht aktiviert**. Nichts davon ist automatisch passiert; die Schritte unten macht Lars selbst.

## Prüfung der Historie (vor dem Veröffentlichen)

Geprüft: alle Commits aller Branches (`git log -p --all`) auf Passwörter, Tokens, Schlüssel, private und interne IPs, Pfade, Kontaktdaten und Anlagendaten; zusätzlich Dateibestand, Issues und `docs/research`.

Ergebnis: **keine Geheimnisse, keine Zugangsdaten, keine privaten IPs, keine Anlagendaten.**

| Fund | Bewertung |
|---|---|
| `rtsp://10.0.0.5:554/stream1` in `test/`, `rtsp://user:pass@host:554/stream` als Platzhalter in der UI | Beispieladressen, unkritisch |
| `127.0.0.1` als Bridge-Vorgabe | Loopback, unkritisch |
| `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` in Workflows, `CSC_KEY_PASSWORD` im Kommentar von `electron-builder.js` | nur Verweise auf Secrets, keine Werte |
| `/etc/passwd` in `test/` | Negativtest der Eingabeprüfung |
| Commit-Autor mit privater Mail-Adresse in den ersten 14 Commits (seitdem GitHub-noreply) | **wird mit der Sichtbarkeit öffentlich.** Entscheidung offen: so lassen, oder vorher die Historie mit einer GitHub-noreply-Adresse umschreiben (Force-Push, nur solange das Repo privat ist) |
| Alter Descriptor „Foto & Film" in einem Code-Kommentar (`src/patterns.ts`) | behoben |
| `docs/research/*.md`: Zusammenfassungen mit Links, kein längeres Fremdzitat; einzige wörtliche Stelle ist ein Halbsatz aus § 69e UrhG (Gesetzestext, gemeinfrei) | unkritisch |
| `docs/research/img/vma-audioanalyser.png`, `vma-audiogenerator.png`: Screenshots der Fremdsoftware VMA | **Urheberrecht Dritter, vor dem Veröffentlichen entfernen oder durch eigene Aufnahmen ersetzen** (eingebunden in `docs/research/audio.md`, Zeilen 15 und 37) |
| `docs/research/*.md` nennen Fragen „Welche Eingänge nutzt Lars wirklich?" und `docs/cable-planner-integration.md` den Abschnitt „Offen für Lars" | keine sensiblen Daten, lesen sich aber wie interne Notizen; vor dem Veröffentlichen prüfen, ob sie so stehen bleiben sollen |
| Fremdkomponenten | ffmpeg 9.0.2 (GPLv3, ohne nonfree, mit SRT; Builds und Quelltext-Pflichten in docs/research/ffmpeg-lizenz.md) in der Desktop-App, dockview MIT, MediaPipe und BlazeFace Apache-2.0: siehe [THIRD_PARTY.md](../THIRD_PARTY.md) |
| LZ-Displaytestbilder | eigenes Werk |

## Schritte

1. **Vorab entscheiden:** Commit-Autor-Mail (siehe Tabelle) und die beiden VMA-Screenshots. Beides ist nach dem Veröffentlichen nur noch mit Force-Push und Cache-Resten zu bereinigen.
2. **Sichtbarkeit:** Repo-Einstellungen, *Danger Zone*, *Change visibility*, *Public*. Oder: `gh repo edit larszu/lz-scopes --visibility public --accept-visibility-change-consequences`.
3. **Pages aktivieren:** Repo-Einstellungen, *Pages*, *Source*: **GitHub Actions**. Der `GITHUB_TOKEN` darf keine Pages-Site anlegen, deshalb geht das nur von Hand. Bis dahin läuft `pages.yml` grün durch, baut, und überspringt das Deploy mit einer Warnung.
4. **Pages auslösen:** Actions, *Deploy Web (GitHub Pages)*, *Run workflow* (oder ein Push auf `main`). Danach ist die Web-Fassung unter <https://larszu.github.io/lz-scopes/> erreichbar.
5. **Erster Release:** `git tag v0.1.0 && git push origin v0.1.0` auf `main`. `release.yml` baut Windows und macOS (Node 24, Version aus dem Tag) und hängt die Installer ans Release. Vorher lokal `npm run dist:mac` prüfen; der Windows-Build ist noch ungetestet (Issue #13).
6. **Nach dem Veröffentlichen:** Release-Dateinamen gegen die Tabelle in der README prüfen (`LZ Scopes-<version>-universal.dmg`, `-x64.exe`, `-portable.exe`), Badges und Download-Links testen.

## Kosten

Solange das Repo privat ist, kosten Actions-Minuten Geld (macOS-Läufe zählen zehnfach). Ist das Budget leer, startet kein Job. Öffentliche Repos sind kostenfrei; das ist ein Grund, Schritt 2 vor dem ersten Release zu machen.
