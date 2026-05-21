import type { ReactNode } from "react";
import { AppShell } from "@/shared/ui/app-shell/public";
import { buildNavPlaceSidebarItems } from "./nav-place-items";
import type {
  NavPlaceActiveSection,
  NavPlaceLabels,
} from "./nav-place-labels";

// Thin wrapper del settings V1 sobre el shell agnóstico (ADR-0023 §5). El
// componente NO contiene markup propio del frame: traduce el contract del
// slice (`NavPlaceLabels` + `activeSection`) al shape genérico del shell
// y delega todo el render a `<AppShell>`. Paralelo arquitectónico a
// `<NavHubLayout>` del Hub V1; la estructura responsive (topbar + drawer
// mobile + sidebar desktop + main) vive en `src/shared/ui/app-shell/`.
//
// Server Component (sin `"use client"`): no usa hooks ni state — sólo
// compone props serializables. El shell también es Server compose con
// sub-componentes Client (drawer + account menu) para el state UI; el
// patrón se mantiene íntegro acá.
//
// Lo que este wrapper aporta sobre llamar `<AppShell>` directo desde la
// page: (a) encapsula la lógica de mapping items del settings
// (`buildNavPlaceSidebarItems`), (b) mantiene el contract público estable
// (`NavPlaceLayout` puede evolucionar internamente sin romper consumers),
// (c) preserva la semántica de `activeSection` con su union type fuerte
// (`NavPlaceActiveSection` — 6 sections del settings V1).
//
// El `onLogout` es el mismo Server Action `logoutAction` del slice
// `nav-hub`, reusado vía su `public.ts` (slice→slice unidireccional;
// `docs/features/settings/spec.md` §"Dependencias acíclicas"). La page del
// settings (S6) lo bindea con el `redirectTo` apropiado y lo pasa acá; el
// shell lo invoca igual que en el Hub. `nav-place` NO re-exporta el
// action: el consumer lo importa directo desde `@/features/nav-hub/public`.

type LogoutResult = { redirectTo: string };

type Props = {
  labels: NavPlaceLabels;
  displayName: string | null;
  activeSection: NavPlaceActiveSection;
  onLogout: () => Promise<LogoutResult>;
  /** Default `window.location.assign`. Inyectable para tests. */
  navigate?: (url: string) => void;
  children: ReactNode;
};

export function NavPlaceLayout({
  labels,
  displayName,
  activeSection,
  onLogout,
  navigate,
  children,
}: Props) {
  return (
    <AppShell
      title={labels.title}
      sidebarItems={buildNavPlaceSidebarItems(labels)}
      activeKey={activeSection}
      displayName={displayName}
      onLogout={onLogout}
      navigate={navigate}
      labels={labels}
    >
      {children}
    </AppShell>
  );
}
