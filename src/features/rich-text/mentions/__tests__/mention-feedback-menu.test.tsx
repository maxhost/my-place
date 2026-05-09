import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { MentionFeedbackMenu } from '../ui/mention-feedback-menu'

// Trigger type es interno al plugin; el test arma valores compatibles
// con la unión `Trigger` mediante casts. El componente sólo lee `kind`.
type TriggerLike =
  | { kind: 'user'; query: string }
  | { kind: 'event'; query: string }
  | { kind: 'library-category'; query: string }
  | { kind: 'library-item'; categorySlug: string; query: string }

function asTrigger(t: TriggerLike): Parameters<typeof MentionFeedbackMenu>[0]['trigger'] {
  return t as Parameters<typeof MentionFeedbackMenu>[0]['trigger']
}

function feedbackText(container: HTMLElement, kind: 'loading' | 'error'): string {
  const root = container.querySelector(`[data-mention-feedback="${kind}"]`)
  if (!root) throw new Error(`no element with data-mention-feedback=${kind}`)
  return root.textContent ?? ''
}

describe('MentionFeedbackMenu', () => {
  it('loading + user → spinner + "Buscando miembros…"', () => {
    const { container } = render(
      <MentionFeedbackMenu kind="loading" trigger={asTrigger({ kind: 'user', query: '' })} />,
    )
    expect(feedbackText(container, 'loading')).toContain('Buscando miembros…')
    expect(container.querySelector('.animate-spin')).not.toBeNull()
  })

  it('loading + library-category → "Cargando categorías…"', () => {
    const { container } = render(
      <MentionFeedbackMenu
        kind="loading"
        trigger={asTrigger({ kind: 'library-category', query: '' })}
      />,
    )
    expect(feedbackText(container, 'loading')).toContain('Cargando categorías…')
  })

  it('loading + library-item → "Cargando recursos…"', () => {
    const { container } = render(
      <MentionFeedbackMenu
        kind="loading"
        trigger={asTrigger({ kind: 'library-item', categorySlug: 'general', query: '' })}
      />,
    )
    expect(feedbackText(container, 'loading')).toContain('Cargando recursos…')
  })

  it('error + event → role=alert + "No pudimos cargar eventos. Probá de nuevo."', () => {
    const { container } = render(
      <MentionFeedbackMenu kind="error" trigger={asTrigger({ kind: 'event', query: '' })} />,
    )
    expect(feedbackText(container, 'error')).toContain('No pudimos cargar eventos')
    // role="alert" en el inner; querySelector puntual.
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
    // No spinner en error state.
    expect(container.querySelector('.animate-spin')).toBeNull()
  })

  it('error + library-category → "No pudimos cargar categorías"', () => {
    const { container } = render(
      <MentionFeedbackMenu
        kind="error"
        trigger={asTrigger({ kind: 'library-category', query: '' })}
      />,
    )
    expect(feedbackText(container, 'error')).toContain('No pudimos cargar categorías')
  })

  it('loading + slow=true → label cambia a "Sigue cargando…"', () => {
    const { container } = render(
      <MentionFeedbackMenu kind="loading" trigger={asTrigger({ kind: 'user', query: '' })} slow />,
    )
    expect(feedbackText(container, 'loading')).toContain('Sigue cargando miembros…')
    // El spinner sigue visible — slow es un cambio de label, no de UI.
    expect(container.querySelector('.animate-spin')).not.toBeNull()
  })

  it('loading + slow=false (default) → label normal', () => {
    const { container } = render(
      <MentionFeedbackMenu
        kind="loading"
        trigger={asTrigger({ kind: 'library-category', query: '' })}
      />,
    )
    expect(feedbackText(container, 'loading')).toContain('Cargando categorías…')
    expect(feedbackText(container, 'loading')).not.toContain('Sigue cargando')
  })

  it('error + slow=true → ignorado (slow sólo aplica a loading)', () => {
    const { container } = render(
      <MentionFeedbackMenu kind="error" trigger={asTrigger({ kind: 'user', query: '' })} slow />,
    )
    expect(feedbackText(container, 'error')).toContain('No pudimos cargar miembros')
    expect(feedbackText(container, 'error')).not.toContain('Sigue cargando')
  })

  // Audit #7: el error debe diferenciarse del loading por color (border +
  // bg + texto ámbar). Sin esto, los dos estados se confundían en un mismo
  // tono neutral y el viewer podía no notar el fallo.
  it('error → contenedor con border + bg ámbar y texto ámbar', () => {
    const { container } = render(
      <MentionFeedbackMenu kind="error" trigger={asTrigger({ kind: 'user', query: '' })} />,
    )
    const root = container.querySelector('[data-mention-feedback="error"]')
    expect(root).not.toBeNull()
    expect(root?.className).toContain('border-amber-300')
    expect(root?.className).toContain('bg-amber-50')
    const inner = root?.querySelector('[role="alert"]')
    expect(inner?.className).toContain('text-amber-700')
  })

  it('loading → mantiene tono neutral (sin clases ámbar en contenedor)', () => {
    const { container } = render(
      <MentionFeedbackMenu kind="loading" trigger={asTrigger({ kind: 'user', query: '' })} />,
    )
    const root = container.querySelector('[data-mention-feedback="loading"]')
    expect(root?.className).not.toContain('border-amber')
    expect(root?.className).not.toContain('bg-amber')
    expect(root?.className).toContain('border-neutral-200')
  })
})
