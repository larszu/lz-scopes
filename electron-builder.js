// electron-builder config (pattern: cable-planner). Signing turns on automatically
// when CSC_LINK + CSC_KEY_PASSWORD are set; without them the build is unsigned.
import { existsSync } from 'node:fs'

const year = new Date().getFullYear()

// ffmpeg + ffprobe (scripts/ffmpeg-builds.json, fetched by scripts/ffmpeg-fetch.mjs) go to
// <resources>/ffmpeg/ outside the asar archive, with their licences and the source offer
// (licenses/ffmpeg/). server/ffmpeg.mjs finds them there.
const ffmpegDir = { mac: 'vendor/ffmpeg/darwin-universal', win: 'vendor/ffmpeg/win32-x64' }
const ffmpegResources = (os, filter) => [
  { from: ffmpegDir[os], to: 'ffmpeg', filter },
  { from: 'licenses/ffmpeg', to: 'ffmpeg/licenses' },
]

// ArgyllCMS (AGPL-3) is never shipped: the app only calls a user-installed spotread
// (docs/research/display-kalibrierung.md). Guard against a stray copy in helpers/bin or dist.
export const ARGYLL_EXCLUDE = ['!**/spotread*', '!**/dispcal*', '!**/dispread*', '!**/colprof*', '!**/collink*', '!**/*[Aa]rgyll*', '!**/*.ccmx', '!**/*.ccss']

export default {
  appId: 'de.zumpelars.lzscopes',
  productName: 'LZ Scopes',
  copyright: `Copyright © ${year} Lars Zumpe`,
  publish: [{ provider: 'github', owner: 'larszu', repo: 'lz-scopes', releaseType: 'release' }],
  files: ['dist/**/*', 'server/**/*', 'electron/**/*', 'licenses/**/*', 'helpers/bin/**/*', 'package.json', ...ARGYLL_EXCLUDE],
  // The packaged package.json must NOT say `type: module` (cable-planner v0.1.1
  // crashed on exactly that: the @electron/universal entry shim is CommonJS).
  // `.mjs` files (server/) stay ESM by extension, electron/main.cjs is CommonJS.
  extraMetadata: { type: 'commonjs', main: 'electron/main.cjs' },
  // The Resolve helper (run by Python) and the native capture helpers (helpers/bin, built by
  // scripts/build-helpers.mjs) must live outside the asar archive; ffmpeg is an extraResource.
  asarUnpack: ['server/resolve_helper.py', 'helpers/bin/**'],
  // no installer without the redistributable ffmpeg (a missing folder would be skipped silently)
  beforePack: async (ctx) => {
    const os = ctx.electronPlatformName === 'darwin' ? 'mac' : ctx.electronPlatformName === 'win32' ? 'win' : null
    if (os && !existsSync(`${ffmpegDir[os]}/BUILD.json`)) throw new Error(`${ffmpegDir[os]} fehlt – node scripts/ffmpeg-fetch.mjs ${ffmpegDir[os].split('/').pop()}`)
  },
  directories: { buildResources: 'build', output: 'release' },
  mac: {
    category: 'public.app-category.video',
    target: [
      { target: 'dmg', arch: 'universal' },
      { target: 'zip', arch: 'universal' },
    ],
    artifactName: '${productName}-${version}-${arch}.${ext}',
    // ffmpeg/ffprobe are fat binaries (lipo in scripts/ffmpeg-fetch.mjs), identical in both
    // halves; the helpers are built universal as well
    x64ArchFiles: '{**/ffmpeg/ffmpeg,**/ffmpeg/ffprobe,**/helpers/bin/*}',
    extraResources: ffmpegResources('mac', ['ffmpeg', 'ffprobe', 'BUILD.json']),
    mergeASARs: false,
    icon: 'build/icon.png',
    // Ad-hoc signature: Apple Silicon refuses fully unsigned binaries ("damaged").
    identity: '-',
    hardenedRuntime: false,
    gatekeeperAssess: false,
    extendInfo: {
      NSCameraUsageDescription: 'LZ Scopes misst das Bild einer angeschlossenen Kamera oder Capture-Karte.',
      // required when the app uses Bluetooth (Apple: NSBluetoothAlwaysUsageDescription, macOS 11+)
      NSBluetoothAlwaysUsageDescription: 'LZ Scopes verbindet sich per Bluetooth mit einem Lichtmesser (Opple Light Master).',
      // audio devices (getUserMedia and the bridge's ffmpeg avfoundation input)
      NSMicrophoneUsageDescription: 'LZ Scopes misst den Ton eines Audiogeräts, einer Capture-Karte oder eines Mikrofons.',
    },
  },
  win: {
    extraResources: ffmpegResources('win', ['*.exe', '*.dll', 'BUILD.json']),
    target: [
      { target: 'nsis', arch: 'x64' },
      { target: 'portable', arch: 'x64' },
    ],
    artifactName: '${productName}-${version}-${arch}.${ext}',
    icon: 'build/icon.png',
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    perMachine: false,
    shortcutName: 'LZ Scopes',
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
  },
  portable: { artifactName: '${productName}-${version}-portable.${ext}' },
}
