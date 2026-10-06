// Keyboard shortcuts of the main window: one list for the menu labels, the settings page
// "Tastatur", Help → Tastenkürzel and the README. The keys themselves are handled in
// src/main.ts (keydown) and src/menu/appMenu.ts (Cmd/Ctrl+,).

export interface Shortcut { keys: string[]; what: string; group: string }

export const SHORTCUTS: Shortcut[] = [
  { group: 'Allgemein', keys: ['CmdOrCtrl+,'], what: 'Einstellungen' },
  { group: 'Allgemein', keys: ['F'], what: 'Vollbild' },
  { group: 'Allgemein', keys: ['S'], what: 'Screenshot als PNG' },
  { group: 'Allgemein', keys: ['B'], what: 'Seitenleiste (Quellen) ein/aus' },
  { group: 'Ansicht', keys: ['1', '2', '3', '4', '5', '6'], what: 'Layout-Vorlage 1–6' },
  { group: 'Ansicht', keys: ['Space'], what: 'Einfrieren / weiter (bei Videodateien: Wiedergabe)' },
  { group: 'Ansicht', keys: ['Escape'], what: 'Solo beenden, sonst Messpunkt und Rahmen löschen' },
  { group: 'Ansicht', keys: ['C'], what: 'Messpunkt der Kette (Signal, CST, LUT …) weiterschalten' },
  { group: 'Videodatei', keys: ['Left', 'Right'], what: 'ein Bild zurück / vor' },
  { group: 'Videodatei', keys: ['Shift+Left', 'Shift+Right'], what: 'eine Sekunde zurück / vor' },
  { group: 'Videodatei', keys: ['J', 'K', 'L'], what: 'Shuttle rückwärts / Stopp / vorwärts' },
  { group: 'Videodatei', keys: ['Home', 'End'], what: 'Anfang / Ende' },
  { group: 'Maus', keys: ['Doppelklick'], what: 'Panel solo (groß) und zurück' },
  { group: 'Maus', keys: ['Klick ins Bild'], what: 'Messpunkt setzen; Ziehen = Messrahmen' },
  { group: 'Maus', keys: ['Rechtsklick'], what: 'Messpunkt und Rahmen löschen' },
  { group: 'Ausgabefenster', keys: ['F'], what: 'Vollbild' },
  { group: 'Ausgabefenster', keys: ['E'], what: 'Overlay bearbeiten (Scopes verschieben, skalieren)' },
];
