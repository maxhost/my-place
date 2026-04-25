import { Prisma } from '@prisma/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConflictError } from '@/shared/errors/domain-error'

vi.mock('@/shared/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { createPostFromSystemHelper } from '../server/actions/posts/create-from-system'

type PostCreateArgs = Parameters<Prisma.TransactionClient['post']['create']>[0]
type PostFindManyArgs = Parameters<Prisma.TransactionClient['post']['findMany']>[0]

function makeP2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint', {
    code: 'P2002',
    clientVersion: 'test',
  })
}

function makeMockTx(opts: {
  existingSlugs?: string[]
  createImpl?: (args: PostCreateArgs) => Promise<{ id: string; slug: string }>
}): Prisma.TransactionClient {
  const findMany = vi.fn(async (_args: PostFindManyArgs) => {
    return (opts.existingSlugs ?? []).map((slug) => ({ slug }))
  })
  const create = vi.fn(opts.createImpl ?? (async () => ({ id: 'p1', slug: 'asado' })))
  // Cast acotado: sólo usamos `post.findMany` y `post.create`. El resto de la
  // surface de TransactionClient no nos importa en estos tests.
  return {
    post: { findMany, create },
  } as unknown as Prisma.TransactionClient
}

const baseInput = {
  placeId: 'place-1',
  title: 'Asado del viernes',
  body: { type: 'doc', content: [] } as Prisma.InputJsonValue,
  authorUserId: 'user-1',
  authorSnapshot: { displayName: 'Max', avatarUrl: null } as Prisma.InputJsonValue,
  originSystem: 'event' as const,
  originId: 'evt-1',
}

describe('createPostFromSystemHelper', () => {
  afterEach(() => vi.clearAllMocks())

  it('happy path: crea Post bajo el tx client y retorna { id, slug }', async () => {
    const tx = makeMockTx({
      createImpl: async (args) => ({ id: 'post-1', slug: (args.data as { slug: string }).slug }),
    })

    const result = await createPostFromSystemHelper(tx, baseInput)

    expect(result.id).toBe('post-1')
    expect(result.slug).toBe('asado-del-viernes')
    // Verificá que se llamó al `create` del tx (no al singleton prisma).
    const calls = (tx.post.create as ReturnType<typeof vi.fn>).mock.calls
    expect(calls).toHaveLength(1)
    const firstCall = calls[0]
    if (!firstCall) throw new Error('expected first call')
    const callArgs = firstCall[0] as PostCreateArgs
    expect(callArgs.data).toMatchObject({
      placeId: 'place-1',
      authorUserId: 'user-1',
      title: 'Asado del viernes',
      slug: 'asado-del-viernes',
    })
  })

  it('slug collision: primer P2002 → retry con set fresco devuelve sufijo único', async () => {
    let callsToFindMany = 0
    const tx = {
      post: {
        findMany: vi.fn(async (_args: PostFindManyArgs) => {
          callsToFindMany += 1
          // Primer call: vacío (la base "asado-del-viernes" parece libre).
          // Segundo call (retry): aparece el slug ya tomado, fuerza sufijo -2.
          if (callsToFindMany === 1) return []
          return [{ slug: 'asado-del-viernes' }]
        }),
        create: vi
          .fn()
          .mockRejectedValueOnce(makeP2002())
          .mockImplementationOnce(async (args: PostCreateArgs) => ({
            id: 'post-2',
            slug: (args.data as { slug: string }).slug,
          })),
      },
    } as unknown as Prisma.TransactionClient

    const result = await createPostFromSystemHelper(tx, baseInput)

    expect(result.id).toBe('post-2')
    expect(result.slug).toBe('asado-del-viernes-2')
    expect((tx.post.create as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2)
  })

  it('segunda colisión consecutiva → ConflictError (no propaga P2002 crudo)', async () => {
    const tx = {
      post: {
        findMany: vi.fn(async (_args: PostFindManyArgs) => []),
        create: vi.fn().mockRejectedValue(makeP2002()),
      },
    } as unknown as Prisma.TransactionClient

    await expect(createPostFromSystemHelper(tx, baseInput)).rejects.toThrow(ConflictError)
    await expect(createPostFromSystemHelper(tx, baseInput)).rejects.toThrow(/URL única/)
  })
})
