/**
 * Smoke tests del `PostComposer`. Mockeamos `BaseComposer` (Lexical en
 * jsdom no monta canónico), exponemos un botón `[mock-fill]` que dispara
 * `onChange` con un AST mínimo. Validamos:
 *  - render: input título + botón Publicar disabled inicialmente.
 *  - habilitación: con título válido + body, Publicar pasa a enabled.
 *  - submit: invoca `onSubmit` con `{ title, body }` esperados.
 */

import * as React from 'react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { PostComposer } from '../ui/post-composer'
import type { ComposerMentionResolvers } from '../ui/mentions/mention-plugin'
import type { LexicalDocument } from '../domain/types'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

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
        onClick={() => {
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
                      text: 'cuerpo de la conversación',
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
        }}
      >
        fill
      </button>
    </div>
  ),
}))

const noopResolvers: ComposerMentionResolvers = {
  placeId: 'place_1',
  searchUsers: vi.fn(async () => []),
  searchEvents: vi.fn(async () => []),
  listCategories: vi.fn(async () => []),
  searchLibraryItems: vi.fn(async () => []),
}

const enabledEmbeds = { youtube: true, spotify: true, applePodcasts: true, ivoox: true }

describe('PostComposer', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => cleanup())

  it('renderiza input de título + composer + botón Publicar', () => {
    render(
      <PostComposer
        placeId="place_1"
        onSubmit={async () => {}}
        composerResolvers={noopResolvers}
        enabledEmbeds={enabledEmbeds}
      />,
    )
    expect(screen.getByTestId('mock-base-composer')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Publicar' })).toBeDisabled()
  })

  it('Publicar disabled si el título es muy corto', () => {
    render(
      <PostComposer
        placeId="place_1"
        onSubmit={async () => {}}
        composerResolvers={noopResolvers}
        enabledEmbeds={enabledEmbeds}
      />,
    )
    fireEvent.click(screen.getByTestId('mock-fill'))
    fireEvent.change(screen.getByDisplayValue(''), { target: { value: 'hi' } })
    expect(screen.getByRole('button', { name: 'Publicar' })).toBeDisabled()
  })

  it('habilita Publicar cuando título y body son válidos', () => {
    render(
      <PostComposer
        placeId="place_1"
        onSubmit={async () => {}}
        composerResolvers={noopResolvers}
        enabledEmbeds={enabledEmbeds}
      />,
    )
    fireEvent.click(screen.getByTestId('mock-fill'))
    fireEvent.change(screen.getByDisplayValue(''), {
      target: { value: 'Mi nueva conversación' },
    })
    expect(screen.getByRole('button', { name: 'Publicar' })).not.toBeDisabled()
  })

  it('llama onSubmit con title trimmeado + body', async () => {
    const onSubmit = vi.fn(async (_data: { title: string; body: LexicalDocument }) => {})
    render(
      <PostComposer
        placeId="place_1"
        onSubmit={onSubmit}
        composerResolvers={noopResolvers}
        enabledEmbeds={enabledEmbeds}
      />,
    )
    fireEvent.click(screen.getByTestId('mock-fill'))
    fireEvent.change(screen.getByDisplayValue(''), {
      target: { value: '  Mi conversación  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Publicar' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const calls = onSubmit.mock.calls
    expect(calls.length).toBeGreaterThan(0)
    const arg = calls[0]?.[0]
    expect(arg).toBeDefined()
    if (!arg) return
    expect(arg.title).toBe('Mi conversación')
    expect(arg.body.root.children[0]?.type).toBe('paragraph')
  })
})
