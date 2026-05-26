import type { SidebarGroup } from "@/shared/ui/app-shell/public";
import {
  AppearanceIcon,
  BillingIcon,
  DomainIcon,
  GroupsIcon,
  HoursIcon,
  LanguageIcon,
  MembersIcon,
  TiersIcon,
  ZonesIcon,
} from "./icons";
import type { NavPlaceLabels } from "./nav-place-labels";

// Helper de dominio del settings — V1.1 (ADR-0025): traduce el contract del
// slice (`NavPlaceLabels` + sección activa) al shape genérico
// `SidebarGroup[]` que consume `<AppShell>`. Vive en `nav-place/ui/` porque
// es lógica del settings — el shell no conoce qué items tiene la zona, qué
// agrupación conceptual ni qué ícono lleva cada uno. Paralelo a
// `nav-hub/ui/nav-hub-items.tsx`, ahora con grupos.
//
// **Estructura V1.1** — 4 grupos conceptuales fijos no-colapsables, 9
// items totales (2 activas + 7 disabled):
//
// ```
// Identidad    → Apariencia · Idioma (V1 activa) · Dominio
// Estructura   → Zonas · Horario
// Suscripción  → Billing
// Gestión      → Miembros · Grupos · Tiers
// ```
//
// Orden visual del array = orden de render del shell (top→bottom). El
// orden está pensado para "cómo el place se ve y se nombra" → "cómo se
// comporta" → "relación owner↔producto" → "administración interna"
// (rationale completo en ADR-0025 §1).
//
// V1: "language", "domain" y "members" son navegables; los 6 restantes son
// `disabled: true` con tooltip "Próximamente" (label vive en
// `labels.comingSoon`, el shell lo aplica). Cuando una sección diferida
// (`zones`/`groups`/`tiers`/`appearance`/`hours`/`billing`) se
// cablee, basta con (a) quitar `disabled: true`, (b) agregar
// `href: "/settings/<key>"`, (c) cablear `activeSection` desde la page —
// el slice ya está estructuralmente listo, paralelo al patrón pre-V1.1.
//
// URL del item "language": `/settings`. El slug del place vive en el
// subdomain (`{slug}.place.community/settings`), no en el path
// (feedback_urls_subdomain). El `<a href>` queda sin slug; el proxy lo
// resuelve. Navegar a "/settings" desde "/settings" es no-op (el item ya
// viene con `aria-current="page"` cuando `activeSection="language"`), pero
// el href bien formado mantiene la semántica HTML correcta para a11y.
//
// URL del item "domain": `/settings/domain` — activado por la feature
// custom-domain V1 (ADR-0026). Mismo patrón de subdomain que "language":
// el slug no va en el path.
//
// URL del item "members": `/settings/members` — activado por la feature
// `members` V1 (Feature E S11). Mismo patrón de subdomain.
//
// Los íconos son componentes Iconoir (`iconoir-react`, ADR-0025 §2) vía los
// wrappers semánticos de `./icons`. Viajan como `ReactNode` dentro del item;
// el shell los renderea dentro de un wrapper con `aria-hidden` y color
// heredado (convención documentada en `icons.tsx`).

export function buildNavPlaceSidebarGroups(
  labels: NavPlaceLabels,
): SidebarGroup[] {
  return [
    {
      label: labels.groupIdentity,
      items: [
        {
          key: "appearance",
          label: labels.sidebarAppearance,
          icon: <AppearanceIcon />,
          disabled: true,
        },
        {
          key: "language",
          label: labels.sidebarLanguage,
          href: "/settings",
          icon: <LanguageIcon />,
        },
        {
          key: "domain",
          label: labels.sidebarDomain,
          href: "/settings/domain",
          icon: <DomainIcon />,
        },
      ],
    },
    {
      label: labels.groupStructure,
      items: [
        {
          key: "zones",
          label: labels.sidebarZones,
          icon: <ZonesIcon />,
          disabled: true,
        },
        {
          key: "hours",
          label: labels.sidebarHours,
          icon: <HoursIcon />,
          disabled: true,
        },
      ],
    },
    {
      label: labels.groupSubscription,
      items: [
        {
          key: "billing",
          label: labels.sidebarBilling,
          icon: <BillingIcon />,
          disabled: true,
        },
      ],
    },
    {
      label: labels.groupManagement,
      items: [
        {
          key: "members",
          label: labels.sidebarMembers,
          href: "/settings/members",
          icon: <MembersIcon />,
        },
        {
          key: "groups",
          label: labels.sidebarGroups,
          icon: <GroupsIcon />,
          disabled: true,
        },
        {
          key: "tiers",
          label: labels.sidebarTiers,
          icon: <TiersIcon />,
          disabled: true,
        },
      ],
    },
  ];
}
