'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

/**
 * Search bar del directorio de `/settings/members`. URL state via `?q=`
 * con debounce 300ms — el filtro sobrevive a refresh + back button.
 *
 * Placeholder dinámico según `tab`:
 *  - `'active'`: "Buscar por nombre o handle…" (privacy: email no se
 *    expone para active members).
 *  - `'pending'`: "Buscar por email…".
 *
 * Resetea `?page=1` al actualizar `q` (sin esto, una búsqueda con
 * paginación previa podría dejar al user en una page vacía).
 *
 * Patrón de debounce: `router.replace` (no `push`) para no pollutar
 * history con cada keystroke.
 */
const DEBOUNCE_MS = 300

type Props = {
  tab: 'active' | 'pending'
  initialQ: string
}

export function MembersSearchBar({ tab, initialQ }: Props): React.ReactNode {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()

  const [value, setValue] = useState(initialQ)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastPushedRef = useRef(initialQ)

  useEffect(() => {
    if (initialQ !== lastPushedRef.current) {
      lastPushedRef.current = initialQ
      setValue(initialQ)
    }
  }, [initialQ])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  function pushQuery(next: string): void {
    const trimmed = next.trim()
    if (trimmed === lastPushedRef.current) return
    lastPushedRef.current = trimmed
    const params = new URLSearchParams(searchParams.toString())
    if (trimmed.length === 0) params.delete('q')
    else params.set('q', trimmed)
    // Reset page on new search.
    params.delete('page')
    const qs = params.toString()
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false })
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const next = e.target.value
    setValue(next)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => pushQuery(next), DEBOUNCE_MS)
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault()
    if (timerRef.current) clearTimeout(timerRef.current)
    pushQuery(value)
  }

  const placeholder =
    tab === 'pending' ? 'Buscar invitación por email…' : 'Buscar miembro por nombre o handle…'

  return (
    <form role="search" onSubmit={handleSubmit} className="flex">
      <label htmlFor="members-search" className="sr-only">
        Buscar
      </label>
      <input
        id="members-search"
        type="search"
        inputMode="search"
        autoComplete="off"
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        maxLength={100}
        className="block min-h-[44px] w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-base placeholder:text-neutral-500 focus:border-neutral-500 focus:outline-none"
      />
    </form>
  )
}
