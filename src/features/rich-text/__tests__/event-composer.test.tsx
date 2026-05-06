import * as React from 'react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { EventComposer } from '../ui/event-composer'
import type { ComposerMentionResolvers } from '../ui/mentions/mention-plugin'
import type { LexicalDocument } from '../domain/types'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('../ui/base-composer', () => ({
  BaseComposer: ({
    onChange,
    placeholder,
  }: {
    onChange: (doc: LexicalDocument) => void
    placeholder?: string
  }) => (
    <div data-testid="mock-base-composer" data-placeholder={placeholder}>
      <button
        type="button"
        data-testid="mock-fill"
        onClick={() =>
          onChange({
            root: {
              type: 'root',
              version: 1,
              format: '',
              indent: 0,
              direction: null,
              children: [
                {
                  type: 'paragraph',
                  version: 1,
                  format: '',
                  indent: 0,
                  direction: null,
                  textFormat: 0,
                  textStyle: '',
                  children: [
                    {
                      type: 'text',
                      version: 1,
                      text: 'descripción',
                      format: 0,
                      detail: 0,
                      mode: 'normal',
                      style: '',
                    },
                  ],
                },
              ],
            },
          })
        }
      >
        fill
      </button>
    </div>
  ),
}))

const resolvers: ComposerMentionResolvers = {
  placeId: 'place_1',
  searchUsers: vi.fn(async () => []),
}

describe('EventComposer', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => cleanup())

  it('emite cambios al parent cuando el editor cambia', () => {
    const onChange = vi.fn<(doc: LexicalDocument | null) => void>()
    render(<EventComposer placeId="place_1" onChange={onChange} composerResolvers={resolvers} />)
    fireEvent.click(screen.getByTestId('mock-fill'))
    expect(onChange).toHaveBeenCalledTimes(1)
    const arg = onChange.mock.calls[0]?.[0]
    expect(arg?.root.children[0]?.type).toBe('paragraph')
  })

  it('respeta el placeholder custom', () => {
    render(
      <EventComposer
        placeId="place_1"
        onChange={() => {}}
        composerResolvers={resolvers}
        placeholder="Algo distinto"
      />,
    )
    expect(screen.getByTestId('mock-base-composer').getAttribute('data-placeholder')).toBe(
      'Algo distinto',
    )
  })
})
