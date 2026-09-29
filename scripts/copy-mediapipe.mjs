// Copies the MediaPipe Tasks Vision WASM runtime into public/ so face tracking works
// offline (desktop app) and without a CDN. Runs before dev and build.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const from = join('node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const to = join('public', 'mediapipe');
if (!existsSync(from)) { console.warn('mediapipe wasm not found – face tracking disabled'); process.exit(0); }
mkdirSync(to, { recursive: true });
for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm']) {
  cpSync(join(from, f), join(to, f));
}
console.log('mediapipe wasm → public/mediapipe');
