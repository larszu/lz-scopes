// Deutsche Übersetzung zu en/native.ts.
import type en from '../en/native';
import type { Translation } from '../types';

export default {
  'native.note': 'iPhone/iPad dekodieren kein RTSP/SRT selbst. Die Bridge läuft auf einem Rechner im selben Netz: Desktop-App mit LZS_HOST=0.0.0.0 oder npm start -- --host 0.0.0.0. Sie meldet sich per Bonjour.',
  'native.search': 'Bridge im Netz suchen',
  'native.bridgePh': 'z. B. 192.168.1.20:4192',
  'native.searching': 'Suche …',
  'native.noScreen': 'Bildschirmaufnahme (getDisplayMedia) gibt es in WKWebView auf iPhone/iPad nicht.',
  'native.noFolder': 'Ordner beobachten (File System Access) gibt es in WKWebView nicht; einzelne Dateien über „Datei“.',
  'native.camsPhone': 'iPhone: Kameras',
  'native.camsPad': 'iPad: Kameras und USB-Capture',
  'native.noPermission': 'Kamera-Freigabe fehlt noch',
  'native.selectable': 'als Quelle wählbar',
  'native.notOffered': 'von WebKit nicht angeboten',
  'native.noCamera': 'Keine Kamera gefunden.',
  'native.camHint': 'Kamera als Quelle: oben „+ Quelle → Kamera/Capture“. USB-Capture-Karten (UVC) erscheinen ab iPadOS 17, nicht am iPhone. Belegt nur über die WebKit-Dokumentation, mit echter Karte ungeprüft.',
  'native.noBridge': 'Keine Bridge gefunden. Läuft sie mit --host 0.0.0.0 im selben WLAN? Adresse sonst oben eintragen.',
  'native.ble.noChar': 'Characteristic {uuid} fehlt',
  'native.ble.noService': 'Dienst {uuid} fehlt',
  'native.ble.noDevice': 'Kein passendes Bluetooth-Gerät gefunden',
} satisfies Translation<typeof en>;
