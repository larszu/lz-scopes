# UI architecture

How the main window builds its interface: one DOM helper, one set of controls, one popover,
one dialog, one token file. No framework: vanilla TypeScript and Vite, no new runtime
dependency. Output windows (`?view=…`, `src/outputView.ts`) keep their own small HUD and do not
load the shared styles.

## Audit (before, October 2026)

Every feature module had grown its own copy of the same building blocks:

| Pattern | Built separately in |
|---|---|
| hyperscript `h()` (12 copies, 3 behaviours: `on*` as listener or property, booleans as `''` or `"true"`, falsy children kept or dropped) | main, audio/ui, calib/ui, clock/ui, led/ui, led/oppleUi, match/ui, opple/ui, opple/panelSettings, shading/ui, testMedia; variants `el()` in menu/pages, native/ios, outputView |
| select with `[value, label]` options (incl. grouped) | main (2), audio/ui, calib/ui, clock/ui, led/ui, led/oppleUi, match/ui, opple/panelSettings, opple/ui (4), shading/ui, sysprofile, genlock, embed |
| number field (with/without clamping, 4 different widths inline) | main (`numIn`, chain `num`), audio/ui `num`, calib/ui `numIn`, led/ui `numIn`, led/oppleUi `numIn`, match/ui `num`, sysprofile, clock/ui |
| checkbox + text label (`label.inline`) | main (15 inline copies), audio/ui `check`, clock/ui `check`, calib/ui, led/ui, led/oppleUi, shading/ui, sysprofile, menu/appMenu |
| range slider (gain, glow, wipe, playhead) | main (4), outputView |
| label + control row (`.mrow`) | main (`srow`, `row` ×3), calib/ui, match/ui, clock/ui, audio/ui, genlock, opple/panelSettings, sysprofile |
| hint paragraph | 15 files |
| section head (kicker) | menu/settings, calib/ui, led/ui, match/ui, opple/ui (h3 / `.mtitle` / `.set-kicker`) |
| button variants `mini` / `primary` / `icon` / `on` | 12 files, each with its own class strings |
| popover (panel ⚙) | `<details class="menu psettings">` + a global `toggle` listener that pinned it to the viewport + a global `pointerdown` to close it + 4 "re-open after rebuild" hacks |
| modal dialog | settings (menu/settings), tool dialogs Layouts/Output (main, HTML string), LUT library (main), window picker (main, `div.modal`), manual (`div.modal` + own Esc handler), calibration (calib/ui), LED tool (led/ui), test pictures/videos (testMedia), colour targets (match/ui) – six different head/close/Esc/backdrop implementations |
| tabs | settings categories (menu/settings, own keyboard handling) |
| status chips and dots | main (stage chip, latency chip, ROI chip, route chip), testMedia, `.src .dot` |
| file pickers and downloads | main (4), audio/ui, calib/ui, led/ui, led/oppleUi, match/ui, opple/ui, testMedia, calib/report |
| injected `<style>` strings | led/ui, opple/ui |
| colours | three skins in `style.css`, plus hard-coded hex values for warnings, grades and hints in component rules |
| responsive | three `@media` rules: sidebar overlay below 800 px, menu bar burger below 900 px, settings nav on top below 640 px; iOS-only touch sizes in `native/mobile.css` |

## Target architecture

```
src/ui/
  index.ts        barrel; feature modules import from '../ui'
  dom.ts          h(), setAttrs(), $, $$, link(), download(), filePicker()
  controls.ts     select, groupedSelect, numberInput, checkbox, slider, colour, textInput,
                  button, iconButton, segmented, field, row, toolbar, hint, kicker, section,
                  disclosure, chip, statusDot, table, inlineLabel
  popover.ts      popover(): native popover="auto" (top layer, Esc, outside click, one open),
                  placed next to its trigger and clamped to the viewport; bottom sheet on phones.
                  place(): the one placement routine (below/above or beside, flip, clamp,
                  height cap with scrolling), also used by the menu bar (src/menu/menubar.ts):
                  its menus and submenus are popover="auto" too, so every overlay opens and
                  closes the same way (trigger toggles, Esc one level, click outside, one open)
  modal.ts        modal()/openModal(): native <dialog> + showModal() (rest of the page inert,
                  focus stays inside), head with title and close, Esc, backdrop click, sizes
                  sm/md/lg/xl, full-screen sheet below 640 px
  tabs.ts         WAI-ARIA tablist with arrow keys, Home/End
  schema.ts       Setting descriptions → settings window rows, panel ⚙ rows, control API
  tokens.css      the only colour values: skins × light/dark, type scale, spacing, sizes
  components.css  base elements and the components above
src/style.css     app shell (header, sidebar, dock, panels, source cards) and the feature areas
```

Rules:

- **One builder per pattern.** A module that needs a select calls `select()`; it never builds
  `<option>`s itself. New patterns go into `src/ui/`, not into the feature module.
- **Labels come translated.** Controls take strings from `t(...)`; `src/ui/` itself only uses
  `common.*` keys (close).
- **Global settings are described once** (`SET` in `src/main.ts`, type `Setting`): key, kind,
  translated label, options or range, getter and setter. The settings window renders them with
  `settingsForm()`, panel popovers with `settingRow()`/`settingControl()` (label may differ,
  e.g. "Trace colour (mono)"), and the control API applies them with `applySetting()` (command
  `setting`, `state.settings`, Companion action "Set a setting").
- **Colours only from tokens.** `test/theme.test.ts` fails on any hex value in `style.css` or
  `components.css` (except picture letterbox black); the neutral skin is checked achromatic in
  dark and light.
- **Feature hooks stay as class names** (`.src`, `.lutslot`, `.stagechip`, `.llchip`,
  `button.lname`, `button.fav`, `[data-field]` …): tests and the control API rely on them.

### Light and dark

`data-theme` (skin: neutral, lzm, original) and `data-scheme` (light, dark) on `<html>`
(`src/theme.ts`). The setting "Appearance" offers dark, light and "like the system"; **dark is
the default** because the app sits next to the picture in colour-critical work and a bright
interface changes the viewer's adaptation. The skin *original* exists only in dark. The scope
bodies keep `--scope-bg` in every skin and scheme. On light chrome the navy signet of the brand
kit replaces the off-white one.

### Responsive behaviour

| Width | Header | Sources | Dock | Popovers / dialogs |
|---|---|---|---|---|
| > 1000 px | menu bar, layout presets, scale, fps, freeze, ⚙, full screen | side column (toggle ◧, B) | dockview, drag to split/stack | anchored popovers, centred dialogs |
| 801–1000 px | menu bar ≤ 900 px behind ☰; presets and scale move into the "⋯" overflow popover | side column | dockview | anchored |
| 641–800 px | as above | drawer over the scopes with scrim, starts closed, not saved as closed | dockview | anchored |
| ≤ 640 px (phones; also ≤ 900 × 500 landscape) | product name and fps hidden; ≤ 440 px full screen only in the View menu | drawer | **compact**: all open panels as tabs of one group, dragging off; the full layout is kept aside and comes back unchanged when the window gets wide | **bottom sheets**, dialogs full screen |

- The header reacts to its own width (container query `bar`), panel heads to the panel width
  (container `panel`: chips and the source select give way), form rows to their container
  (labels go above the control below 300 px).
- Coarse pointers (touch) get 44 px controls (`--control-h`), wider sash grips and taller dock
  tabs; fine pointers keep the dense 24 px tool size.
- No horizontal page scroll at any size; `e2e/responsive.spec.ts` checks 375 × 812,
  768 × 1024, 1280 × 800 and 1920 × 1080 in light and dark (headless Chromium, no Electron) and
  writes screenshots to `test-results/responsive/`.
- `e2e/ui-audit.spec.ts` audits every menu, submenu, popover and dialog at the same four
  sizes in German and English: inside the viewport, not covered (`elementFromPoint`), the same
  open/close logic, focus back to the trigger, arrow keys, visible focus ring, targets ≥ 24 px
  (≥ 44 px on touch), no cut-off labels, no console errors, WCAG AA text contrast in every skin
  and scheme, and the native menu of the desktop app (hidden window, `LZS_HIDDEN=1`).

### Migration

1. UI core, tokens, main window, menu, settings, manual, system profile, control API `setting`,
   responsive shell and viewport tests.
2. Feature modules (audio, clock, genlock, match, opple, LED, calibration, shading, test
   media, iOS, bridge inputs, Resolve, output view) onto `src/ui/`; their duplicate helpers and
   the legacy `.mrow`/`.mtitle` aliases go.

---

## Deutsch (Kurzfassung)

Die Oberfläche des Hauptfensters entsteht aus einer gemeinsamen Schicht `src/ui/`: ein `h()`,
ein Satz Bedienelemente (Auswahl, Zahl, Häkchen, Schieber, Farbe, Knöpfe, Segmente, Zeile,
Abschnitt), ein Popover (natives `popover`, am Auslöser ausgerichtet, auf dem Telefon als
Bottom Sheet), ein Dialog (natives `<dialog>`, auf dem Telefon bildschirmfüllend), Tabs und eine
Token-Datei für alle Farben (Oberflächen neutral, LZM, Original × hell/dunkel). Vorher bauten
zwölf Module ihre eigenen Kopien davon (Tabelle oben).

Globale Einstellungen sind einmal beschrieben (`SET` in `src/main.ts`) und erscheinen daraus im
Einstellungen-Fenster, in den ⚙-Popovern der Panels und in der Steuer-API (Befehl `setting`,
Companion-Aktion „Set a setting“). Dunkel bleibt die Vorgabe; Hell und „Wie das System“ sind
wählbar, die Scopes selbst bleiben immer dunkel.

Responsiv: Unter 1000 px wandern Layout-Vorlagen und Skala in das „⋯“-Menü, unter 800 px werden
die Quellen eine Schublade über den Scopes, unter 640 px zeigt das Dock alle Panels als Tabs
einer Gruppe (Ziehen nur auf breiten Bildschirmen), Popover werden Bottom Sheets und Dialoge
bildschirmfüllend. Touch bekommt 44-px-Bedienflächen. `e2e/responsive.spec.ts` prüft vier
Größen in hell und dunkel ohne waagerechtes Scrollen. `e2e/ui-audit.spec.ts` prüft jedes Menü,
Untermenü, Popover und jeden Dialog in Deutsch und Englisch: im Bild, nicht überdeckt, dieselbe
Logik zum Öffnen und Schließen (Auslöser, Esc, Klick daneben, nur eins offen, Fokus zurück),
Pfeiltasten, sichtbarer Fokus, Zielgrößen, abgeschnittene Texte, Konsolenfehler, Kontrast nach
WCAG AA in allen Oberflächen sowie das native Menü der Desktop-App. Die Menüleiste nutzt dasselbe
Popover-Modell wie die ⚙-Menüs (`place()` mit Flip und Klemmen an den Rand).
