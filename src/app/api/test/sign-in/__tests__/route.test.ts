import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const generateLink = vi.fn()
const verifyOtp = vi.fn()
const userUpsert = vi.fn()

vi.mock('@/shared/lib/supabase/admin', () => ({
  createSupabaseAdmin: () => ({
    auth: { admin: { generateLink: (...a: unknown[]) => generateLink(...a) } },
  }),
}))

vi.mock('@/shared/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({
    auth: { verifyOtp: (...a: unknown[]) => verifyOtp(...a) },
  }),
}))

vi.mock('@/db/client', () => ({
  prisma: {
    user: {
      upsert: (...a: unknown[]) => userUpsert(...a),
    },
  },
}))

vi.mock('server-only', () => ({}))

const TEST_SECRET = 'a'.repeat(32)

function mkReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/test/sign-in', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }) as unknown as Request
}

beforeEach(() => {
  generateLink.mockReset()
  verifyOtp.mockReset()
  userUpsert.mockReset()
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('E2E_TEST_SECRET', TEST_SECRET)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('POST /api/test/sign-in', () => {
  it('devuelve 404 en production sin leer body ni llamar Supabase', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { POST } = await import('../route')
    const res = await POST(
      mkReq({ email: 'whoever@example.com' }, { 'x-test-secret': TEST_SECRET }),
    )
    expect(res.status).toBe(404)
    expect(generateLink).not.toHaveBeenCalled()
    expect(verifyOtp).not.toHaveBeenCalled()
    expect(userUpsert).not.toHaveBeenCalled()
  })

  it('devuelve 404 sin header x-test-secret', async () => {
    const { POST } = await import('../route')
    const res = await POST(mkReq({ email: 'whoever@example.com' }))
    expect(res.status).toBe(404)
    expect(generateLink).not.toHaveBeenCalled()
  })

  it('devuelve 404 con x-test-secret incorrecto (no 401, evita enumeración)', async () => {
    const { POST } = await import('../route')
    const res = await POST(
      mkReq({ email: 'whoever@example.com' }, { 'x-test-secret': 'wrong-value' }),
    )
    expect(res.status).toBe(404)
    expect(generateLink).not.toHaveBeenCalled()
  })

  it('devuelve 404 si E2E_TEST_SECRET no está configurado', async () => {
    vi.stubEnv('E2E_TEST_SECRET', '')
    const { POST } = await import('../route')
    const res = await POST(mkReq({ email: 'whoever@example.com' }, { 'x-test-secret': 'anything' }))
    expect(res.status).toBe(404)
  })

  it('devuelve 400 si body no es JSON válido', async () => {
    const req = new Request('http://localhost/api/test/sign-in', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-secret': TEST_SECRET },
      body: 'not json',
    })
    const { POST } = await import('../route')
    const res = await POST(req as unknown as Request)
    expect(res.status).toBe(400)
  })

  it('devuelve 400 si falta email', async () => {
    const { POST } = await import('../route')
    const res = await POST(mkReq({}, { 'x-test-secret': TEST_SECRET }))
    expect(res.status).toBe(400)
  })

  it('firma OK: llama generateLink + verifyOtp + upsert y devuelve 200', async () => {
    generateLink.mockResolvedValue({
      data: {
        user: { id: 'user-uuid-123', email: 'e2e-owner@e2e.place.local' },
        properties: { hashed_token: 'hashed-token-abc' },
      },
      error: null,
    })
    verifyOtp.mockResolvedValue({
      data: { user: { id: 'user-uuid-123', email: 'e2e-owner@e2e.place.local' } },
      error: null,
    })
    userUpsert.mockResolvedValue({})

    const { POST } = await import('../route')
    const res = await POST(
      mkReq({ email: 'e2e-owner@e2e.place.local' }, { 'x-test-secret': TEST_SECRET }),
    )
    expect(res.status).toBe(200)
    expect(generateLink).toHaveBeenCalledWith({
      type: 'magiclink',
      email: 'e2e-owner@e2e.place.local',
    })
    expect(verifyOtp).toHaveBeenCalledWith({
      token_hash: 'hashed-token-abc',
      type: 'magiclink',
    })
    expect(userUpsert).toHaveBeenCalledTimes(1)
    const body = (await res.json()) as { ok: boolean; userId: string }
    expect(body.ok).toBe(true)
    expect(body.userId).toBe('user-uuid-123')
  })

  it('devuelve 500 si generateLink falla', async () => {
    generateLink.mockResolvedValue({ data: null, error: { message: 'boom' } })

    const { POST } = await import('../route')
    const res = await POST(
      mkReq({ email: 'e2e-owner@e2e.place.local' }, { 'x-test-secret': TEST_SECRET }),
    )
    expect(res.status).toBe(500)
    expect(verifyOtp).not.toHaveBeenCalled()
  })

  it('devuelve 500 si verifyOtp falla', async () => {
    generateLink.mockResolvedValue({
      data: { properties: { hashed_token: 'hashed-token-abc' } },
      error: null,
    })
    verifyOtp.mockResolvedValue({ data: null, error: { message: 'boom' } })

    const { POST } = await import('../route')
    const res = await POST(
      mkReq({ email: 'e2e-owner@e2e.place.local' }, { 'x-test-secret': TEST_SECRET }),
    )
    expect(res.status).toBe(500)
    expect(userUpsert).not.toHaveBeenCalled()
  })
})
