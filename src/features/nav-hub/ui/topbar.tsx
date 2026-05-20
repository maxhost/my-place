"use client";

import type { ReactNode } from "react";
import { AccountMenu } from "./account-menu";
import type { NavHubLabels } from "./nav-hub-labels";
import { SidebarDrawer } from "./sidebar-drawer";

// Topbar del hub (S3 del Hub V1). Capa horizontal superior del shell:
// - mobile: hamburger (que abre el drawer con `mobileDrawerContent`) + appName
//   + account
// - desktop: appName + account (la sidebar vive afuera, en el <aside> del
//   layout; el hamburger queda en el DOM pero sin uso — su visibilidad la
//   gestiona el layout vía clases responsive)

type LogoutResult = { redirectTo: string };

type Props = {
  labels: NavHubLabels;
  displayName: string | null;
  onLogout: () => Promise<LogoutResult>;
  /** Default `window.location.assign`. Inyectable para tests. */
  navigate?: (url: string) => void;
  /** Contenido del drawer mobile (típicamente `<Sidebar />`). */
  mobileDrawerContent: ReactNode;
};

export function Topbar({
  labels,
  displayName,
  onLogout,
  navigate,
  mobileDrawerContent,
}: Props) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-surface px-3 md:px-6">
      {/* Hamburger + drawer: visible sólo en mobile. El parent oculta vía md:hidden. */}
      <div className="md:hidden">
        <SidebarDrawer
          openLabel={labels.openMenu}
          closeLabel={labels.closeMenu}
          dialogLabel={labels.appName}
        >
          {mobileDrawerContent}
        </SidebarDrawer>
      </div>

      {/* App name / brand */}
      <div className="font-medium text-ink">{labels.appName}</div>

      {/* Spacer + account a la derecha */}
      <div className="ml-auto">
        <AccountMenu
          triggerLabel={labels.accountMenuButton}
          logoutLabel={labels.accountMenuLogout}
          logoutPendingLabel={labels.accountMenuLogoutPending}
          displayName={displayName}
          onLogout={onLogout}
          navigate={navigate}
        />
      </div>
    </header>
  );
}
