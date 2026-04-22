import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { request as playwrightRequest } from '@playwright/test'
import { E2E_EMAILS, E2E_ROLES } from './fixtures/e2e-data'

/**
 * Corre una vez antes de la suite E2E:
 *   1. Seedea fixtures E2E vía `pnpm test:e2e:seed` (subprocess).
 *   2. Firma los 6 roles contra `/api/test/sign-in` y persiste cookies en
 *      `tests/.auth/<role>.json` — consumidos por cada spec vía `storageState`.
 *
 * Paths se resuelven contra `process.cwd()` (raíz del repo). Evitamos
 * `import.meta.url` / `__dirname` porque el loader de Playwright puede
 * transpilar a CJS en algunas configs.
 */

function runSeed(): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('pnpm', ['test:e2e:seed'], {
      cwd: process.cwd(),
      stdio: 'inherit',
    })
    proc.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`test:e2e:seed exited with code ${code}`))
    })
    proc.on('error', reject)
  })
}

async function signInAndPersist(
  role: string,
  email: string,
  baseURL: string,
  testSecret: string,
  authDir: string,
): Promise<void> {
  const context = await playwrightRequest.newContext({ baseURL })
  const res = await context.post('/api/test/sign-in', {
    headers: { 'x-test-secret': testSecret, 'content-type': 'application/json' },
    data: { email },
  })
  if (!res.ok()) {
    const bodyText = await res.text().catch(() => '')
    throw new Error(`sign-in para ${role} (${email}) falló con status ${res.status()}: ${bodyText}`)
  }
  const outPath = path.join(authDir, `${role}.json`)
  await context.storageState({ path: outPath })
  await context.dispose()
}

export default async function globalSetup(): Promise<void> {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://lvh.me:3001'
  const testSecret = process.env.E2E_TEST_SECRET
  if (!testSecret || testSecret.length < 24) {
    throw new Error(
      '[globalSetup] E2E_TEST_SECRET no seteado (o muy corto). ' +
        'Agregalo a .env.local (generar con `openssl rand -hex 32`).',
    )
  }

  console.log('[globalSetup] seeding E2E fixtures…')
  await runSeed()

  const authDir = path.resolve(process.cwd(), 'tests', '.auth')
  await mkdir(authDir, { recursive: true })

  console.log('[globalSetup] logging in 6 roles via /api/test/sign-in…')
  for (const role of E2E_ROLES) {
    await signInAndPersist(role, E2E_EMAILS[role], baseURL, testSecret, authDir)
  }
  console.log('[globalSetup] storageState listo en tests/.auth/')
}
