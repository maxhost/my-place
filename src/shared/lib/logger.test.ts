import { describe, it, expect } from 'vitest'
import { Writable } from 'node:stream'
import pino from 'pino'

/**
 * El logger export vive con pretty-transport en dev, que no es capturable por stream.
 * Acá construimos una instancia con el mismo redact para validar la política en isolation.
 */
function buildTestLogger(stream: Writable) {
  return pino(
    {
      level: 'debug',
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
    },
    stream,
  )
}

function capture(fn: (log: pino.Logger) => void): Record<string, unknown> {
  const chunks: string[] = []
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString('utf8'))
      cb()
    },
  })
  fn(buildTestLogger(stream))
  return JSON.parse(chunks.join('').trim())
}

describe('logger redaction', () => {
  it('redacta password en objetos top-level', () => {
    const parsed = capture((log) => log.info({ user: { password: 'hunter2' } }, 'login'))
    expect(parsed.user).toEqual({ password: '[REDACTED]' })
  })

  it('redacta token en objetos anidados', () => {
    const parsed = capture((log) => log.info({ auth: { token: 'super-secret' } }, 'cb'))
    expect(parsed.auth).toEqual({ token: '[REDACTED]' })
  })

  it('redacta cookie y authorization headers', () => {
    const parsed = capture((log) =>
      log.info(
        { req: { headers: { cookie: 'sb-access=xxx', authorization: 'Bearer xyz' } } },
        'req',
      ),
    )
    expect(parsed.req).toEqual({
      headers: { cookie: '[REDACTED]', authorization: '[REDACTED]' },
    })
  })

  it('no afecta campos no sensibles', () => {
    const parsed = capture((log) => log.info({ user: { id: '123', email: 'a@b.com' } }, 'event'))
    expect(parsed.user).toEqual({ id: '123', email: 'a@b.com' })
  })
})
