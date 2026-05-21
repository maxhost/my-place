// Interfaz pública del primitivo `shared/ui/app-shell/` (ADR-0023). Los
// consumers (`nav-hub`, `nav-place` en S5) importan SÓLO desde acá, nunca
// de internals. Patrón paralelo al `public.ts` de cada slice del repo
// (`docs/architecture.md` §17-25); `shared/ui/` lo adopta para mantener el
// mismo contract de aislamiento.
//
// Lo que NO se exporta acá (intencional):
// - `AppShellDrawer`, `AppShellAccountMenu`: sub-componentes Client internos
//   del shell. Si un consumer los necesitara directos, sería señal de que
//   el contract público está incompleto — agregar la abstracción acá.
// - `MenuIcon`/`CloseIcon`/`LogoutIcon` (icons.tsx): privados del shell.

export { AppShell } from "./app-shell";
export type { AppShellLabels, SidebarItem } from "./app-shell-labels";
