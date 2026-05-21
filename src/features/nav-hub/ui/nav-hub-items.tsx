import type { SidebarItem } from "@/shared/ui/app-shell/public";
import { ActivityIcon, MessagesIcon, PlacesIcon } from "./icons";
import type { NavHubLabels } from "./nav-hub-labels";

// Helper de dominio del Hub (ADR-0023 §4): traduce el contract del slice
// (`NavHubLabels` + sección activa) al shape genérico `SidebarItem[]` que
// consume `<AppShell>`. Vive en `nav-hub/ui/` porque es lógica del Hub —
// el shell no conoce qué items tiene el Hub ni qué ícono lleva cada uno.
//
// V1: 3 items. Sólo "places" es navegable (href="/"); "messages" y
// "activity" siempre `disabled: true` con tooltip "Próximamente" (label
// vive en `labels.comingSoon`, lo aplica el shell).
//
// El ícono viaja como `ReactNode` dentro del item; el shell lo renderea
// dentro de un wrapper con `aria-hidden` y color heredado. Esa convención
// está documentada en `icons.tsx` (SVG inline con `currentColor`).

export function buildNavHubSidebarItems(labels: NavHubLabels): SidebarItem[] {
  return [
    {
      key: "places",
      label: labels.sidebarPlaces,
      href: "/",
      icon: <PlacesIcon />,
    },
    {
      key: "messages",
      label: labels.sidebarMessages,
      icon: <MessagesIcon />,
      disabled: true,
    },
    {
      key: "activity",
      label: labels.sidebarActivity,
      icon: <ActivityIcon />,
      disabled: true,
    },
  ];
}
