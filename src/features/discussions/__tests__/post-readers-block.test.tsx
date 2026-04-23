import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { listReadersByPostMock, findOrCreateCurrentOpeningMock } = vi.hoisted(() => ({
  listReadersByPostMock: vi.fn(),
  findOrCreateCurrentOpeningMock: vi.fn(),
}))

vi.mock('server-only', () => ({}))

vi.mock('../server/queries', () => ({
  listReadersByPost: listReadersByPostMock,
}))

vi.mock('../server/place-opening', () => ({
  findOrCreateCurrentOpening: findOrCreateCurrentOpeningMock,
}))

// Next.js Link se mockea a un <a> simple para poder aserci­onar props en el DOM.
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    prefetch,
    ...rest
  }: {
    children: React.ReactNode
    href: string
    prefetch?: boolean
  } & Record<string, unknown>) => (
    <a href={href} data-prefetch={String(prefetch)} {...rest}>
      {children}
    </a>
  ),
}))

import { PostReadersBlock } from '../ui/post-readers-block'

function makeReader(
  overrides: Partial<{
    userId: string
    displayName: string
    avatarUrl: string | null
    readAt: Date
  }> = {},
) {
  return {
    userId: overrides.userId ?? 'u-1',
    displayName: overrides.displayName ?? 'Max',
    avatarUrl: overrides.avatarUrl ?? null,
    readAt: overrides.readAt ?? new Date('2026-04-22T20:00:00Z'),
  }
}

async function renderBlock(props?: Partial<React.ComponentProps<typeof PostReadersBlock>>) {
  const rendered = await PostReadersBlock({
    postId: 'post-1',
    placeId: 'place-1',
    placeSlug: 'the-place',
    viewerUserId: 'viewer-1',
    ...props,
  })
  return render(<>{rendered}</>)
}

describe('PostReadersBlock', () => {
  beforeEach(() => {
    listReadersByPostMock.mockReset()
    findOrCreateCurrentOpeningMock.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('retorna null cuando no hay apertura actual (place unconfigured)', async () => {
    findOrCreateCurrentOpeningMock.mockResolvedValue(null)
    const { container } = await renderBlock()
    expect(container).toBeEmptyDOMElement()
    expect(listReadersByPostMock).not.toHaveBeenCalled()
  })

  it('retorna null cuando no hay lectores en la apertura actual', async () => {
    findOrCreateCurrentOpeningMock.mockResolvedValue({
      id: 'opening-1',
      startAt: new Date(),
      endAt: null,
    })
    listReadersByPostMock.mockResolvedValue([])
    const { container } = await renderBlock()
    expect(container).toBeEmptyDOMElement()
  })

  it('rendea lista con avatares hasta 8 + overflow "+N más"', async () => {
    findOrCreateCurrentOpeningMock.mockResolvedValue({
      id: 'opening-1',
      startAt: new Date(),
      endAt: null,
    })
    listReadersByPostMock.mockResolvedValue(
      Array.from({ length: 10 }).map((_, i) =>
        makeReader({ userId: `u-${i}`, displayName: `User ${i}` }),
      ),
    )
    await renderBlock()

    const list = screen.getByLabelText('Lectores de la apertura')
    expect(list).toBeInTheDocument()
    // 8 visibles + overflow "+2 más"
    const links = list.querySelectorAll('a')
    expect(links).toHaveLength(8)
    expect(screen.getByText('+2 más')).toBeInTheDocument()
  })

  it('sin overflow cuando hay ≤8 lectores', async () => {
    findOrCreateCurrentOpeningMock.mockResolvedValue({
      id: 'opening-1',
      startAt: new Date(),
      endAt: null,
    })
    listReadersByPostMock.mockResolvedValue([
      makeReader({ userId: 'u-1', displayName: 'Max' }),
      makeReader({ userId: 'u-2', displayName: 'Lucía' }),
    ])
    await renderBlock()

    expect(screen.queryByText(/\+\d+ más/)).not.toBeInTheDocument()
  })

  it('cada lector es link a /m/<userId> con prefetch=false y aria-label', async () => {
    findOrCreateCurrentOpeningMock.mockResolvedValue({
      id: 'opening-1',
      startAt: new Date(),
      endAt: null,
    })
    listReadersByPostMock.mockResolvedValue([makeReader({ userId: 'u-abc', displayName: 'Lucía' })])
    await renderBlock()

    const link = screen.getByRole('link', { name: 'Lucía' })
    expect(link).toHaveAttribute('href', '/m/u-abc')
    expect(link).toHaveAttribute('data-prefetch', 'false')
  })

  it('avatar con URL: <img> con alt + title = displayName', async () => {
    findOrCreateCurrentOpeningMock.mockResolvedValue({
      id: 'opening-1',
      startAt: new Date(),
      endAt: null,
    })
    listReadersByPostMock.mockResolvedValue([
      makeReader({
        userId: 'u-1',
        displayName: 'Max',
        avatarUrl: 'https://cdn/a.png',
      }),
    ])
    await renderBlock()

    const img = screen.getByAltText('Max') as HTMLImageElement
    expect(img.src).toBe('https://cdn/a.png')
    expect(img.title).toBe('Max')
  })

  it('avatar sin URL: inicial del displayName', async () => {
    findOrCreateCurrentOpeningMock.mockResolvedValue({
      id: 'opening-1',
      startAt: new Date(),
      endAt: null,
    })
    listReadersByPostMock.mockResolvedValue([
      makeReader({ userId: 'u-1', displayName: 'lucía', avatarUrl: null }),
    ])
    await renderBlock()

    expect(screen.getByText('L')).toBeInTheDocument()
  })

  it('pasa excludeUserId = viewerUserId al query', async () => {
    findOrCreateCurrentOpeningMock.mockResolvedValue({
      id: 'opening-42',
      startAt: new Date(),
      endAt: null,
    })
    listReadersByPostMock.mockResolvedValue([])
    await renderBlock({ viewerUserId: 'viewer-xyz', postId: 'post-zz', placeId: 'place-zz' })

    expect(listReadersByPostMock).toHaveBeenCalledWith({
      postId: 'post-zz',
      placeId: 'place-zz',
      placeOpeningId: 'opening-42',
      excludeUserId: 'viewer-xyz',
    })
  })

  it('label visible "Leyeron:" junto a los avatares', async () => {
    findOrCreateCurrentOpeningMock.mockResolvedValue({
      id: 'opening-1',
      startAt: new Date(),
      endAt: null,
    })
    listReadersByPostMock.mockResolvedValue([makeReader()])
    await renderBlock()

    expect(screen.getByText('Leyeron:')).toBeInTheDocument()
  })
})
