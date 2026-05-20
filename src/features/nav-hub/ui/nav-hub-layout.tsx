"use client";

import type { ReactNode } from "react";
import type { NavHubActiveSection, NavHubLabels } from "./nav-hub-labels";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

// Shell de navegación del hub (S3 del Hub V1, spec en `docs/features/inbox/`).
// Layout responsivo: topbar arriba + sidebar a la izquierda en desktop +
// drawer mobile (gestionado por la propia topbar). El `<main>` recibe los
// children — typicamente la vista de places (S4).
//
// Mobile-first: estructura base es columnar (topbar + main); en md+ se mete
// la sidebar fija a la izquierda. La sidebar se duplica en el DOM (desktop
// `<aside>` con `hidden md:block` + drawer mobile que la renderea sólo
// cuando se abre), pero las dos instancias nunca son visibles a la vez —
// `display: none` la oculta semánticamente para AT.

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
    <div className="flex min-h-screen flex-col bg-bg">
      <Topbar
        labels={labels}
        displayName={displayName}
        onLogout={onLogout}
        navigate={navigate}
        mobileDrawerContent={
          <Sidebar labels={labels} activeSection={activeSection} />
        }
      />
      <div className="flex flex-1">
        <aside className="hidden md:block md:w-64 shrink-0 border-r border-border bg-surface">
          <Sidebar labels={labels} activeSection={activeSection} />
        </aside>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
