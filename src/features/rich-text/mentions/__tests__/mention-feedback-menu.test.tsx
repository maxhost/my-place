import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { MentionFeedbackMenu } from '../ui/mention-plugin'

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
})
