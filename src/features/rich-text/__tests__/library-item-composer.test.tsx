import * as React from 'react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { LibraryItemComposer } from '../ui/library-item-composer'
import type { ComposerMentionResolvers } from '../ui/mentions/mention-plugin'
import type { LexicalDocument } from '../domain/types'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock('../ui/base-composer', () => ({
  BaseComposer: ({ onChange }: { onChange: (doc: LexicalDocument) => void }) => (
    <div data-testid="mock-base-composer">
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
                      text: 'cuerpo',
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

const enabledEmbeds = { youtube: true, spotify: true, applePodcasts: true, ivoox: true }

describe('LibraryItemComposer', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => cleanup())

  it('renderiza el botón Guardar disabled hasta que hay body', () => {
    render(
      <LibraryItemComposer
        placeId="place_1"
        onSubmit={async () => {}}
        composerResolvers={resolvers}
        enabledEmbeds={enabledEmbeds}
      />,
    )
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
  })

  it('habilita Guardar al recibir un body válido', () => {
    render(
      <LibraryItemComposer
        placeId="place_1"
        onSubmit={async () => {}}
        composerResolvers={resolvers}
        enabledEmbeds={enabledEmbeds}
      />,
    )
    fireEvent.click(screen.getByTestId('mock-fill'))
    expect(screen.getByRole('button', { name: 'Guardar' })).not.toBeDisabled()
  })

  it('llama onSubmit con el body al confirmar', async () => {
    const onSubmit = vi.fn(async () => {})
    render(
      <LibraryItemComposer
        placeId="place_1"
        onSubmit={onSubmit}
        composerResolvers={resolvers}
        enabledEmbeds={enabledEmbeds}
      />,
    )
    fireEvent.click(screen.getByTestId('mock-fill'))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
  })

  it('en modo `showSubmit=false` no renderiza el botón propio', () => {
    render(
      <LibraryItemComposer
        placeId="place_1"
        onSubmit={async () => {}}
        composerResolvers={resolvers}
        enabledEmbeds={enabledEmbeds}
        showSubmit={false}
        onChange={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Guardar' })).toBeNull()
  })
})
