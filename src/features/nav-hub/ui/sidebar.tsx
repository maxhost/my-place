"use client";

import { ActivityIcon, MessagesIcon, PlacesIcon } from "./icons";
import type { NavHubActiveSection, NavHubLabels } from "./nav-hub-labels";

// Sidebar del hub (S3 del Hub V1, spec en `docs/features/inbox/`). Vertical
// (desktop) o dentro del drawer (mobile). Render puro: recibe `labels` +
// `activeSection`, decide qué item resaltar y cuáles dejar disabled. La
// page Server define la sección activa porque conoce la ruta que está
// renderizando (no usamos `usePathname()` para evitar parsing post-rewrite
// del proxy).
//
// V1: sólo "places" navegable. "messages" y "activity" siempre disabled con
// tooltip "Próximamente" — tokens visuales reservados para que el frame de
// la app no cambie cuando se activen.

type Props = {
  labels: NavHubLabels;
  activeSection: NavHubActiveSection;
};

export function Sidebar({ labels, activeSection }: Props) {
  return (
    <nav aria-label={labels.appName} className="flex flex-col gap-1 p-3">
      <SidebarLink
        href="/"
        label={labels.sidebarPlaces}
        icon={<PlacesIcon />}
        isActive={activeSection === "places"}
      />
      <SidebarDisabled
        label={labels.sidebarMessages}
        icon={<MessagesIcon />}
        tooltip={labels.comingSoon}
      />
      <SidebarDisabled
        label={labels.sidebarActivity}
        icon={<ActivityIcon />}
        tooltip={labels.comingSoon}
      />
    </nav>
  );
}

function SidebarLink({
  href,
  label,
  icon,
  isActive,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  isActive: boolean;
}) {
  return (
    <a
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={[
        "flex items-center gap-3 rounded-md px-3 py-2 min-h-11",
        "text-ink hover:bg-bg",
        isActive ? "bg-bg font-medium" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="shrink-0 text-muted" aria-hidden="true">
        {icon}
      </span>
      <span>{label}</span>
    </a>
  );
}

function SidebarDisabled({
  label,
  icon,
  tooltip,
}: {
  label: string;
  icon: React.ReactNode;
  tooltip: string;
}) {
  // Sin `href` → no es un link (no entra en getAllByRole("link")). aria-disabled
  // marca el estado para AT; title da el tooltip nativo del browser.
  return (
    <span
      aria-disabled="true"
      title={tooltip}
      className="flex items-center gap-3 rounded-md px-3 py-2 min-h-11 text-muted cursor-not-allowed"
    >
      <span className="shrink-0" aria-hidden="true">
        {icon}
      </span>
      <span>{label}</span>
    </span>
  );
}
