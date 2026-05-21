// SVG inline del slice `nav-hub`. El repo no tiene lib de iconos
// (lucide/heroicons/etc.) — convención es SVG inline con `currentColor` y
// `aria-hidden` para que herede color del texto y no contamine el árbol
// accesible (el aria-label de la action vive en el botón padre, no en el
// ícono).
//
// V1 nav-hub: 3 íconos del sidebar (places/messages/activity). Los íconos
// del frame agnóstico (menu/close/logout del drawer + account menu) viven
// en `src/shared/ui/app-shell/icons.tsx` — el shell los maneja sin
// conocimiento del dominio (ADR-0023). Si crece la familia (e.g., admin),
// considerar `lucide-react`; no antes — 3 íconos chicos no justifican
// dependencia externa.

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

export function PlacesIcon(props: SVGProps<SVGSVGElement>) {
  // grid 2x2 — "tus lugares"
  return (
    <svg {...COMMON_PROPS} {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

export function MessagesIcon(props: SVGProps<SVGSVGElement>) {
  // chat bubble — "mensajes"
  return (
    <svg {...COMMON_PROPS} {...props}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function ActivityIcon(props: SVGProps<SVGSVGElement>) {
  // pulse — "actividad"
  return (
    <svg {...COMMON_PROPS} {...props}>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}
