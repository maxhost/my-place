'use client'

import { useEffect, useState } from 'react'
import { formatAbsoluteTime, formatAbsoluteTimeLong } from '@/shared/lib/format-date'

type Props = {
  date: Date | string
  className?: string
}

/**
 * Render dual: SSR muestra fecha absoluta ("20 abr 14:33") para evitar
 * mismatches; tras hidratar pasa a relativo en español ("hace 3 horas") y
 * re-calcula cada 60s. `title` tiene siempre la fecha completa para a11y.
 */
export function TimeAgo({ date, className }: Props): React.ReactNode {
  const iso = typeof date === 'string' ? new Date(date).toISOString() : date.toISOString()
  const absolute = formatAbsoluteTime(iso)
  const absoluteLong = formatAbsoluteTimeLong(iso)

  const [label, setLabel] = useState<string>(absolute)

  useEffect(() => {
    const dateObj = new Date(iso)
    const compute = () => setLabel(relativeEs(dateObj, new Date()))
    compute()
    const id = setInterval(compute, 60_000)
    return () => clearInterval(id)
  }, [iso])

  return (
    <time dateTime={iso} title={absoluteLong} className={className} suppressHydrationWarning>
      {label}
    </time>
  )
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY
const MONTH = 30 * DAY
const YEAR = 365 * DAY

function relativeEs(date: Date, now: Date): string {
  const diff = now.getTime() - date.getTime()
  const abs = Math.abs(diff)
  const past = diff >= 0

  const fmt = new Intl.RelativeTimeFormat('es-AR', { numeric: 'auto' })
  const pick = (): { value: number; unit: Intl.RelativeTimeFormatUnit } => {
    if (abs < MINUTE) return { value: 0, unit: 'second' }
    if (abs < HOUR) return { value: Math.round(abs / MINUTE), unit: 'minute' }
    if (abs < DAY) return { value: Math.round(abs / HOUR), unit: 'hour' }
    if (abs < WEEK) return { value: Math.round(abs / DAY), unit: 'day' }
    if (abs < MONTH) return { value: Math.round(abs / WEEK), unit: 'week' }
    if (abs < YEAR) return { value: Math.round(abs / MONTH), unit: 'month' }
    return { value: Math.round(abs / YEAR), unit: 'year' }
  }

  const { value, unit } = pick()
  if (unit === 'second') return past ? 'hace instantes' : 'en instantes'
  return fmt.format(past ? -value : value, unit)
}
