import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// vi.hoisted: declarar mocks que se hoistean junto con vi.mock.
const { createMock, errorMock } = vi.hoisted(() => ({
  createMock: vi.fn().mockResolvedValue({ id: 'fake-uuid' }),
  errorMock: vi.fn(),
}))

vi.mock('@/db/client', () => ({
  prisma: { diagnosticLog: { create: createMock } },
}))

vi.mock('@/shared/lib/logger', () => ({
  logger: { error: errorMock, warn: vi.fn(), info: vi.fn() },
}))

import { logDiag } from '../log'

const baseContext = {
  traceId: 'trace-abc',
  host: 'app.place.community',
  path: '/inbox',
  method: 'GET',
}

beforeEach(() => {
  createMock.mockClear()
  errorMock.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('logDiag', () => {
  it('escribe a prisma.diagnosticLog.create con los campos esperados', async () => {
    logDiag('mw_entry', { sample: 'payload' }, baseContext, 'info')

    // logDiag usa setImmediate; await un macrotask para que corra.
    await new Promise<void>((r) => setImmediate(r))
    await new Promise<void>((r) => setImmediate(r))

    expect(createMock).toHaveBeenCalledTimes(1)
    expect(createMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event: 'mw_entry',
        severity: 'info',
        traceId: 'trace-abc',
        host: 'app.place.community',
        path: '/inbox',
        method: 'GET',
        userId: null,
        sessionState: null,
        cookieNames: [],
        userAgent: null,
        ipPrefix: null,
        payload: { sample: 'payload' },
      }),
    })
  })

  it('default severity es "info" cuando se omite', async () => {
    logDiag('logout_success', {}, baseContext)
    await new Promise<void>((r) => setImmediate(r))
    await new Promise<void>((r) => setImmediate(r))
    expect(createMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ severity: 'info' }),
    })
  })

  it('propaga campos opcionales del context', async () => {
    logDiag(
      'cb_invite_success',
      { redirect: '/inbox' },
      {
        ...baseContext,
        userId: 'user-123',
        sessionState: 'present',
        cookieNames: ['sb-abc-auth-token'],
        userAgent: 'Mozilla/5.0 ...',
        ipPrefix: '1.2.3.x',
      },
    )
    await new Promise<void>((r) => setImmediate(r))
    await new Promise<void>((r) => setImmediate(r))
    expect(createMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-123',
        sessionState: 'present',
        cookieNames: ['sb-abc-auth-token'],
        userAgent: 'Mozilla/5.0 ...',
        ipPrefix: '1.2.3.x',
      }),
    })
  })

  it('NO throwea cuando prisma.create rechaza (failure-isolated)', async () => {
    createMock.mockRejectedValueOnce(new Error('db down'))
    expect(() => logDiag('mw_entry', {}, baseContext)).not.toThrow()
    // Esperar que el insert async termine + el catch corra.
    await new Promise<void>((r) => setImmediate(r))
    await new Promise<void>((r) => setImmediate(r))
    await new Promise<void>((r) => setImmediate(r))
    expect(errorMock).toHaveBeenCalledTimes(1)
    expect(errorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'diag_log_write_failed',
        originalEvent: 'mw_entry',
      }),
      expect.any(String),
    )
  })

  it('es fire-and-forget: retorna void sin esperar al insert', () => {
    const result = logDiag('mw_entry', {}, baseContext)
    expect(result).toBeUndefined()
    // En este tick, el create todavía NO corrió (lo encola setImmediate).
    expect(createMock).not.toHaveBeenCalled()
  })
})
