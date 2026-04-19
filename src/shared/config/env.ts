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
 */
export const serverEnv = parseOrThrow(
  serverSchema.merge(clientSchema),
  process.env as Record<string, unknown>,
  'server env',
)

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
