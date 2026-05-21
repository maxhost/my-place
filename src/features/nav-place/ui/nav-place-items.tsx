import type { SidebarItem } from "@/shared/ui/app-shell/public";
import {
  AppearanceIcon,
  BillingIcon,
  DomainIcon,
  HoursIcon,
  LanguageIcon,
  MembersIcon,
} from "./icons";
import type { NavPlaceLabels } from "./nav-place-labels";

// Helper de dominio del settings (ADR-0023 §4): traduce el contract del
// slice (`NavPlaceLabels` + sección activa) al shape genérico
// `SidebarItem[]` que consume `<AppShell>`. Vive en `nav-place/ui/` porque
// es lógica del settings — el shell no conoce qué items tiene la zona ni
// qué ícono lleva cada uno. Paralelo a `nav-hub/ui/nav-hub-items.tsx`.
//
// V1: 6 items. Sólo "language" es navegable (href="/settings"); el resto
// están `disabled: true` con tooltip "Próximamente" (label vive en
// `labels.comingSoon`, lo aplica el shell). Las 5 secciones diferidas
// (members/appearance/hours/billing/domain) entran cuando se cablee cada
// una — ver `docs/features/settings/spec.md` §"Fuera de V1".
//
// URL del item "language": `/settings`. El slug del place vive en el
// subdomain (`{slug}.place.community/settings`), no en el path
// (feedback_urls_subdomain). El `<a href>` queda sin slug; el proxy lo
// resuelve. Hoy V1 sólo hay una page activa (settings/page.tsx) que rinde
// la sección "language"; navegar a "/settings" desde "/settings" es no-op
// + el item ya viene con `aria-current="page"` activo, así que el link
// nunca se ejecuta en runtime — pero el href bien formado mantiene la
// semántica HTML correcta para a11y.
//
// El ícono viaja como `ReactNode` dentro del item; el shell lo renderea
// dentro de un wrapper con `aria-hidden` y color heredado (convención
// documentada en `icons.tsx`: SVG inline con `currentColor`).

export function buildNavPlaceSidebarItems(
  labels: NavPlaceLabels,
): SidebarItem[] {
  return [
    {
      key: "language",
      label: labels.sidebarLanguage,
      href: "/settings",
      icon: <LanguageIcon />,
    },
    {
      key: "members",
      label: labels.sidebarMembers,
      icon: <MembersIcon />,
      disabled: true,
    },
    {
      key: "appearance",
      label: labels.sidebarAppearance,
      icon: <AppearanceIcon />,
      disabled: true,
    },
    {
      key: "hours",
      label: labels.sidebarHours,
      icon: <HoursIcon />,
      disabled: true,
    },
    {
      key: "billing",
      label: labels.sidebarBilling,
      icon: <BillingIcon />,
      disabled: true,
    },
    {
      key: "domain",
      label: labels.sidebarDomain,
      icon: <DomainIcon />,
      disabled: true,
    },
  ];
}
