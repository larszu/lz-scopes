// electron-builder config (pattern: cable-planner). Signing turns on automatically
// when CSC_LINK + CSC_KEY_PASSWORD are set; without them the build is unsigned.
const year = new Date().getFullYear()

export default {
  appId: 'de.zumpelars.lzscopes',
  productName: 'LZ Scopes',
  copyright: `Copyright © ${year} Lars Zumpe`,
  publish: [{ provider: 'github', owner: 'larszu', repo: 'lz-scopes', releaseType: 'release' }],
  files: ['dist/**/*', 'server/**/*', 'electron/**/*', 'licenses/**/*', 'package.json'],
  // The packaged package.json must NOT say `type: module` (cable-planner v0.1.1
  // crashed on exactly that: the @electron/universal entry shim is CommonJS).
  // `.mjs` files (server/) stay ESM by extension, electron/main.cjs is CommonJS.
  extraMetadata: { type: 'commonjs', main: 'electron/main.cjs' },
  // ffmpeg can only be executed from outside the asar archive.
  // ffmpeg and the Resolve helper (run by Python) must live outside the asar archive.
  asarUnpack: ['**/node_modules/ffmpeg-static/**', 'server/resolve_helper.py'],
  directories: { buildResources: 'build', output: 'release' },
  mac: {
    category: 'public.app-category.video',
    target: [
      { target: 'dmg', arch: 'universal' },
      { target: 'zip', arch: 'universal' },
    ],
    artifactName: '${productName}-${version}-${arch}.${ext}',
    // scripts/ffmpeg-universal.mjs makes ffmpeg a fat binary; identical in both halves.
    x64ArchFiles: '**/ffmpeg-static/ffmpeg',
    mergeASARs: false,
    icon: 'build/icon.png',
    // Ad-hoc signature: Apple Silicon refuses fully unsigned binaries ("damaged").
    identity: '-',
    hardenedRuntime: false,
    gatekeeperAssess: false,
    extendInfo: {
      NSCameraUsageDescription: 'LZ Scopes misst das Bild einer angeschlossenen Kamera oder Capture-Karte.',
    },
  },
  win: {
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
