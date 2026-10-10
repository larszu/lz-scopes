// Deutsche Übersetzung zu en/compare.ts.
import type en from '../en/compare';
import type { Translation } from '../types';

export default {
  'ghost.section': 'Referenzkamera',
  'ghost.source': 'Referenz',
  'ghost.sourceTitle': 'Die Kamera, mit der alle anderen verglichen werden: Ihre Spur erscheint in den Scopes mit eingeschalteter „Referenzspur“',
  'ghost.sourceHint': 'Eine Kamera einrichten, zur Referenz machen und die anderen auf ihre Spur abgleichen (bei Tektronix: eingefrorene Spur zum Kamera-Matching).',
  'ghost.mode': 'Referenzspur',
  'ghost.modeTitle': 'Live folgt der Referenzkamera, eingefroren hält das Bild vom Moment des Einfrierens',
  'ghost.modeHint': 'Eingefroren: Die abgeglichene Kamera bleibt als Vorlage stehen, auch wenn sie umschwenkt oder auf einen anderen Eingang wechselt.',
  'ghost.live': 'live',
  'ghost.frozen': 'eingefroren',
  'ghost.opacity': 'Deckkraft Referenz',
  'ghost.opacityTitle': 'Stärke der Referenzspur über der Live-Spur',
  'ghost.refreeze': 'Neu einfrieren',
  'ghost.refreezeTitle': 'Das aktuelle Bild der Referenzkamera als eingefrorene Referenz übernehmen',
  'ghost.hint': 'Die Referenzspur erscheint in Magenta. Jeder Scope mit eingeschalteter Spur zeigt Δ = live − Referenz für Schwarz (Mittel der dunkelsten 1 %), Median und Spitzlicht (Mittel der hellsten 1 %) in Prozentpunkten, je Y′, R′, G′, B′; mit Messrahmen nur für den Rahmen.',
  'ghost.trace': 'Referenz',
  'ghost.traceText': 'Referenzspur einblenden',
  'ghost.traceTitle': 'Spur der Referenzkamera (Einstellungen → Referenzkamera) in Magenta überlagern und die Pegelabstände zeigen',
  'ghost.box.ref': 'Ref {name} ({mode})',
  'ghost.black': 'Schwarz',
  'ghost.median': 'Median',
  'ghost.peak': 'Spitze',
  'ghost.noData': 'noch kein Bild zum Vergleichen',
  'tiles.scope': 'Scope je Kachel',
  'tiles.scopeTitle': 'Derselbe Scope erscheint einmal je Quelle',
  'tiles.sources': 'Quellen',
  'tiles.hint': 'Nichts angehakt: die ersten {max} Videoquellen in Listenreihenfolge. Jede Kachel trägt die Kamera-ID (Nummer in der Quellenliste und Name). Die Zeilen darunter gelten für alle Kacheln.',
} satisfies Translation<typeof en>;
