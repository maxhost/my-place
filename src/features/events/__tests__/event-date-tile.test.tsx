import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { EventDateTile } from '../ui/event-date-tile'

afterEach(() => {
  cleanup()
})

describe('EventDateTile', () => {
  it('render parts uppercase sin punto en TZ Buenos Aires', () => {
    const date = new Date('2026-04-27T13:00:00Z') // Lun 27 Abr ART
    render(<EventDateTile date={date} timezone="America/Argentina/Buenos_Aires" />)
    const tile = screen.getByLabelText('LUN 27 ABR')
    expect(tile.textContent).toContain('LUN')
    expect(tile.textContent).toContain('27')
    expect(tile.textContent).toContain('ABR')
    expect(tile.textContent).not.toMatch(/\./)
  })

  it('mismo Date en TZ distinto produce dow/day distinto cerca de medianoche', () => {
    const date = new Date('2026-04-28T02:00:00Z')
    render(<EventDateTile date={date} timezone="America/Argentina/Buenos_Aires" />)
    const ar = screen.getByLabelText(/27/) // ART = lunes 27
    expect(ar.textContent).toContain('27')

    cleanup()
    render(<EventDateTile date={date} timezone="Etc/UTC" />)
    const utc = screen.getByLabelText(/28/) // UTC = martes 28
    expect(utc.textContent).toContain('28')
  })
})
