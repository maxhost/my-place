import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import {
  EditPanel,
  EditPanelBody,
  EditPanelContent,
  EditPanelFooter,
  EditPanelHeader,
  EditPanelTitle,
} from '../edit-panel'

afterEach(() => cleanup())

function renderOpen() {
  return render(
    <EditPanel open>
      <EditPanelContent aria-describedby={undefined}>
        <EditPanelHeader>
          <EditPanelTitle>Editar ventana</EditPanelTitle>
        </EditPanelHeader>
        <EditPanelBody>
          <input placeholder="Body input" />
        </EditPanelBody>
        <EditPanelFooter>
          <button type="button">Guardar</button>
          <button type="button">Cancelar</button>
        </EditPanelFooter>
      </EditPanelContent>
    </EditPanel>,
  )
}

describe('<EditPanel> primitive', () => {
  describe('render structure', () => {
    it('renderiza title + body + footer cuando open', () => {
      renderOpen()
      expect(screen.getByRole('heading', { name: 'Editar ventana' })).toBeInTheDocument()
      expect(screen.getByPlaceholderText('Body input')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Guardar' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
    })

    it('header tiene botón "Cerrar" (X) accesible', () => {
      renderOpen()
      expect(screen.getByRole('button', { name: 'Cerrar' })).toBeInTheDocument()
    })

    it('rol dialog presente con title como aria-labelledby', () => {
      renderOpen()
      const dialog = screen.getByRole('dialog')
      expect(dialog).toBeInTheDocument()
      // Radix injecta aria-labelledby con el id del title automáticamente
      const labelledBy = dialog.getAttribute('aria-labelledby')
      expect(labelledBy).toBeTruthy()
    })
  })

  describe('responsive: bottom sheet mobile / side drawer desktop (CSS-driven)', () => {
    it('content tiene clases mobile-first bottom-anchored', () => {
      renderOpen()
      const dialog = screen.getByRole('dialog')
      // Mobile defaults: anchored bottom
      expect(dialog.className).toMatch(/bottom-0/)
      expect(dialog.className).toMatch(/left-0/)
      expect(dialog.className).toMatch(/right-0/)
      expect(dialog.className).toMatch(/max-h-\[85vh\]/)
      // Las animations se aplican via la clase `edit-panel-content` definida
      // en `globals.css` con keyframes + selector [data-state] directo. La
      // iter previa con tailwindcss-animate fallaba al cerrar — Radix
      // unmount antes de aplicar data-state=closed. Ver doc del módulo en
      // src/shared/ui/edit-panel.tsx.
      expect(dialog.className).toMatch(/edit-panel-content/)
    })

    it('content tiene clases desktop md: que cambian a side drawer', () => {
      renderOpen()
      const dialog = screen.getByRole('dialog')
      // Desktop: anchored right, full height, fixed width
      expect(dialog.className).toMatch(/md:right-0/)
      expect(dialog.className).toMatch(/md:top-0/)
      expect(dialog.className).toMatch(/md:h-screen/)
      expect(dialog.className).toMatch(/md:w-\[520px\]/)
      // El slide-from-right en desktop lo aplica el @media query del
      // `.edit-panel-content` en `globals.css` — no clase Tailwind aquí.
    })

    it('drag handle visible solo en mobile (md:hidden)', () => {
      renderOpen()
      // El drag handle es un div aria-hidden con clases h-1.5 w-12 rounded-full + md:hidden
      const dialog = screen.getByRole('dialog')
      const handles = dialog.querySelectorAll('[aria-hidden="true"]')
      const dragHandle = Array.from(handles).find(
        (el) => el.className.includes('md:hidden') && el.className.includes('rounded-full'),
      )
      expect(dragHandle).toBeDefined()
    })
  })

  describe('accessibility', () => {
    it('dialog rendea con role correcto (Radix maneja focus trap interno)', () => {
      renderOpen()
      // Radix Dialog rendea role="dialog". El focus trap, ESC y aria-modal
      // los aplica via JS interno (no necesariamente como attribute estático).
      const dialog = screen.getByRole('dialog')
      expect(dialog).toBeInTheDocument()
    })

    it('botón Cerrar tiene aria-label', () => {
      renderOpen()
      const close = screen.getByRole('button', { name: 'Cerrar' })
      expect(close).toHaveAttribute('aria-label', 'Cerrar')
    })
  })

  describe('open vs closed', () => {
    it('cuando open=false, el content NO se monta', () => {
      render(
        <EditPanel open={false}>
          <EditPanelContent aria-describedby={undefined}>
            <EditPanelHeader>
              <EditPanelTitle>Hidden title</EditPanelTitle>
            </EditPanelHeader>
            <EditPanelBody>Body</EditPanelBody>
          </EditPanelContent>
        </EditPanel>,
      )
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.queryByText('Hidden title')).not.toBeInTheDocument()
    })
  })
})
