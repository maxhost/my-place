import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Webhook } from 'svix'

const findFirst = vi.fn()
const update = vi.fn()

vi.mock('@/db/client', () => ({
  prisma: {
    invitation: {
      findFirst: (...a: unknown[]) => findFirst(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}))

vi.mock('server-only', () => ({}))

// svix `whsec_...` esperado: valor literal en ambos sitios (el mock se hoistea).
const TEST_SECRET = 'whsec_YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFh'

vi.mock('@/shared/config/env', () => ({
  serverEnv: {
    RESEND_WEBHOOK_SECRET: 'whsec_YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFh',
    NODE_ENV: 'test',
  },
}))

import { POST } from '../route'

function sign(body: Record<string, unknown>) {
  const wh = new Webhook(TEST_SECRET)
  const id = `msg_${Math.random().toString(36).slice(2, 10)}`
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const raw = JSON.stringify(body)
  const signature = wh.sign(id, new Date(Number(timestamp) * 1000), raw)
  return {
    id,
    timestamp,
    signature,
    raw,
  }
}

function mkReq(raw: string, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/webhooks/resend', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: raw,
  }) as unknown as Request
}

beforeEach(() => {
  findFirst.mockReset()
  update.mockReset()
  update.mockResolvedValue({})
})

describe('POST /api/webhooks/resend', () => {
  it('400 si faltan headers svix', async () => {
    const res = await POST(mkReq('{}') as never)
    expect(res.status).toBe(400)
  })

  it('400 si firma inválida', async () => {
    const body = { type: 'email.delivered', data: { email_id: 'msg-xyz' } }
    const raw = JSON.stringify(body)
    const res = await POST(
      mkReq(raw, {
        'svix-id': 'fake',
        'svix-timestamp': '0',
        'svix-signature': 'v1,invalidbase64',
      }) as never,
    )
    expect(res.status).toBe(400)
  })

  it('200 con noop para tipo ignorado', async () => {
    const body = { type: 'email.opened', data: { email_id: 'msg-xyz' } }
    const signed = sign(body)
    const res = await POST(
      mkReq(signed.raw, {
        'svix-id': signed.id,
        'svix-timestamp': signed.timestamp,
        'svix-signature': signed.signature,
      }) as never,
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { ignored?: string }
    expect(json.ignored).toBe('email.opened')
    expect(findFirst).not.toHaveBeenCalled()
  })

  it('200 con noop cuando no se encuentra la invitación', async () => {
    findFirst.mockResolvedValue(null)
    const body = { type: 'email.delivered', data: { email_id: 'msg-unknown' } }
    const signed = sign(body)
    const res = await POST(
      mkReq(signed.raw, {
        'svix-id': signed.id,
        'svix-timestamp': signed.timestamp,
        'svix-signature': signed.signature,
      }) as never,
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { noop?: string }
    expect(json.noop).toBe('no_invitation')
    expect(update).not.toHaveBeenCalled()
  })

  it('transiciona SENT → DELIVERED y updatea la row', async () => {
    findFirst.mockResolvedValue({ id: 'inv-1', deliveryStatus: 'SENT' })
    const body = { type: 'email.delivered', data: { email_id: 'msg-1' } }
    const signed = sign(body)
    const res = await POST(
      mkReq(signed.raw, {
        'svix-id': signed.id,
        'svix-timestamp': signed.timestamp,
        'svix-signature': signed.signature,
      }) as never,
    )
    expect(res.status).toBe(200)
    expect(update).toHaveBeenCalledTimes(1)
    const call = update.mock.calls.at(-1)?.[0] as {
      where: { id: string }
      data: Record<string, unknown>
    }
    expect(call.where.id).toBe('inv-1')
    expect(call.data.deliveryStatus).toBe('DELIVERED')
  })

  it('no baja de DELIVERED a SENT (idempotencia de order)', async () => {
    findFirst.mockResolvedValue({ id: 'inv-1', deliveryStatus: 'DELIVERED' })
    const body = { type: 'email.sent', data: { email_id: 'msg-1' } }
    const signed = sign(body)
    const res = await POST(
      mkReq(signed.raw, {
        'svix-id': signed.id,
        'svix-timestamp': signed.timestamp,
        'svix-signature': signed.signature,
      }) as never,
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { noop?: string }
    expect(json.noop).toBe('transition_not_allowed')
    expect(update).not.toHaveBeenCalled()
  })

  it('bounce guarda lastDeliveryError', async () => {
    findFirst.mockResolvedValue({ id: 'inv-1', deliveryStatus: 'SENT' })
    const body = {
      type: 'email.bounced',
      data: {
        email_id: 'msg-1',
        bounce: { message: 'User mailbox does not exist', reason: 'nouser' },
      },
    }
    const signed = sign(body)
    const res = await POST(
      mkReq(signed.raw, {
        'svix-id': signed.id,
        'svix-timestamp': signed.timestamp,
        'svix-signature': signed.signature,
      }) as never,
    )
    expect(res.status).toBe(200)
    const call = update.mock.calls.at(-1)?.[0] as {
      data: { deliveryStatus: string; lastDeliveryError: string }
    }
    expect(call.data.deliveryStatus).toBe('BOUNCED')
    expect(call.data.lastDeliveryError).toBe('User mailbox does not exist')
  })

  it('no revierte BOUNCED aunque llegue email.delivered después', async () => {
    findFirst.mockResolvedValue({ id: 'inv-1', deliveryStatus: 'BOUNCED' })
    const body = { type: 'email.delivered', data: { email_id: 'msg-1' } }
    const signed = sign(body)
    const res = await POST(
      mkReq(signed.raw, {
        'svix-id': signed.id,
        'svix-timestamp': signed.timestamp,
        'svix-signature': signed.signature,
      }) as never,
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { noop?: string }
    expect(json.noop).toBe('transition_not_allowed')
    expect(update).not.toHaveBeenCalled()
  })
})
