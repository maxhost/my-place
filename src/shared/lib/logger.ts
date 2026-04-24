import pino from 'pino'

/**
 * Logger estructurado.
 * Pretty en dev, JSON en prod. Redacta keys sensibles por default.
 *
 * `LOG_LEVEL` se lee vía `process.env` directo (no `serverEnv`) a
 * propósito: el logger se importa desde tests que mockean env pero no
 * siempre el `serverEnv` Proxy, y forzar el parse eager vía Proxy
 * rompería decenas de test files. La validación Zod del valor sigue
 * activa a nivel del schema en `shared/config/env.ts` — cualquier boot
 * server-side dispara el parse cuando otro código accede a `serverEnv`.
 */
const isDev = process.env.NODE_ENV !== 'production'

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.token',
      '*.secret',
      '*.service_role_key',
      '*.serviceRoleKey',
      '*.stripeSecretKey',
      '*.stripeWebhookSecret',
    ],
    censor: '[REDACTED]',
  },
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l' },
        },
      }
    : {}),
})
