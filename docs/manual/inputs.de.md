# Eingänge: Resolve, Fenster, Ordner, Capture-Karten

So kommt ein Bild in LZ Scopes. Alle Eingänge stehen links in der Seitenleiste unter **Quellen**. Neue Quellen fügst du mit **+ Quelle** hinzu. In jeder Quellenkarte stellst du ein, wie das Bild gemessen wird: Transfer, Matrix, Gamut, CST/LUT.

| Eingang | Bittiefe | Wann |
|---|---|---|
| DaVinci Resolve (Scripting) | 16 bit (Pause), 8 bit (Wiedergabe) | gegradetes Bild aus dem Resolve-Viewer, ohne zusätzliche Hardware |
| Clean Feed über Capture-Karte | 10 bit | Resolve gibt über eine DeckLink/UltraStudio aus, LZ Scopes nimmt über eine Karte auf |
| Clean Feed oder Fenster per Bildschirm-Capture | 8 bit | schnell, ohne Hardware; der Bildschirm verfälscht Farben und Pegel |
| Ordner | 8 bit (Browser), 16 bit (Bridge) | Standbilder aus Lightroom, Capture One, Resolve |
| Capture-Karte, DeckLink, NDI® | 8–16 bit | Kameras, Mischer, Kreuzschienen |

## DaVinci Resolve

LZ Scopes holt das aktuelle Bild aus dem Resolve-Viewer über die Scripting-API von Resolve. Das Bild ist gegradet und hat 16 bit. Gemessen werden etwa 7 Bilder pro Sekunde. Die Bridge holt das Bild dazu als TIFF-Standbild aus Resolve.

**Voraussetzungen**

- DaVinci Resolve **Studio**.
- In Resolve: **Einstellungen → System → Allgemein → Externes Scripting: Lokal**.
- Python 3 auf dem Rechner (macOS: über die Xcode Command Line Tools).
- LZ Scopes läuft als Desktop-App oder mit `npm start` auf demselben Rechner wie Resolve.

**Verbinden**

Läuft Resolve, erscheint es von selbst in der Seitenleiste mit Projekt und Timeline. Ein Klick auf **Verbinden** legt die Quelle *DaVinci Resolve* an.

![Resolve läuft – Verbinden (Beispielanzeige)](img/resolve-live.png)

Ist das externe Scripting aus, steht in der Seitenleiste, wo man es einschaltet. Einen Verbinden-Knopf gibt es dann nicht.

![Resolve läuft, externes Scripting aus (Beispielanzeige)](img/resolve-off.png)

Alternativ: **+ Quelle → DaVinci Resolve**.

**Resolve auf einem anderen Rechner**

1. Auf dem Resolve-Rechner die Bridge starten, mit `npm start -- --host 0.0.0.0` oder als Desktop-App mit `LZS_HOST=0.0.0.0`.
2. In LZ Scopes unter **Einstellungen → Bridge / ffmpeg → Adresse** diesen Rechner eintragen, z. B. `http://<rechner>:4192`.
3. Die Seitenleiste zeigt dann das Resolve dieses Rechners.

Einen eigenen Netzwerk-Scan gibt es nicht. Resolve legt das Standbild auf der Platte des Resolve-Rechners ab, deshalb muss dort die Bridge laufen.

**Gut zu wissen**

- Gemessen wird, was der Viewer zeigt, also das Bild an der aktuellen Abspielposition mit Grading.
- Der Timecode der Timeline wird mitgeliefert.

**Wiedergabe**

Während die Timeline läuft, beantwortet Resolve keine Scripting-Anfrage. Standbilder kommen erst in der Pause wieder. LZ Scopes schaltet deshalb selbst um. Die Quellenkarte zeigt, welcher Weg aktiv ist und warum:

| Weg | Wann | Farbgenauigkeit |
|---|---|---|
| **Exaktes Standbild** | Timeline pausiert | 16 bit, gegradet, so wie Resolve es rechnet. Farbgenau. |
| **Live: Fensteraufnahme** | Timeline läuft, LZ Scopes auf dem Resolve-Rechner | 8 bit, auf die Viewer-Größe skaliert, nach dem Farbmanagement von Viewer und Betriebssystem (z. B. *Use Mac Display Color Profile for viewers*). Zeigt Bewegung und grobe Pegel, nicht für Farburteile. |
| **Letztes Standbild gehalten** | Timeline läuft, keine Fensteraufnahme möglich | die Karte nennt den Grund, z. B. Bridge auf einem anderen Rechner |

- Die Umschaltung auf die Fensteraufnahme dauert nach dem Start der Wiedergabe etwa eine Sekunde. Die Pause bringt das exakte Standbild zurück.
- Die **Desktop-App** nimmt das Resolve-Fenster selbst auf und findet den Viewer darin über den Vergleich mit dem letzten Standbild. Unter macOS braucht sie dafür die Freigabe unter **Systemeinstellungen → Datenschutz & Sicherheit → Bildschirm- & Systemaudioaufnahme**.
- Im **Browser** einmal in der Quellenkarte auf **Resolve-Fenster wählen** klicken und das Resolve-Fenster auswählen.
- Wird der Viewer nicht gefunden (Viewer ausgeblendet, sehr klein oder Layout geändert), pausieren und neu abspielen.
- Für ein exaktes Livebild während der Wiedergabe den Clean Feed über eine Capture-Karte nutzen (nächster Abschnitt).

## Clean Feed

Resolve kann das Viewer-Bild ohne Bedienoberfläche ausgeben: **Arbeitsbereich → Video Clean Feed** auf einen zweiten Bildschirm. Mit Blackmagic Desktop Video geht es auch über eine DeckLink- oder UltraStudio-Karte.

- **Über eine Capture-Karte (empfohlen):** Den Ausgang auf eine Capture-Karte führen, im selben oder einem anderen Rechner. In LZ Scopes eine Quelle **RTSP / Netz** anlegen und **Gerät…** oder **DeckLink…** wählen (siehe *Capture-Karten*). So bleiben 10 bit erhalten, und kein Bildschirm-Farbmanagement ist dazwischen.
- **Über Bildschirm-Capture:** **+ Quelle → Bildschirm/Fenster** und den Clean-Feed-Bildschirm wählen. Das ist schnell eingerichtet, misst aber nur 8 bit. Außerdem rechnet das Betriebssystem das Bild in den Bildschirmfarbraum um. Für eine Farbbeurteilung ist dieser Weg nicht geeignet.

## Fenster mit Zuschnitt (Resolve, Lightroom, Capture One)

1. **+ Quelle → Bildschirm/Fenster**. In der Desktop-App erscheint eine Liste aller Fenster mit Vorschaubildern, im Browser der Auswahldialog des Browsers.
2. Das Programmfenster wählen.
3. Im Panel *Bild* einen Rahmen um den Viewer ziehen.
4. In der Quellenkarte auf **✂ Zuschnitt = Rahmen** klicken. Ab jetzt wird nur noch der Viewer gemessen. **Zuschnitt aus** hebt das wieder auf.

Wie beim Bildschirm-Capture gilt: 8 bit, und Fensterinhalte durchlaufen das Farbmanagement des Systems. Der Weg eignet sich für Bildkomposition, Belichtung und grobe Pegel, nicht für Farbabnahmen.

## Ordner (Lightroom, Capture One, Resolve-Standbilder)

Gezeigt wird immer das **neueste Bild** in einem Ordner. Wer ein neues Bild exportiert, sieht es sofort in den Scopes.

- **+ Quelle → Ordner** (im Browser): JPG, PNG, WebP oder AVIF, 8 bit. Braucht Chrome, Edge oder die Desktop-App.
- **Ordner… in einer Stream-Karte** (Bridge): TIFF 16 bit, DPX, PNG 16 bit, JPEG, WebP und EXR in voller Tiefe, auch auf einem anderen Rechner. In der Desktop-App öffnet sich ein Ordnerdialog. Mit `npm start` gibst du den Ordner beim Start frei: `--watch-dir <Ordner>`. Freigegeben sind nur ausdrücklich genannte Ordner.

![Ordner über die Bridge: neuestes 16-bit-TIFF im freigegebenen Ordner](img/folder.png)

**Export-Wege**

- **Lightroom Classic:** Datei → Exportieren, Speicherort = überwachter Ordner, TIFF 16 bit. Als Vorgabe sichern, danach Datei → Mit Vorgabe exportieren.
- **Capture One:** ein Verarbeitungsrezept mit dem überwachten Ordner als Ausgabeordner und TIFF 16 bit, dann Verarbeiten.
- **Resolve:** auf der Color-Seite ein Standbild aufnehmen und in der Galerie per Rechtsklick in den Ordner exportieren.

Den Farbraum des Exports stellst du an der Quelle ein, etwa Transfer **sRGB** für einen sRGB-Export. Eingebettete ICC-Profile liest LZ Scopes nicht. Die Menüwege in Lightroom und Capture One sind beschrieben, aber nicht an den Programmen nachgeprüft.

## Capture-Karten, DeckLink, NDI®

In einer Quelle **RTSP / Netz** stehen unter dem Adressfeld diese Knöpfe:

![Stream-Karte mit Gerät…, DeckLink…, NDI®…, Ordner…](img/stream-card.png)

- **Gerät…**: Karten, die sich als Systemgerät melden (USB-Capture, Magewell, Blackmagic mit WDM- oder AVFoundation-Treiber). Die Bridge nimmt das Rohformat mit der höchsten Bittiefe, das die Karte anbietet. Modus, Bildrate und Pixelformat lassen sich fest wählen.
- **DeckLink…**: Blackmagic DeckLink und UltraStudio über den DeckLink-Helfer, mit 10 bit, Formaterkennung und Timecode. Dafür muss Blackmagic Desktop Video installiert sein. Fehlt der Helfer oder der Treiber, sagt die App das. Mit echter Hardware ist dieser Weg noch nicht geprüft.
- **NDI®…**: NDI-Quellen im Netz. Dafür muss die NDI-Runtime von [ndi.video](https://ndi.video/) installiert sein. LZ Scopes liefert sie nicht mit.
- **Ordner…**: siehe oben.

Unter **Wandlung** und **Pegel** stellst du Matrix und Wertebereich fest ein, wenn eine Karte ihr Signal falsch oder gar nicht kennzeichnet.

NDI® is a registered trademark of Vizrt NDI AB.
