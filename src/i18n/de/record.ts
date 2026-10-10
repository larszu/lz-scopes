// Deutsche Übersetzung zu en/record.ts.
import type en from '../en/record';
import type { Translation } from '../types';

export default {
  'record.rec': 'Aufnahme',
  'record.stop': 'Stopp',
  'record.title': 'Diese Quelle in der Bridge aufnehmen (Netzwerkquellen unverändert, unkomprimierte Quellen mit dem Codec aus Einstellungen → Aufnahme)',
  'record.titleBrowser': 'Diese Quelle in der Seite aufnehmen (MediaRecorder, 8 bit) in den Aufnahme-Ordner',
  'record.all': 'Alle aufnehmen',
  'record.allStop': 'Stopp',
  'record.allTitle': 'Alle Quellen in eine gemeinsame Aufnahme schreiben oder alle Aufnahmen beenden (R)',
  'record.nothing': 'Gerade lässt sich keine Quelle aufnehmen',
  'record.starting': 'startet …',
  'record.copy': 'Kopie ohne Neukodierung',
  'record.minutesLeft': 'Platz für {min} min',
  'record.failed': 'Aufnahme {source}: {error}',
  'record.noStream': 'Aufnahme {source}: kein Bildstrom verfügbar',
  'record.noMediaRecorder': 'Dieser Browser kann nicht aufnehmen (MediaRecorder fehlt)',
  'record.marked': 'Marker {label} in {n} Aufnahmen',
  'record.settings': 'Aufnahme',
  'record.folder': 'Ordner',
  'record.addFolder': 'Ordner wählen …',
  'record.free': 'frei',
  'record.noRoot': 'kein Ordner freigegeben',
  'record.folderHint': 'Die Bridge schreibt nur in freigegebene Ordner: in der Desktop-App Filme/Videos › LZ Scopes und hier gewählte Ordner, mit npm start die mit --record-dir angegebenen. Jede Aufnahme bekommt einen eigenen Unterordner mit einer Datei je Quelle und einer Begleitdatei (.json).',
  'record.codec': 'Codec für unkomprimierte Quellen',
  'record.codec.hevc': 'HEVC 10 bit (Hardware-Encoder)',
  'record.codec.ffv1': 'FFV1 (verlustfrei)',
  'record.codecHint': 'Gilt für Testbilder, Capture-Geräte, DeckLink und NDI. Netzwerkquellen (RTSP, SRT, RTMP, UDP …) werden unverändert ohne Neukodierung geschrieben. HEVC nutzt VideoToolbox, NVENC oder Quick Sync und weicht sonst auf libx265 aus. FFV1 behält das Quellformat exakt, auch Sub-Black und Super-White.',
  'record.container': 'Container',
  'record.segment': 'Segmentlänge',
  'record.segmentHint': 'Nach dieser Zeit beginnt eine neue Datei; stürzt App oder Rechner ab, fehlt höchstens das gerade geschriebene Segment.',
} satisfies Translation<typeof en>;
