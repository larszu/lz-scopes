// English source texts: native.
import type { Messages } from '../types';

export default {
  'native.note': 'iPhone/iPad do not decode RTSP/SRT themselves. The bridge runs on a computer on the same network: desktop app with LZS_HOST=0.0.0.0 or npm start -- --host 0.0.0.0. It announces itself via Bonjour.',
  'native.search': 'Find bridge on the network',
  'native.bridgePh': 'e.g. 192.168.1.20:4192',
  'native.searching': 'Searching …',
  'native.noScreen': 'Screen capture (getDisplayMedia) does not exist in WKWebView on iPhone/iPad.',
  'native.noFolder': 'Watching a folder (File System Access) does not exist in WKWebView; single files via “File”.',
  'native.camsPhone': 'iPhone: cameras',
  'native.camsPad': 'iPad: cameras and USB capture',
  'native.noPermission': 'camera permission still missing',
  'native.selectable': 'selectable as a source',
  'native.notOffered': 'not offered by WebKit',
  'native.noCamera': 'No camera found.',
  'native.camHint': 'Camera as a source: at the top “+ Source → Camera/Capture”. USB capture cards (UVC) appear from iPadOS 17, not on the iPhone. Documented only by the WebKit documentation, unverified with a real card.',
  'native.noBridge': 'No bridge found. Is it running with --host 0.0.0.0 on the same Wi-Fi? Otherwise enter the address above.',
  'native.ble.noChar': 'Characteristic {uuid} missing',
  'native.ble.noService': 'Service {uuid} missing',
  'native.ble.noDevice': 'No matching Bluetooth device found',
} as const satisfies Messages;
