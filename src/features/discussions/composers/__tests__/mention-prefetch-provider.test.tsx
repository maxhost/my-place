import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { useMentionPrefetchSource } from '@/features/rich-text/mentions/public'

vi.mock('@/features/members/public', () => ({
  searchMembersByPlaceAction: vi.fn(async (_placeId: string, _q: string) => [
    { userId: 'u1', displayName: 'Ada', handle: null },
  ]),
}))
vi.mock('@/features/events/public', () => ({
  searchEventsByPlaceAction: vi.fn(async (_placeId: string, _q: string) => [
    { eventId: 'e1', title: 'Ev', startsAt: '2026-01-01T00:00:00Z' },
  ]),
}))
vi.mock('@/features/library/public', () => ({
  listLibraryCategoriesForMentionAction: vi.fn(async (_placeId: string) => [
    { categoryId: 'c1', slug: 'general', name: 'General' },
  ]),
}))

import { MentionPrefetchProvider } from '../mention-prefetch-provider'

function Probe(): React.ReactNode {
  const v = useMentionPrefetchSource()
  return (
    <div data-testid="probe">
      {JSON.stringify({
        users: v?.users?.length ?? 'null',
        events: v?.events?.length ?? 'null',
        categories: v?.categories?.length ?? 'null',
        last: v?.lastFetchedAt !== null && v?.lastFetchedAt !== undefined,
      })}
    </div>
  )
}

describe('MentionPrefetchProvider', () => {
  beforeEach(() => {
    // jsdom no implementa requestIdleCallback — el Provider cae al
    // fallback setTimeout(100), exactamente lo que queremos testear acá.
    vi.stubGlobal('requestIdleCallback', undefined as unknown as Window['requestIdleCallback'])
  })

  it('popula users + events + categories + lastFetchedAt tras el setTimeout(100) fallback', async () => {
    const { getByTestId } = render(
      <MentionPrefetchProvider placeId="p-1">
        <Probe />
      </MentionPrefetchProvider>,
    )
    // Estado inicial: todo null.
    expect(getByTestId('probe').textContent).toContain('"users":"null"')

    await waitFor(
      () => {
        expect(getByTestId('probe').textContent).toContain('"users":1')
      },
      { timeout: 1500 },
    )
    expect(getByTestId('probe').textContent).toContain('"events":1')
    expect(getByTestId('probe').textContent).toContain('"categories":1')
    expect(getByTestId('probe').textContent).toContain('"last":true')
  })

  it('cleanup: cancela el setInterval al desmontar (no memory leak)', () => {
    const clearSpy = vi.spyOn(global, 'clearInterval')
    const { unmount } = render(
      <MentionPrefetchProvider placeId="p-2">
        <Probe />
      </MentionPrefetchProvider>,
    )
    unmount()
    expect(clearSpy).toHaveBeenCalled()
  })
})
