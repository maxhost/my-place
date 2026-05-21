import type { ReactNode } from "react";
import { AppShell } from "@/shared/ui/app-shell/public";
import { buildNavHubSidebarItems } from "./nav-hub-items";
import type { NavHubActiveSection, NavHubLabels } from "./nav-hub-labels";

// Thin wrapper del Hub V1 sobre el shell agnóstico (ADR-0023 §4). El
// componente NO contiene markup propio del frame: traduce el contract
// del slice (`NavHubLabels` + `activeSection`) al shape genérico del
// shell y delega todo el render a `<AppShell>`. La estructura responsive
// (topbar + drawer mobile + sidebar desktop + main) vive en
// `src/shared/ui/app-shell/`.
//
// Server Component (sin `"use client"`): no usa hooks ni state — sólo
// compone props serializables. El shell también es Server compose con
// sub-componentes Client (drawer + account menu) para el state UI; el
// patrón se mantiene íntegro acá.
//
// Lo que este wrapper aporta sobre llamar `<AppShell>` directo desde la
// page: (a) encapsula la lógica de mapping items del Hub (`buildNavHubSidebarItems`),
// (b) mantiene el contract público estable (`NavHubLayout` puede evolucionar
// internamente sin romper consumers), (c) preserva la semántica de
// `activeSection` con su union type fuerte (`"places" | "messages" | "activity"`).

type LogoutResult = { redirectTo: string };

type Props = {
  labels: NavHubLabels;
  displayName: string | null;
  activeSection: NavHubActiveSection;
  onLogout: () => Promise<LogoutResult>;
  /** Default `window.location.assign`. Inyectable para tests. */
  navigate?: (url: string) => void;
  children: ReactNode;
};

export function NavHubLayout({
  labels,
  displayName,
  activeSection,
  onLogout,
  navigate,
  children,
}: Props) {
  return (
    <AppShell
      title={labels.appName}
      sidebarItems={buildNavHubSidebarItems(labels)}
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
