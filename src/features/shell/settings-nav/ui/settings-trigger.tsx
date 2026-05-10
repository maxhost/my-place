import Link from 'next/link'
import { Settings } from 'lucide-react'

/**
 * Slot 4° del `<TopBar>` visible solo cuando el viewer es `isAdmin` del
 * place. Click → navega a `/settings` (sub-page general). Es el "punto de
 * entrada" desde dentro del place; la navegación entre sub-pages dentro
 * de settings la cubre `<SettingsNavFab>`.
 *
 * Server Component: solo renderiza un Link sin estado. El `<ShellChrome>`
 * decide si lo monta según `isAdmin`; este componente NO es admin-aware
 * (asume que el caller ya gateó).
 *
 * Visual: 36×36 con border 0.5px + radius-12, mismo lenguaje que el slot
 * Logo y el SearchTrigger (consistencia del TopBar). Icono `Settings`
 * (engranaje) de lucide en 18px.
 *
 * `href` path-relative — Next App Router resuelve dentro del subdomain
 * del place. URLs públicas son siempre subdominio (memoria del usuario).
 *
 * Ver `docs/features/shell/spec.md` § "Settings affordances".
 */
export function SettingsTrigger(): React.ReactNode {
  return (
    <Link
      href="/settings"
      aria-label="Configuración del place"
      className="inline-flex h-9 w-9 items-center justify-center rounded-[12px] border-[0.5px] border-border bg-surface text-text hover:bg-soft motion-safe:transition-colors"
    >
      <Settings size={18} aria-hidden="true" />
    </Link>
  )
}
