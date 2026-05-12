import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { RowActions } from '../row-actions'

afterEach(() => cleanup())

describe('<RowActions> adaptive primitive', () => {
  describe('inline mode (1-3 actions)', () => {
    function renderInline() {
      const onEdit = vi.fn()
      const onRemove = vi.fn()
      render(
        <RowActions
          triggerLabel="Opciones para ventana 09:00 a 17:00 del Lunes"
          chipClassName="rounded-full border px-3 py-2"
          actions={[
            {
              icon: <span data-testid="edit-icon">✏️</span>,
              label: 'Editar',
              onSelect: onEdit,
            },
            {
              icon: <span data-testid="remove-icon">🗑️</span>,
              label: 'Eliminar',
              onSelect: onRemove,
              destructive: true,
            },
          ]}
        >
          09:00 → 17:00
        </RowActions>,
      )
      return { onEdit, onRemove }
    }

    it('mobile: renderea chip como dropdown trigger (button con aria-label)', () => {
      renderInline()
      const trigger = screen.getByRole('button', {
        name: 'Opciones para ventana 09:00 a 17:00 del Lunes',
      })
      expect(trigger).toBeInTheDocument()
      // Mobile-only via CSS
      expect(trigger.className).toMatch(/md:hidden/)
      // Contenido del chip (children) está en el trigger
      expect(trigger.textContent).toContain('09:00')
      expect(trigger.textContent).toContain('17:00')
    })

    it('desktop: renderea chip + icon buttons inline (hidden md:inline-flex)', () => {
      renderInline()
      const desktopWrapper = document.querySelector('.hidden.md\\:inline-flex')
      expect(desktopWrapper).not.toBeNull()
      // Icons visibles
      expect(screen.getAllByTestId('edit-icon').length).toBeGreaterThan(0)
      expect(screen.getAllByTestId('remove-icon').length).toBeGreaterThan(0)
    })

    it('desktop icon buttons tienen aria-label = action.label', () => {
      renderInline()
      // Buscamos buttons con aria-label "Editar" / "Eliminar" (los desktop)
      const editBtn = screen.getAllByRole('button', { name: 'Editar' })
      const removeBtn = screen.getAllByRole('button', { name: 'Eliminar' })
      expect(editBtn.length).toBeGreaterThan(0)
      expect(removeBtn.length).toBeGreaterThan(0)
    })

    it('desktop click en icon button llama onSelect del action', () => {
      const { onEdit } = renderInline()
      const editBtn = screen.getAllByRole('button', { name: 'Editar' })[0]!
      fireEvent.click(editBtn)
      expect(onEdit).toHaveBeenCalledTimes(1)
    })

    it('desktop action destructive aplica clase visual destructive (red-600)', () => {
      renderInline()
      const removeBtn = screen.getAllByRole('button', { name: 'Eliminar' })[0]!
      expect(removeBtn.className).toMatch(/text-red-600/)
    })

    it('desktop action no-destructive usa neutral-600 (chrome calmo)', () => {
      renderInline()
      const editBtn = screen.getAllByRole('button', { name: 'Editar' })[0]!
      expect(editBtn.className).toMatch(/text-neutral-600/)
    })

    it('chipClassName se aplica al chip mobile y al span desktop', () => {
      renderInline()
      const trigger = screen.getByRole('button', {
        name: 'Opciones para ventana 09:00 a 17:00 del Lunes',
      })
      expect(trigger.className).toContain('rounded-full')
      expect(trigger.className).toContain('border')
    })
  })

  describe('overflow mode (>3 actions)', () => {
    function renderOverflow() {
      const handlers = {
        a: vi.fn(),
        b: vi.fn(),
        c: vi.fn(),
        d: vi.fn(),
      }
      render(
        <RowActions
          triggerLabel="Más opciones del Lunes"
          actions={[
            { icon: <span>1</span>, label: 'Acción A', onSelect: handlers.a },
            { icon: <span>2</span>, label: 'Acción B', onSelect: handlers.b },
            { icon: <span>3</span>, label: 'Acción C', onSelect: handlers.c },
            { icon: <span>4</span>, label: 'Acción D', onSelect: handlers.d },
          ]}
        >
          Lunes
        </RowActions>,
      )
      return handlers
    }

    it('renderea kebab trigger en lugar de chip-as-trigger (un solo botón "Más opciones")', () => {
      renderOverflow()
      const kebab = screen.getByRole('button', { name: 'Más opciones del Lunes' })
      expect(kebab).toBeInTheDocument()
      // El kebab está en BOTH viewports (no md:hidden)
      expect(kebab.className).not.toMatch(/md:hidden/)
    })

    it('NO renderea chip-as-dropdown-trigger (no hay botón con el children como label)', () => {
      renderOverflow()
      // El chip "Lunes" NO debe ser button trigger en overflow mode
      expect(screen.queryByRole('button', { name: 'Lunes' })).not.toBeInTheDocument()
    })

    it('NO renderea desktop hover icons inline (>3 = overflow puro)', () => {
      renderOverflow()
      // No debe haber wrapper hidden md:inline-flex con icons
      const desktopInline = document.querySelector('.hidden.md\\:inline-flex')
      expect(desktopInline).toBeNull()
    })
  })

  describe('accessibility', () => {
    it('cada icon button desktop tiene aria-label (no solo icon decorativo)', () => {
      render(
        <RowActions
          triggerLabel="Opciones"
          actions={[{ icon: <span>✏️</span>, label: 'Editar', onSelect: vi.fn() }]}
        >
          chip
        </RowActions>,
      )
      const buttons = screen.getAllByRole('button', { name: 'Editar' })
      expect(buttons.length).toBeGreaterThanOrEqual(1)
    })

    it('icon buttons tienen min-h-11 min-w-11 (touch target ≥44px)', () => {
      render(
        <RowActions
          triggerLabel="x"
          actions={[{ icon: <span>i</span>, label: 'A', onSelect: vi.fn() }]}
        >
          chip
        </RowActions>,
      )
      const btn = screen.getAllByRole('button', { name: 'A' })[0]!
      expect(btn.className).toMatch(/min-h-11/)
      expect(btn.className).toMatch(/min-w-11/)
    })
  })

  describe('destructive ⇒ confirm dialog (contrato fuerte)', () => {
    it('action destructive NO ejecuta onSelect directo al hacer click', () => {
      const onRemove = vi.fn()
      render(
        <RowActions
          triggerLabel="x"
          actions={[
            {
              icon: <span>🗑</span>,
              label: 'Eliminar',
              onSelect: onRemove,
              destructive: true,
            },
          ]}
        >
          chip
        </RowActions>,
      )
      // Desktop icon button con destructive
      const removeBtn = screen.getAllByRole('button', { name: 'Eliminar' })[0]!
      fireEvent.click(removeBtn)
      // El handler NO se llamó — está esperando confirm
      expect(onRemove).not.toHaveBeenCalled()
    })

    it('al click destructive aparece el dialog con título y descripción default', () => {
      render(
        <RowActions
          triggerLabel="x"
          actions={[
            {
              icon: <span>🗑</span>,
              label: 'Eliminar',
              onSelect: vi.fn(),
              destructive: true,
            },
          ]}
        >
          chip
        </RowActions>,
      )
      fireEvent.click(screen.getAllByRole('button', { name: 'Eliminar' })[0]!)
      // Dialog abierto
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      // Título default deriva del label
      expect(screen.getByText('¿Eliminar?')).toBeInTheDocument()
      // Descripción default
      expect(screen.getByText(/no se puede deshacer/i)).toBeInTheDocument()
      // Botones Cancelar + acción confirmar
      expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /sí, eliminar/i })).toBeInTheDocument()
    })

    it('confirmTitle/Description/ActionLabel custom override defaults', () => {
      render(
        <RowActions
          triggerLabel="x"
          actions={[
            {
              icon: <span>🗑</span>,
              label: 'Eliminar',
              onSelect: vi.fn(),
              destructive: true,
              confirmTitle: '¿Borrar ventana 09:00–17:00?',
              confirmDescription: 'Custom warning.',
              confirmActionLabel: 'Borrar ya',
            },
          ]}
        >
          chip
        </RowActions>,
      )
      fireEvent.click(screen.getAllByRole('button', { name: 'Eliminar' })[0]!)
      expect(screen.getByText('¿Borrar ventana 09:00–17:00?')).toBeInTheDocument()
      expect(screen.getByText('Custom warning.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Borrar ya' })).toBeInTheDocument()
    })

    it('Cancelar cierra el dialog SIN ejecutar onSelect', () => {
      const onRemove = vi.fn()
      render(
        <RowActions
          triggerLabel="x"
          actions={[
            {
              icon: <span>🗑</span>,
              label: 'Eliminar',
              onSelect: onRemove,
              destructive: true,
            },
          ]}
        >
          chip
        </RowActions>,
      )
      fireEvent.click(screen.getAllByRole('button', { name: 'Eliminar' })[0]!)
      fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
      expect(onRemove).not.toHaveBeenCalled()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('Confirmar ejecuta onSelect y cierra el dialog', () => {
      const onRemove = vi.fn()
      render(
        <RowActions
          triggerLabel="x"
          actions={[
            {
              icon: <span>🗑</span>,
              label: 'Eliminar',
              onSelect: onRemove,
              destructive: true,
            },
          ]}
        >
          chip
        </RowActions>,
      )
      fireEvent.click(screen.getAllByRole('button', { name: 'Eliminar' })[0]!)
      fireEvent.click(screen.getByRole('button', { name: /sí, eliminar/i }))
      expect(onRemove).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('action NO destructive ejecuta onSelect directo (sin confirm)', () => {
      const onEdit = vi.fn()
      render(
        <RowActions
          triggerLabel="x"
          actions={[
            {
              icon: <span>✏️</span>,
              label: 'Editar',
              onSelect: onEdit,
              // sin destructive
            },
          ]}
        >
          chip
        </RowActions>,
      )
      fireEvent.click(screen.getAllByRole('button', { name: 'Editar' })[0]!)
      expect(onEdit).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})
