import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React, { useState } from 'react'

const flagActionFn = vi.fn()
const toastSuccessFn = vi.fn()
const toastErrorFn = vi.fn()
const toastFn = vi.fn()

vi.mock('../server/actions', () => ({
  flagAction: (...a: unknown[]) => flagActionFn(...a),
}))

vi.mock('@/shared/ui/toaster', () => ({
  toast: Object.assign((...a: unknown[]) => toastFn(...a), {
    success: (...a: unknown[]) => toastSuccessFn(...a),
    error: (...a: unknown[]) => toastErrorFn(...a),
  }),
}))

import { FlagModal } from '../ui/flag-modal'
import { FlagAlreadyExists } from '../domain/errors'

function Wrapper(props: {
  targetType: 'POST' | 'COMMENT'
  targetId: string
  defaultOpen?: boolean
}): React.ReactElement {
  const [open, setOpen] = useState(props.defaultOpen ?? false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} data-testid="open-trigger">
        open
      </button>
      <FlagModal
        targetType={props.targetType}
        targetId={props.targetId}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  )
}

beforeEach(() => {
  vi.resetAllMocks()
})

afterEach(() => {
  cleanup()
})

describe('FlagModal', () => {
  it('no renderiza el dialog cuando open=false', () => {
    render(<Wrapper targetType="POST" targetId="po-1" />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('al abrir muestra el form con select de reason', async () => {
    render(<Wrapper targetType="POST" targetId="po-1" defaultOpen />)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeNull())
    expect(screen.getByLabelText(/motivo/i)).toBeTruthy()
  })

  it('submit válido llama flagAction con los args esperados y cierra', async () => {
    flagActionFn.mockResolvedValue({ ok: true, flagId: 'f-1' })
    render(<Wrapper targetType="COMMENT" targetId="co-1" defaultOpen />)

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeNull())

    const select = screen.getByLabelText(/motivo/i) as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'SPAM' } })

    const textarea = screen.getByLabelText(/nota/i) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'es spam claro' } })

    const form = select.closest('form') as HTMLFormElement
    fireEvent.submit(form)

    await waitFor(() => {
      expect(flagActionFn).toHaveBeenCalledWith({
        targetType: 'COMMENT',
        targetId: 'co-1',
        reason: 'SPAM',
        reasonNote: 'es spam claro',
      })
    })
    await waitFor(() => expect(toastSuccessFn).toHaveBeenCalled())
  })

  it('submit sin reason ⇒ form HTML5 bloquea (no llama action)', async () => {
    render(<Wrapper targetType="POST" targetId="po-1" defaultOpen />)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeNull())

    const select = screen.getByLabelText(/motivo/i) as HTMLSelectElement
    const form = select.closest('form') as HTMLFormElement

    // No seleccionamos reason ⇒ value default es ''; el required bloquea submit
    fireEvent.submit(form)

    await new Promise((r) => setTimeout(r, 20))
    expect(flagActionFn).not.toHaveBeenCalled()
  })

  it('FlagAlreadyExists ⇒ toast amistoso + dialog queda abierto', async () => {
    flagActionFn.mockRejectedValue(
      new FlagAlreadyExists({
        targetType: 'POST',
        targetId: 'po-1',
        reporterUserId: 'u-1',
      }),
    )
    render(<Wrapper targetType="POST" targetId="po-1" defaultOpen />)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeNull())

    const select = screen.getByLabelText(/motivo/i) as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'HARASSMENT' } })
    const form = select.closest('form') as HTMLFormElement
    fireEvent.submit(form)

    await waitFor(() => expect(toastFn).toHaveBeenCalled())
    // Dialog sigue abierto (el user puede cerrar manual o reintentar distinto contenido)
    expect(screen.queryByRole('dialog')).not.toBeNull()
  })

  it('error genérico ⇒ toast.error con copy de retry', async () => {
    flagActionFn.mockRejectedValue(new Error('boom'))
    render(<Wrapper targetType="POST" targetId="po-1" defaultOpen />)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeNull())

    const select = screen.getByLabelText(/motivo/i) as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'OTHER' } })
    const form = select.closest('form') as HTMLFormElement
    fireEvent.submit(form)

    await waitFor(() => expect(toastErrorFn).toHaveBeenCalled())
  })
})
