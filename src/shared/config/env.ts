import { z } from 'zod'

/**
 * Validación de variables de entorno al boot.
 * Fail fast: si falta algo, la app no arranca.
 *
 * Dos schemas separados:
 * - `serverEnv`: todo lo server-side. Incluye secrets.
 * - `clientEnv`: solo las NEXT_PUBLIC_*. Safe para bundle cliente.
 */

const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Supabase
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // Database
  // DATABASE_URL: pooler (Supavisor) en transaction mode (puerto 6543) para runtime.
  // DIRECT_URL: session mode (puerto 5432) para migraciones Prisma.
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url(),

  // Stripe (opcionales en dev local sin billing). Obligatorios en prod.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_CONNECT_CLIENT_ID: z.string().optional(),

  // Resend (mailer primario para invitaciones y futuros emails transaccionales).
  // En dev local sin `RESEND_API_KEY`, el `mailer/provider.ts` cae a `FakeMailer`
  // — loguea el URL del email a stdout y guarda el payload en memoria para debug.
  // En `NODE_ENV=production` sin key la app crashea al boot (superRefine abajo).
  RESEND_API_KEY: z.string().startsWith('re_').optional(),
  // Display name + dirección. Ej: "Place <hola@ogas.ar>". El dominio debe estar
  // verificado en Resend dashboard (SPF + DKIM + DMARC). Ver CLAUDE.md § Gotchas.
  EMAIL_FROM: z.string().min(1).optional(),
  // Secret del webhook de Resend (formato svix `whsec_...`). Usado para verificar
  // firmas en `/api/webhooks/resend`.
  RESEND_WEBHOOK_SECRET: z.string().min(1).optional(),

  // HMAC secret para firmar edit-session tokens (ver
  // `shared/lib/edit-session-token.ts`). Permite que una edición que se abrió
  // dentro de la ventana de 60s pueda guardarse aunque se tarde un poco más.
  // Mínimo 32 chars. En prod es obligatoria; en dev cae a un placeholder
  // warn-only para no romper el boot local.
  APP_EDIT_SESSION_SECRET: z.string().min(32).optional(),

  // Secret para gatear `POST /api/test/sign-in`. Sólo usado en `NODE_ENV !== 'production'`.
  // Valor aleatorio >= 24 chars (ej: `openssl rand -hex 32`). Si está ausente en dev, el
  // endpoint responde 404 (no se puede usar). En prod siempre ignorado — el gate primario
  // del handler es `NODE_ENV === 'production'` → 404.
  E2E_TEST_SECRET: z.string().min(24).optional(),

  // Feature flag de rollback del broadcast de comentarios en realtime (C.J).
  // Default: broadcast habilitado. Setear `'false'` desactiva la emisión —
  // consumido por `broadcastNewComment` en `features/discussions/server/realtime.ts`.
  // Ver ADR `docs/decisions/2026-04-21-shared-realtime-module.md`.
  DISCUSSIONS_BROADCAST_ENABLED: z.enum(['true', 'false']).optional(),

  // Override del nivel de log de pino. Default `debug` en dev, `info` en prod.
  // Consumido por `shared/lib/logger.ts`. Valores válidos = niveles estándar pino.
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
})

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NEXT_PUBLIC_APP_DOMAIN: z.string().min(1),
})

function parseOrThrow<T extends z.ZodTypeAny>(
  schema: T,
  input: Record<string, unknown>,
  label: string,
): z.infer<T> {
  const result = schema.safeParse(input)
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  · ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(
      `[env] ${label} invalid:\n${issues}\n\nRevisá .env.local contra .env.example (docs/stack.md).`,
    )
  }
  return result.data
}

/**
 * Server-only. Importar SOLO desde server components, server actions,
 * route handlers o código bajo `src/features/*\/server/`.
 *
 * El parseo se hace lazy vía Proxy: si un Client Component importa
 * `env.ts` (por cadena, ej: `supabase/browser.ts` → `clientEnv`), el
 * bundle del cliente no dispara el parse de `serverEnv` hasta acceder
 * a una propiedad — cosa que solo hace código server. En server, la
 * primera lectura cachea para requests siguientes.
 */
type ServerEnv = z.infer<typeof serverSchema> & z.infer<typeof clientSchema>

let _serverEnvCache: ServerEnv | null = null

export const serverEnv = new Proxy({} as ServerEnv, {
  get(_, prop: string | symbol) {
    if (!_serverEnvCache) {
      _serverEnvCache = parseOrThrow(
        serverSchema.merge(clientSchema),
        process.env as Record<string, unknown>,
        'server env',
      )
      assertProductionMailerConfig(_serverEnvCache)
    }
    return _serverEnvCache[prop as keyof ServerEnv]
  },
})

/**
 * En prod, los tres settings de Resend son obligatorios. En dev/test pueden
 * faltar (el factory de mailer cae a `FakeMailer`). No se valida con `superRefine`
 * porque eso convertiría `serverSchema` en `ZodEffects` y rompería `.merge()`.
 */
function assertProductionMailerConfig(env: ServerEnv): void {
  if (env.NODE_ENV !== 'production') return
  const missing: string[] = []
  if (!env.RESEND_API_KEY) missing.push('RESEND_API_KEY')
  if (!env.EMAIL_FROM) missing.push('EMAIL_FROM')
  if (!env.RESEND_WEBHOOK_SECRET) missing.push('RESEND_WEBHOOK_SECRET')
  if (!env.APP_EDIT_SESSION_SECRET) missing.push('APP_EDIT_SESSION_SECRET')
  if (missing.length > 0) {
    throw new Error(
      `[env] server env invalid (production):\n${missing.map((k) => `  · ${k}: Required`).join('\n')}`,
    )
  }
}

/**
 * Client-safe. Importable desde cualquier lado. Solo contiene NEXT_PUBLIC_*.
 * Next.js inlinea estas variables en el bundle cliente en build time.
 */
export const clientEnv = parseOrThrow(
  clientSchema,
  {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_APP_DOMAIN: process.env.NEXT_PUBLIC_APP_DOMAIN,
  },
  'client env',
)
