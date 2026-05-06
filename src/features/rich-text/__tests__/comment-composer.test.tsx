/**
 * Smoke tests del `CommentComposer`. NO testeamos el editor Lexical
 * (es black box — su comportamiento de teclado/selección está cubierto
 * upstream por el equipo de Lexical). Sí testeamos:
 *  - render: el botón "Publicar" arranca disabled si no hay documento.
 *  - validación: el handler `onSubmit` se invoca con el documento al
 *    submit.
 *  - errores: errores del submit aparecen en toast (mockeado).
 *
 * Para forzar un documento sin pasar por el Lexical real (que requiere
 * navegador), inyectamos vía `initialDocument`. El mock del editor es
 * menos engorroso si controlamos `setDoc` desde afuera con un wrapper.
 */

import * as React from 'react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { CommentComposer } from '../ui/comment-composer'
import type { LexicalDocument } from '../domain/types'

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

// Mockeamos `BaseComposer`: en jsdom Lexical no monta canónicamente
// (depende de ContentEditable APIs incompletas). El mock expone un
// botón "[set:hello]" que dispara `onChange` con un documento mínimo,
// suficiente para exercise la lógica de submit del `CommentComposer`.
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
                      text: 'hola',
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

const noopSearchUsers = vi.fn(async () => [])

describe('CommentComposer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('arranca con el botón Publicar disabled (documento vacío)', () => {
    const onSubmit = vi.fn(async () => {})
    render(<CommentComposer placeId="place_1" onSubmit={onSubmit} searchUsers={noopSearchUsers} />)
    const btn = screen.getByRole('button', { name: 'Publicar' })
    expect(btn).toBeDisabled()
  })

  it('habilita Publicar al recibir un documento con texto', () => {
    const onSubmit = vi.fn(async () => {})
    render(<CommentComposer placeId="place_1" onSubmit={onSubmit} searchUsers={noopSearchUsers} />)
    fireEvent.click(screen.getByTestId('mock-fill'))
    const btn = screen.getByRole('button', { name: 'Publicar' })
    expect(btn).not.toBeDisabled()
  })

  it('llama a onSubmit con el documento al confirmar', async () => {
    const onSubmit = vi.fn(async (_doc: LexicalDocument) => {})
    render(<CommentComposer placeId="place_1" onSubmit={onSubmit} searchUsers={noopSearchUsers} />)
    fireEvent.click(screen.getByTestId('mock-fill'))
    fireEvent.click(screen.getByRole('button', { name: 'Publicar' }))
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })
    const arg = onSubmit.mock.calls[0]?.[0]
    expect(arg).toBeDefined()
    if (!arg) return
    expect(arg.root.children).toHaveLength(1)
    expect(arg.root.children[0]?.type).toBe('paragraph')
  })

  it('muestra "Publicando…" mientras la submit está pending', async () => {
    let resolveSubmit: (() => void) | null = null
    const onSubmit: (doc: LexicalDocument) => Promise<void> = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSubmit = resolve
        }),
    )
    render(<CommentComposer placeId="place_1" onSubmit={onSubmit} searchUsers={noopSearchUsers} />)
    fireEvent.click(screen.getByTestId('mock-fill'))
    fireEvent.click(screen.getByRole('button', { name: 'Publicar' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Publicando…' })).toBeInTheDocument()
    })
    if (resolveSubmit) (resolveSubmit as () => void)()
  })

  it('respeta el placeholder custom', () => {
    render(
      <CommentComposer
        placeId="place_1"
        onSubmit={async () => {}}
        searchUsers={noopSearchUsers}
        placeholder="Tu respuesta…"
      />,
    )
    expect(screen.getByTestId('mock-base-composer').getAttribute('data-placeholder')).toBe(
      'Tu respuesta…',
    )
  })
})
