import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import React from 'react'

const markPostReadAction = vi.fn()
vi.mock('../server/actions/reads', () => ({
  markPostReadAction: (...args: unknown[]) => markPostReadAction(...args),
}))

import { DwellTracker } from '../ui/dwell-tracker'

type FakeClock = { now: () => number; set: (v: number) => void }
function fakeClock(start = 0): FakeClock {
  let t = start
  return {
    now: () => t,
    set: (v: number) => {
      t = v
    },
  }
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  markPostReadAction.mockReset()
  markPostReadAction.mockResolvedValue(undefined)
  setVisibility('visible')
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('DwellTracker', () => {
  it('no dispara antes del threshold', () => {
    const clock = fakeClock(0)
    render(<DwellTracker postId="p1" threshold={5000} clock={clock} />)

    clock.set(3000)
    vi.advanceTimersByTime(3000)

    expect(markPostReadAction).not.toHaveBeenCalled()
  })

  it('dispara markPostReadAction tras threshold de visibilidad continua', () => {
    const clock = fakeClock(0)
    render(<DwellTracker postId="p1" threshold={5000} clock={clock} />)

    clock.set(5000)
    vi.advanceTimersByTime(5000)

    expect(markPostReadAction).toHaveBeenCalledTimes(1)
    expect(markPostReadAction).toHaveBeenCalledWith({
      postId: 'p1',
      dwellMs: expect.any(Number),
    })
    const call = markPostReadAction.mock.calls[0]?.[0] as { dwellMs: number }
    expect(call.dwellMs).toBeGreaterThanOrEqual(5000)
  })

  it('pausa el contador cuando el documento se oculta', () => {
    const clock = fakeClock(0)
    render(<DwellTracker postId="p1" threshold={5000} clock={clock} />)

    clock.set(3000)
    vi.advanceTimersByTime(3000)

    setVisibility('hidden')

    clock.set(10_000)
    vi.advanceTimersByTime(7000)

    expect(markPostReadAction).not.toHaveBeenCalled()

    setVisibility('visible')
    clock.set(12_000)
    vi.advanceTimersByTime(2000)

    expect(markPostReadAction).toHaveBeenCalledTimes(1)
  })

  it('no arranca si el documento está oculto en mount', () => {
    setVisibility('hidden')
    const clock = fakeClock(0)
    render(<DwellTracker postId="p1" threshold={5000} clock={clock} />)

    clock.set(10_000)
    vi.advanceTimersByTime(10_000)

    expect(markPostReadAction).not.toHaveBeenCalled()
  })

  it('dispara una sola vez por mount', () => {
    const clock = fakeClock(0)
    render(<DwellTracker postId="p1" threshold={5000} clock={clock} />)

    clock.set(10_000)
    vi.advanceTimersByTime(10_000)
    clock.set(20_000)
    vi.advanceTimersByTime(10_000)

    expect(markPostReadAction).toHaveBeenCalledTimes(1)
  })

  it('silencia OutOfHoursError', async () => {
    const err = Object.assign(new Error('closed'), { name: 'OutOfHoursError' })
    markPostReadAction.mockRejectedValueOnce(err)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const clock = fakeClock(0)
    render(<DwellTracker postId="p1" threshold={5000} clock={clock} />)

    clock.set(5000)
    vi.advanceTimersByTime(5000)
    await vi.runAllTimersAsync()

    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('silencia NotFoundError', async () => {
    const err = Object.assign(new Error('gone'), { name: 'NotFoundError' })
    markPostReadAction.mockRejectedValueOnce(err)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const clock = fakeClock(0)
    render(<DwellTracker postId="p1" threshold={5000} clock={clock} />)

    clock.set(5000)
    vi.advanceTimersByTime(5000)
    await vi.runAllTimersAsync()

    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('loguea errores desconocidos', async () => {
    const err = Object.assign(new Error('boom'), { name: 'WeirdError' })
    markPostReadAction.mockRejectedValueOnce(err)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const clock = fakeClock(0)
    render(<DwellTracker postId="p1" threshold={5000} clock={clock} />)

    clock.set(5000)
    vi.advanceTimersByTime(5000)
    await vi.runAllTimersAsync()

    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
