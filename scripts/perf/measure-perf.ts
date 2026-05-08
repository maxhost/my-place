#!/usr/bin/env tsx
/**
 * Prueba unificada de performance para Place.
 *
 * Mide en una sola corrida las 4 capas que importan para acercarnos al
 * objetivo "200ms-like-Flarum":
 *
 *   Capa 1 — bundle First Load JS por route (parse de `.next/build-manifest.json`).
 *   Capa 2 — DB queries por page (parse de `PERF_LOG=1` stdout de `pnpm start`).
 *   Capa 3 — TTFB + FCP + LCP + TBT por page (Playwright contra `pnpm start`).
 *   Capa 4 — aproximación a producción real: corremos contra `pnpm start` (build
 *            optimizado, NODE_ENV=production) con la `DATABASE_URL` apuntando a
 *            Supabase Cloud Dev — eso da RTT real al pooler. La diferencia con
 *            Vercel real es ~20-50ms de cold-start de la function + edge network,
 *            que NO podemos medir sin deploy.
 *
 * Pre-requisitos:
 *   1. `pnpm build` ya corrido (chequea `.next/build-manifest.json`).
 *   2. `.env.local` con `DATABASE_URL` apuntando al pooler Cloud Dev.
 *   3. Seed E2E aplicado (`pnpm test:e2e:seed`) — usamos los users + places + posts
 *      del fixture para tener data realista en la DB.
 *   4. `playwright` instalado (ya lo está, lo usa la suite E2E).
 *   5. `tests/.auth/owner.json` storageState existe — generalo con `pnpm test:e2e`
 *      (corre global-setup) si no está.
 *   6. **Puerto libre**: el script usa el puerto del `NEXT_PUBLIC_APP_DOMAIN`
 *      del `.env.local` (default 3000). Si tenés `pnpm dev` corriendo ahí, matalo
 *      antes (`pkill -f "next dev"`). El bundle de `next build` bake-ina ese
 *      puerto en compile-time; si corremos en otro puerto las gated routes
 *      retornan 404 por mismatch de host en el middleware.
 *
 * Uso:
 *   pnpm perf                                            # local prod, comportamiento por default
 *   pnpm perf --json                                     # output JSON para diff entre corridas
 *   pnpm perf --routes=conversations,library             # subset de routes
 *   pnpm perf --target-url=https://my-preview.vercel.app # mide contra una URL externa (Vercel preview)
 *   pnpm perf --target-url=... --routes=conversations    # subset en modo remoto
 *   pnpm perf --target-url=... --json                    # JSON output en modo remoto
 *
 * Modo `--target-url`:
 *   - NO levanta server local. Mide contra la URL pasada (debe responder 200 en /api/health).
 *   - Auth via Supabase admin SDK (`generateLink` magiclink) — el storageState `tests/.auth/owner.json`
 *     local no sirve (cookie domain `.lvh.me` no aplica al host del target).
 *   - Skip de la columna DB ms (no tenemos acceso al log Pino del runtime remoto).
 *   - bundleKB se mide via `transferSize` de los chunks .js cargados por la page (más fiel
 *     que el manifest local).
 *   - Detección automática de subdomain vs path-based access — si el target es `*.vercel.app`
 *     sin custom domain + wildcard, fallback a path-based (`/{slug}/conversations`).
 *
 * Cómo se interpreta el reporte:
 *   - "200ms-like-Flarum" se descompone en TTFB + LCP. Apuntamos a TTFB < 200ms
 *     y LCP < 1500ms en p50.
 *   - Si TTFB es alto y DB query total es alto → cuello DB (connection_limit
 *     o queries N+1).
 *   - Si TTFB es bajo y LCP es alto → cuello bundle/hydration (TipTap, etc.).
 *   - Si First Load JS > 350kB → revisar lazy load de TipTap/Frimousse.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { readFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium, type Browser } from '@playwright/test'

import { E2E_BASELINE_POST_SLUG, E2E_PLACES } from '../../tests/fixtures/e2e-data'
import { storageStateFor } from '../../tests/helpers/playwright-auth'
import {
  REMOTE_ROUTES,
  assertHealthy,
  authenticateAgainstRemote,
  buildRouteUrl as buildRemoteRouteUrl,
  defaultAuthEmail,
  defaultPlaceSlug,
  detectAccessMode,
  isVercelPreviewHost,
  measureRemoteRoute,
  parseTargetUrl,
  type RemoteContext,
  type RemoteRouteMetrics,
} from './measure-perf-remote'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..')

// Usamos el puerto del `.env.local` (default 3000) porque el bundle de
// `next build` bake-ina `NEXT_PUBLIC_APP_DOMAIN` en compile-time. Si corremos
// el server prod en otro puerto, `clientEnv` sigue creyendo que está en 3000
// y el middleware/RSC retornan 404 al hacer subdomain rewrite. Caveat: requiere
// que NO haya un `pnpm dev` corriendo en este puerto. Si lo hay, matalo
// antes de correr `pnpm perf`.
function envPort(): number {
  const dom = process.env.NEXT_PUBLIC_APP_DOMAIN ?? 'lvh.me:3000'
  const m = /:(\d+)$/.exec(dom)
  return m ? Number(m[1]) : 3000
}
const PORT = envPort()
const APP_DOMAIN = process.env.NEXT_PUBLIC_APP_DOMAIN ?? `lvh.me:${PORT}`
const PLACE_SLUG = E2E_PLACES.palermo.slug

const args = process.argv.slice(2)
const flagJson = args.includes('--json')
const routesArg = args.find((a) => a.startsWith('--routes='))?.split('=')[1]
const routesFilter = routesArg ? new Set(routesArg.split(',')) : null
const targetUrlArg = args
  .find((a) => a.startsWith('--target-url='))
  ?.split('=')
  .slice(1)
  .join('=')
const REMOTE_MODE = Boolean(targetUrlArg)

type Route = {
  key: string
  label: string
  buildKey: string // matches build-manifest.json key
  url: (placeSlug: string, postSlug: string) => string
  needsAuth: boolean
  needsPlace: boolean
}

const ROUTES: Route[] = [
  {
    key: 'inbox',
    label: '/inbox',
    buildKey: '/inbox',
    url: () => `http://app.${APP_DOMAIN}/inbox`,
    needsAuth: true,
    needsPlace: false,
  },
  {
    key: 'conversations',
    label: '/{place}/conversations',
    buildKey: '/[placeSlug]/(gated)/conversations',
    url: (place) => `http://${place}.${APP_DOMAIN}/conversations`,
    needsAuth: true,
    needsPlace: true,
  },
  {
    key: 'post-detail',
    label: '/{place}/conversations/{post}',
    buildKey: '/[placeSlug]/(gated)/conversations/[postSlug]',
    url: (place, post) => `http://${place}.${APP_DOMAIN}/conversations/${post}`,
    needsAuth: true,
    needsPlace: true,
  },
  {
    key: 'library',
    label: '/{place}/library',
    buildKey: '/[placeSlug]/(gated)/library',
    url: (place) => `http://${place}.${APP_DOMAIN}/library`,
    needsAuth: true,
    needsPlace: true,
  },
]

const filteredRoutes = routesFilter ? ROUTES.filter((r) => routesFilter.has(r.key)) : ROUTES

type RouteMetrics = {
  key: string
  label: string
  url: string
  bundleKB: number | null
  ttfbMs: number | null
  fcpMs: number | null
  lcpMs: number | null
  tbtMs: number | null
  domContentLoadedMs: number | null
  loadEventMs: number | null
  transferKB: number | null
  prismaQueryCount: number | null
  prismaTotalMs: number | null
  prismaSlowestMs: number | null
}

// ---------------------------------------------------------------
// Capa 1 — bundle sizes desde build manifest
// ---------------------------------------------------------------

async function getRouteSizeKB(buildKey: string): Promise<number | null> {
  // El build-manifest.json del app router NO tiene entries por page exactas;
  // expone main chunks. Para una medición útil leemos el output ya parseado por
  // Next que vive en `.next/app-build-manifest.json`. Si no existe, fallback a
  // null y el reporte lo deja en blanco (no rompe).
  const appManifestPath = path.join(REPO_ROOT, '.next', 'app-build-manifest.json')
  if (!existsSync(appManifestPath)) return null
  const raw = await readFile(appManifestPath, 'utf-8')
  const data = JSON.parse(raw) as { pages?: Record<string, string[]> }
  const chunks = data.pages?.[`${buildKey}/page`]
  if (!chunks) return null

  // Suma del tamaño físico (gzipped) de cada chunk. Para ser fieles al output
  // de `next build` sumamos el .js de cada chunk listado.
  const seen = new Set<string>()
  let totalBytes = 0
  for (const chunk of chunks) {
    if (seen.has(chunk)) continue
    seen.add(chunk)
    const chunkPath = path.join(REPO_ROOT, '.next', chunk)
    if (!existsSync(chunkPath)) continue
    const stat = await import('node:fs/promises').then((m) => m.stat(chunkPath))
    totalBytes += stat.size
  }
  return Math.round((totalBytes / 1024) * 10) / 10
}

// ---------------------------------------------------------------
// Capa 2 — Prisma query log parser
// ---------------------------------------------------------------

/**
 * Parsea las líneas pino-debug emitidas por el server que está corriendo con
 * `PERF_LOG=1`. Cada línea tiene shape JSON con `requestId`, `model`, `action`,
 * `durationMs`, `msg: "prisma query"`. Agrupamos por requestId.
 *
 * Esto no es perfecto: si dos requests parsean al mismo tiempo, sus queries
 * se intercalan. Por eso medimos una page a la vez (sequencial). El requestId
 * inyectado por el middleware (`src/middleware.ts`) discrimina el grupo final.
 */
type PrismaQueryLog = {
  requestId: string | undefined
  model: string | undefined
  action: string | undefined
  durationMs: number
}

function parsePrismaLogs(chunk: string): PrismaQueryLog[] {
  const queries: PrismaQueryLog[] = []

  // Caso 1: JSON puro (pino default sin pretty).
  for (const line of chunk.split('\n')) {
    if (!line.startsWith('{')) continue
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      if (parsed.msg !== 'prisma query') continue
      queries.push({
        requestId: parsed.requestId as string | undefined,
        model: parsed.model as string | undefined,
        action: parsed.action as string | undefined,
        durationMs: Number(parsed.durationMs ?? 0),
      })
    } catch {
      // Ignore — no es JSON válido, probamos regex después.
    }
  }
  if (queries.length > 0) return queries

  // Caso 2: pino-pretty multi-line. Una entry "prisma query" típica viene como:
  //
  //   [16:50:23.123] DEBUG (12345): prisma query
  //       requestId: "abc-123"
  //       model: "Post"
  //       action: "findMany"
  //       durationMs: 42
  //
  // Hacemos regex global sobre el chunk completo capturando los 4 campos en el
  // orden esperado. La granularidad pierde el match si pino-pretty cambia el
  // orden, pero por config default es ese.
  const re =
    /prisma query\s*\n\s*requestId:\s*"?([^"\n]*)"?\s*\n\s*model:\s*"?([^"\n]*)"?\s*\n\s*action:\s*"?([^"\n]*)"?\s*\n\s*durationMs:\s*(\d+)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(chunk)) != null) {
    const [, requestId, model, action, ms] = match
    queries.push({
      requestId: requestId && requestId !== 'undefined' ? requestId : undefined,
      model: model || undefined,
      action: action || undefined,
      durationMs: Number(ms),
    })
  }

  return queries
}

// ---------------------------------------------------------------
// Capa 3 — Playwright performance metrics
// ---------------------------------------------------------------

// Auth via storageState pre-generado por `tests/global-setup.ts` (mismo
// pattern que el E2E suite). El cookie domain `.lvh.me` sirve cualquier puerto,
// así que el storage funciona contra :3100 aunque se generó contra :3001.
// Si los archivos no existen, el script tira hint para correr `pnpm test:e2e`
// (que invoca global-setup) o un seed dedicado.
const OWNER_STORAGE_STATE = storageStateFor('owner')

async function measureRoute(
  browser: Browser,
  route: Route,
  serverLogTail: () => string,
): Promise<RouteMetrics> {
  const ctx = await browser.newContext(route.needsAuth ? { storageState: OWNER_STORAGE_STATE } : {})
  const page = await ctx.newPage()

  // Marker para parsear el log del server después: las queries que emita el
  // request van a vivir entre estas dos snapshots.
  const logBefore = serverLogTail()

  const url = route.url(PLACE_SLUG, E2E_BASELINE_POST_SLUG)
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  if (!response) {
    await ctx.close()
    throw new Error(`[perf] sin response para ${url}`)
  }

  // Espera al LCP. El budget es 5s — si tarda más, lo reportamos como timeout.
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined)

  // Hint para que el log async (pino + middleware Prisma) llegue al stdout
  // antes de que tomemos el snapshot. Sin esto, queries que terminan justo
  // antes del LCP no alcanzan a ser parseadas.
  await sleep(300)

  const metrics = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined
    const fcpEntry = performance
      .getEntriesByType('paint')
      .find((e) => e.name === 'first-contentful-paint')
    const lcpList = performance.getEntriesByType('largest-contentful-paint')
    const lcp = lcpList[lcpList.length - 1] as { startTime?: number } | undefined

    let totalTransfer = 0
    for (const r of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
      totalTransfer += r.transferSize ?? 0
    }
    if (nav) totalTransfer += nav.transferSize ?? 0

    // TBT aproximado: suma de (longTask.duration - 50ms) de todas las long tasks
    // entre FCP y onload. Sin PerformanceObserver con `longtask` activo no hay
    // entries — devolvemos null y lo flageamos en el reporte.
    let tbt: number | null = null
    try {
      const longTasks = performance.getEntriesByType('longtask') as PerformanceEntry[]
      tbt = longTasks.reduce((sum, t) => sum + Math.max(0, t.duration - 50), 0)
    } catch {
      tbt = null
    }

    return {
      ttfbMs: nav ? Math.round(nav.responseStart - nav.requestStart) : null,
      fcpMs: fcpEntry ? Math.round(fcpEntry.startTime) : null,
      lcpMs: lcp?.startTime != null ? Math.round(lcp.startTime) : null,
      tbtMs: tbt,
      domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      loadEventMs: nav ? Math.round(nav.loadEventEnd) : null,
      transferKB: Math.round((totalTransfer / 1024) * 10) / 10,
    }
  })

  await ctx.close()

  // Capa 2 — Prisma queries del request: diff del log del server entre antes y
  // ahora. Filtramos por requestId si es posible; si no, usamos las queries que
  // aparezcan en la ventana temporal (heurística suficiente porque corremos
  // sequencial).
  const logAfter = serverLogTail()
  const newLogChunk = logAfter.slice(logBefore.length)
  if (process.env.PERF_DEBUG === '1') {
    console.log(`[perf-debug] ${route.label} status=${response.status()}`)
    console.log(`[perf-debug] log chunk (${newLogChunk.length} bytes):`)
    console.log(newLogChunk.slice(0, 2000))
  }
  const queries = parsePrismaLogs(newLogChunk)
  const prismaTotalMs = queries.reduce((sum, q) => sum + q.durationMs, 0)
  const prismaSlowestMs = queries.length > 0 ? Math.max(...queries.map((q) => q.durationMs)) : 0

  const bundleKB = await getRouteSizeKB(route.buildKey)

  return {
    key: route.key,
    label: route.label,
    url,
    bundleKB,
    ...metrics,
    prismaQueryCount: queries.length,
    prismaTotalMs: prismaTotalMs > 0 ? prismaTotalMs : null,
    prismaSlowestMs: prismaSlowestMs > 0 ? prismaSlowestMs : null,
  }
}

// ---------------------------------------------------------------
// Orquestador — levanta `pnpm start`, mide, baja todo
// ---------------------------------------------------------------

async function waitForServer(url: string, timeoutMs = 60_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok || res.status === 404) return
    } catch {
      // server aún no escucha
    }
    await sleep(500)
  }
  throw new Error(`[perf] server no respondió en ${url} tras ${timeoutMs}ms`)
}

/**
 * Sanity check antes de medir: si las gated routes retornan 404, el bundle
 * fue compilado con un `NEXT_PUBLIC_APP_DOMAIN` distinto al runtime y el
 * middleware rechaza el host. Abortamos con hint accionable.
 */
async function assertGatedRoutesAccessible(browser: Browser): Promise<void> {
  const ctx = await browser.newContext({ storageState: OWNER_STORAGE_STATE })
  const page = await ctx.newPage()
  const url = `http://${PLACE_SLUG}.${APP_DOMAIN}/conversations`
  const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  const status = res?.status() ?? 0
  await ctx.close()
  if (status === 404) {
    throw new Error(
      `[perf] gated route ${url} retornó 404. Causa probable: bundle compilado con\n` +
        `       NEXT_PUBLIC_APP_DOMAIN distinto al runtime (port mismatch).\n` +
        `       Solución: matá el server de :${PORT} si está corriendo, después\n` +
        '       corré `pnpm build` con .env.local actual y volvé a correr `pnpm perf`.',
    )
  }
  if (status !== 200) {
    throw new Error(
      `[perf] gated route retornó status ${status}. Esperado 200. Verificá que\n` +
        `       el storageState ${OWNER_STORAGE_STATE} tenga una sesión válida\n` +
        '       (regeneralo con `pnpm test:e2e` si la session expiró).',
    )
  }
}

async function startServer(): Promise<{ proc: ChildProcess; tail: () => string }> {
  // `pnpm start` corre el bundle compilado por `next build` (NODE_ENV=production
  // hardcodeado por Next al compilar). Esto NOS DA la medición fiel:
  //   - Bundle JS minificado y optimized.
  //   - Sin overhead de compilación per-request del dev runner.
  //   - Server-side queries con la misma latencia que en Vercel (DB cloud dev).
  //
  // Auth: en lugar del endpoint `/api/test/sign-in` (que el bundle prod cierra
  // por seguridad), usamos `tests/.auth/owner.json` storageState ya generado
  // por `tests/global-setup.ts`. Cookie domain `.lvh.me` sirve cualquier puerto.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PERF_LOG: '1',
    LOG_LEVEL: 'debug',
    PORT: String(PORT),
    NEXT_PUBLIC_APP_URL: `http://app.${APP_DOMAIN}`,
    NEXT_PUBLIC_APP_DOMAIN: APP_DOMAIN,
  }
  const proc = spawn('pnpm', ['start', '--port', String(PORT)], {
    cwd: REPO_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let buffer = ''
  proc.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
  })
  proc.stderr?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
  })

  return { proc, tail: () => buffer }
}

function killServer(proc: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (proc.killed) {
      resolve()
      return
    }
    proc.once('exit', () => resolve())
    proc.kill('SIGTERM')
    setTimeout(() => {
      if (!proc.killed) proc.kill('SIGKILL')
      resolve()
    }, 3_000)
  })
}

// ---------------------------------------------------------------
// Reporte
// ---------------------------------------------------------------

function pad(s: string, n: number): string {
  if (s.length >= n) return s
  return s + ' '.repeat(n - s.length)
}

function formatNum(v: number | null, suffix = ''): string {
  if (v === null) return '   —   '
  return `${v.toString().padStart(5)}${suffix}`
}

function classifyTtfb(v: number | null): string {
  if (v === null) return ' '
  if (v < 200) return '🟢'
  if (v < 500) return '🟡'
  return '🔴'
}
function classifyLcp(v: number | null): string {
  if (v === null) return ' '
  if (v < 1500) return '🟢'
  if (v < 2500) return '🟡'
  return '🔴'
}
function classifyBundle(v: number | null): string {
  if (v === null) return ' '
  if (v < 200) return '🟢'
  if (v < 350) return '🟡'
  return '🔴'
}
function classifyDb(v: number | null): string {
  if (v === null) return ' '
  if (v < 80) return '🟢'
  if (v < 200) return '🟡'
  return '🔴'
}

function printReport(rows: RouteMetrics[] | RemoteRouteMetrics[], remote = false): void {
  if (flagJson) {
    process.stdout.write(JSON.stringify(rows, null, 2) + '\n')
    return
  }

  console.log('\n=== Place perf — measurement summary ===\n')
  console.log(
    'Objective: Flarum-like p50 TTFB <200ms, LCP <1500ms, First Load JS <200kB, DB total <80ms.\n',
  )

  const header = `${pad('Route', 30)}  ${pad('Bundle kB', 11)}  ${pad('TTFB', 8)}  ${pad('FCP', 8)}  ${pad('LCP', 8)}  ${pad('DB ms', 8)}  ${pad('DB n', 5)}  ${pad('Slowest', 9)}`
  console.log(header)
  console.log('-'.repeat(header.length))

  for (const r of rows) {
    // En modo remoto los 3 campos prisma vienen como `null` y no aplica
    // clasificación — mostramos `—` literal y dejamos el classify en blanco.
    const dbCell = remote
      ? `   ${pad('—', 5)}   `
      : `${classifyDb(r.prismaTotalMs)}${formatNum(r.prismaTotalMs, 'ms')} `
    const dbCountCell = remote ? `   ${pad('—', 5)} ` : `   ${formatNum(r.prismaQueryCount)} `
    const dbSlowCell = remote ? `   ${pad('—', 5)}   ` : `   ${formatNum(r.prismaSlowestMs, 'ms')}`
    const line =
      `${pad(r.label, 30)}  ` +
      `${classifyBundle(r.bundleKB)} ${formatNum(r.bundleKB)} ` +
      `${classifyTtfb(r.ttfbMs)}${formatNum(r.ttfbMs, 'ms')} ` +
      `   ${formatNum(r.fcpMs, 'ms')} ` +
      `${classifyLcp(r.lcpMs)}${formatNum(r.lcpMs, 'ms')} ` +
      dbCell +
      dbCountCell +
      dbSlowCell
    console.log(line)
  }

  console.log('\nLeyenda:')
  console.log('  🟢 dentro del objetivo · 🟡 mejorable · 🔴 lejos del objetivo')
  if (remote) {
    console.log(
      '\nNota: DB ms NO se mide contra targets remotos — usar Vercel Function Logs para esa data.',
    )
    console.log(
      'Bundle kB en modo remoto = suma de transferSize de los chunks .js cargados por la page (First Load JS real).',
    )
  } else {
    console.log(
      '\nNota: TTFB+LCP locales son optimistas vs Vercel real (sumá ~30-50ms RTT edge + ~200-500ms cold start primera request por function).',
    )
    console.log(
      'DB ms = suma de durationMs de queries Prisma del request (parsed del log del server con PERF_LOG=1).',
    )
  }
}

// ---------------------------------------------------------------
// Main remoto — `--target-url=...`
// ---------------------------------------------------------------

async function mainRemote(targetUrl: string): Promise<void> {
  const { baseUrl, baseHost } = parseTargetUrl(targetUrl)
  const isVercelPreview = isVercelPreviewHost(baseHost)
  if (isVercelPreview) {
    console.log(
      '[perf] target detectado como `*.vercel.app`. Si NO hay custom domain con wildcard DNS,\n' +
        '       las gated routes en modo subdomain devuelven 404. El script auto-detecta y\n' +
        '       cae a path-based (`/{slug}/conversations`) si aplica.',
    )
  }
  console.log(`[perf] modo remoto: target=${baseUrl}`)

  // Sanity 1: /api/health responde 200.
  console.log('[perf] sanity check: /api/health del target...')
  await assertHealthy(baseUrl)

  // Storage state efímero — sólo persiste durante la corrida. Va a tests/.auth/
  // junto con los locales para no inventar dirs nuevos. Nombre dedicado.
  const authDir = path.resolve(REPO_ROOT, 'tests', '.auth')
  await mkdir(authDir, { recursive: true })
  const remoteStorageStatePath = path.join(authDir, 'perf-remote.json')

  let browser: Browser | null = null
  try {
    browser = await chromium.launch()

    // Auth: magiclink → action_link → callback del target setea cookies.
    console.log(`[perf] auth via Supabase magiclink (email=${defaultAuthEmail()})...`)
    const partialCtx = {
      baseUrl,
      baseHost,
      isVercelPreview,
      storageStatePath: remoteStorageStatePath,
      // accessMode placeholder; se decide después con detectAccessMode.
      accessMode: 'subdomain' as const,
    }
    // generateLink pide accessMode para construir el redirectTo. Empezamos
    // con subdomain (más fiel) y reusamos el storageState para el probe;
    // si después detectamos path mode, las cookies ya van a estar bien
    // porque en path mode usamos el mismo `baseHost`.
    await authenticateAgainstRemote(browser, partialCtx, defaultAuthEmail(), remoteStorageStatePath)

    // Sanity 2 + detección: probar gated route en subdomain → fallback path.
    const accessMode = await detectAccessMode(browser, partialCtx, defaultPlaceSlug())
    const ctx: RemoteContext = { ...partialCtx, accessMode }

    const filteredSpecs = routesFilter
      ? REMOTE_ROUTES.filter((r) => routesFilter.has(r.key))
      : REMOTE_ROUTES

    const rows: RemoteRouteMetrics[] = []
    for (const spec of filteredSpecs) {
      console.log(`[perf] midiendo ${spec.label}...`)
      // Warm-up: cold start del lambda + cache RSC. Sin esto la primera
      // medición incluye 200-500ms extra que invalida el comparativo.
      try {
        const warmCtx = await browser.newContext(
          spec.needsAuth ? { storageState: remoteStorageStatePath } : {},
        )
        const warmPage = await warmCtx.newPage()
        await warmPage.goto(buildRemoteRouteUrl(spec, ctx, defaultPlaceSlug()), {
          waitUntil: 'domcontentloaded',
          timeout: 30_000,
        })
        await warmCtx.close()
      } catch (err) {
        console.warn(`[perf] warm-up falló para ${spec.label}: ${(err as Error).message}`)
      }

      const m = await measureRemoteRoute(browser, spec, ctx, defaultPlaceSlug())
      rows.push(m)
    }

    printReport(rows, true)
  } finally {
    if (browser) await browser.close()
  }
}

// ---------------------------------------------------------------
// Main
// ---------------------------------------------------------------

async function main(): Promise<void> {
  if (REMOTE_MODE && targetUrlArg) {
    await mainRemote(targetUrlArg)
    return
  }

  if (!existsSync(OWNER_STORAGE_STATE)) {
    throw new Error(
      `[perf] storageState faltante: ${OWNER_STORAGE_STATE}\n` +
        '       Regenerá los archivos con `pnpm test:e2e` (corre global-setup) o\n' +
        '       borrá el cache + corré una spec mínima del E2E suite.',
    )
  }
  console.log('[perf] arrancando server prod local en :' + PORT + ' (PERF_LOG=1)...')
  const { proc, tail } = await startServer()

  let browser: Browser | null = null
  try {
    try {
      await waitForServer(`http://app.${APP_DOMAIN}/api/health`)
    } catch (err) {
      console.error('[perf] server log al fallar:\n' + tail().slice(-3000))
      throw err
    }
    console.log('[perf] server listo, lanzando Playwright (Chromium)...')
    browser = await chromium.launch()

    console.log('[perf] sanity check: gated route accesible con sesión...')
    await assertGatedRoutesAccessible(browser)

    const rows: RouteMetrics[] = []
    for (const route of filteredRoutes) {
      console.log(`[perf] midiendo ${route.label}...`)
      // Warm-up: la primera request por route inicializa caches React/Next
      // (RSC payload cache, route segments). Sin warm-up el TTFB de la primera
      // medición incluye ese costo y deja de ser comparable entre routes.
      try {
        const warmCtx = await browser.newContext(
          route.needsAuth ? { storageState: OWNER_STORAGE_STATE } : {},
        )
        const warmPage = await warmCtx.newPage()
        await warmPage.goto(route.url(PLACE_SLUG, E2E_BASELINE_POST_SLUG), {
          waitUntil: 'domcontentloaded',
          timeout: 30_000,
        })
        await warmCtx.close()
      } catch (err) {
        console.warn(`[perf] warm-up falló para ${route.label}: ${(err as Error).message}`)
      }

      const m = await measureRoute(browser, route, tail)
      rows.push(m)
    }

    printReport(rows)
  } finally {
    if (browser) await browser.close()
    await killServer(proc)
  }
}

main().catch((err) => {
  console.error('[perf] FATAL:', err)
  process.exit(1)
})
