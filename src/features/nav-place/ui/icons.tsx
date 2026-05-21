// SVG inline del slice `nav-place` (zona settings). El repo no tiene lib
// de iconos (lucide/heroicons/etc.) — convención es SVG inline con
// `currentColor` y `aria-hidden` para que herede color del texto y no
// contamine el árbol accesible (el aria-label de la action vive en el
// botón padre, no en el ícono). Paralelo arquitectónico a
// `nav-hub/ui/icons.tsx`.
//
// V1 settings: 6 íconos del sidebar — uno por sección
// (language/members/appearance/hours/billing/domain). Sólo "language" es
// navegable; el resto están `disabled: true` (ver `nav-place-items.tsx`).
// Los íconos del frame agnóstico (menu/close/logout del drawer + account
// menu) viven en `src/shared/ui/app-shell/icons.tsx` — el shell los maneja
// sin conocimiento del dominio (ADR-0023). Si crece la familia (e.g.,
// billing tiene sub-secciones con íconos propios), considerar
// `lucide-react`; no antes — 6 íconos chicos no justifican dep externa.

import type { SVGProps } from "react";

const COMMON_PROPS: SVGProps<SVGSVGElement> = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

export function LanguageIcon(props: SVGProps<SVGSVGElement>) {
  // globe con meridianos — "idioma del place"
  return (
    <svg {...COMMON_PROPS} {...props}>
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

export function MembersIcon(props: SVGProps<SVGSVGElement>) {
  // dos personas — "miembros"
  return (
    <svg {...COMMON_PROPS} {...props}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export function AppearanceIcon(props: SVGProps<SVGSVGElement>) {
  // paleta de pintor — "apariencia"
  return (
    <svg {...COMMON_PROPS} {...props}>
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
    </svg>
  );
}

export function HoursIcon(props: SVGProps<SVGSVGElement>) {
  // reloj — "horario"
  return (
    <svg {...COMMON_PROPS} {...props}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

export function BillingIcon(props: SVGProps<SVGSVGElement>) {
  // tarjeta de crédito — "billing"
  return (
    <svg {...COMMON_PROPS} {...props}>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </svg>
  );
}

export function DomainIcon(props: SVGProps<SVGSVGElement>) {
  // external link — "dominio custom" (diferenciado del globe de language)
  return (
    <svg {...COMMON_PROPS} {...props}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}
