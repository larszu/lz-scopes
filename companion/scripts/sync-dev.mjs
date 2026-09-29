// Copy the built module into Companion's developer-modules folder
// (Companion → Settings → Developer modules path), then install runtime deps there.
//   COMPANION_DEV_MODULES=~/companion-dev npm run sync
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const devRoot = path.resolve((process.env.COMPANION_DEV_MODULES ?? path.join(os.homedir(), 'companion-dev')).replace(/^~/, os.homedir()))
const target = path.join(devRoot, 'companion-module-lz-scopes')

fs.mkdirSync(target, { recursive: true })
for (const entry of ['package.json', 'companion', 'dist']) {
  fs.cpSync(path.join(moduleRoot, entry), path.join(target, entry), { recursive: true, force: true })
}
execFileSync('npm', ['install', '--omit=dev', '--no-package-lock'], { cwd: target, stdio: 'inherit', shell: process.platform === 'win32' })
console.log(`[companion-module-lz-scopes] → ${target}`)
