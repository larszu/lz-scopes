// electron-builder config (pattern: cable-planner). Signing turns on automatically
// when CSC_LINK + CSC_KEY_PASSWORD are set; without them the build is unsigned.
import { existsSync } from 'node:fs'

const year = new Date().getFullYear()

// ffmpeg + ffprobe (scripts/ffmpeg-builds.json, fetched by scripts/ffmpeg-fetch.mjs) go to
// <resources>/ffmpeg/ outside the asar archive, with their licences and the source offer
// (licenses/ffmpeg/). server/ffmpeg.mjs finds them there.
const ffmpegDir = { mac: 'vendor/ffmpeg/darwin-universal', win: 'vendor/ffmpeg/win32-x64', linux: 'vendor/ffmpeg/linux-x64' }
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
  // desktopName: Electron's Wayland app_id / X11 WM_CLASS, matched to the Linux .desktop file
  extraMetadata: { type: 'commonjs', main: 'electron/main.cjs', desktopName: 'lz-scopes.desktop' },
  // The Resolve helper (run by Python) and the native capture helpers (helpers/bin, built by
  // scripts/build-helpers.mjs) must live outside the asar archive; ffmpeg is an extraResource.
  // serialport (the built-in camera bridge, electron/camera-bridge.cjs): native N-API module,
  // loadable only from a real path outside the archive
  asarUnpack: ['server/resolve_helper.py', 'helpers/bin/**', '**/node_modules/serialport/**', '**/node_modules/@serialport/**', '**/*.node'],
  // no installer without the redistributable ffmpeg (a missing folder would be skipped silently)
  beforePack: async (ctx) => {
    const os = { darwin: 'mac', win32: 'win', linux: 'linux' }[ctx.electronPlatformName] ?? null
    // Linux: only x64 has an ffmpeg build (scripts/ffmpeg-builds.json); arm64 would ship an x64 binary
    if (os === 'linux' && ctx.arch !== 1) throw new Error('Linux: only x64 is built (no linux-arm64 ffmpeg yet)')
    if (os && !existsSync(`${ffmpegDir[os]}/BUILD.json`)) throw new Error(`${ffmpegDir[os]} missing – node scripts/ffmpeg-fetch.mjs ${ffmpegDir[os].split('/').pop()}`)
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
    x64ArchFiles: '{**/ffmpeg/ffmpeg,**/ffmpeg/ffprobe,**/helpers/bin/*,**/node_modules/@serialport/bindings-cpp/prebuilds/**}',
    // InfoPlist.strings: German permission texts (the English ones are extendInfo below). Electron
    // already ships <lang>.lproj folders in Contents/Resources (Chromium locales); these files are
    // added to them. Do not set `electronLanguages` without en and de, it would drop the folders.
    extraResources: [...ffmpegResources('mac', ['ffmpeg', 'ffprobe', 'BUILD.json']),
      { from: 'build/mac/en.lproj', to: 'en.lproj' }, { from: 'build/mac/de.lproj', to: 'de.lproj' }],
    mergeASARs: false,
    icon: 'build/icon.png',
    // Ad-hoc signature: Apple Silicon refuses fully unsigned binaries ("damaged").
    identity: '-',
    hardenedRuntime: false,
    gatekeeperAssess: false,
    extendInfo: {
      // English (development region); German in build/mac/de.lproj/InfoPlist.strings
      CFBundleDevelopmentRegion: 'en',
      NSCameraUsageDescription: 'LZ Scopes measures the picture of a connected camera or capture card.',
      // required when the app uses Bluetooth (Apple: NSBluetoothAlwaysUsageDescription, macOS 11+)
      NSBluetoothAlwaysUsageDescription: 'LZ Scopes connects to a light meter (Opple Light Master) over Bluetooth.',
      // audio devices (getUserMedia and the bridge's ffmpeg avfoundation input)
      NSMicrophoneUsageDescription: 'LZ Scopes measures the sound of an audio device, a capture card or a microphone.',
      // Electron sets generic English defaults ("This app needs access to …") for these two; replaced
      NSAudioCaptureUsageDescription: 'LZ Scopes measures captured sound (levels, loudness, phase).',
      NSBluetoothPeripheralUsageDescription: 'LZ Scopes connects to a light meter (Opple Light Master) over Bluetooth.',
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
  // Linux (AppImage + deb, x64). File names without spaces: GitHub turns spaces in asset names
  // into dots, while latest-linux.yml keeps the electron-builder name; the AppImage updater
  // (electron/updater.cjs) needs both to match. arm64: no linux-arm64 ffmpeg build yet.
  linux: {
    target: [
      { target: 'AppImage', arch: 'x64' },
      { target: 'deb', arch: 'x64' },
    ],
    artifactName: 'lz-scopes-${version}-${arch}.${ext}',
    executableName: 'lz-scopes',
    syncDesktopName: true,
    icon: 'build/icon.png',
    // freedesktop menu: main category AudioVideo plus the additional category Video
    category: 'AudioVideo;Video',
    maintainer: 'Lars Zumpe <209382770+larszu@users.noreply.github.com>',
    vendor: 'Lars Zumpe',
    synopsis: 'Waveform, vectorscope, histogram and audio scopes',
    // also the Comment of the .desktop file
    description: 'Waveform, vectorscope, histogram and audio scopes for cameras, capture cards, screens and streams',
    desktop: { entry: { Name: 'LZ Scopes', GenericName: 'Video scopes', 'GenericName[de]': 'Video-Scopes', 'Comment[de]': 'Waveform, Vektorskop, Histogramm und Audio-Scopes für Kameras, Capture-Karten, Bildschirme und Streams', Keywords: 'waveform;vectorscope;scope;video;colour;color;loudness;' } },
    extraResources: ffmpegResources('linux', ['ffmpeg', 'ffprobe', 'BUILD.json']),
  },
  deb: {
    // electron-builder's defaults (GTK, NSS, libasound …) plus the v4l2 tools for format listing
    recommends: ['v4l-utils'],
    packageCategory: 'video',
  },
  portable: { artifactName: '${productName}-${version}-portable.${ext}' },
}
