// SVG inline del slice `nav-hub`. Por ADR-0025, la librería canónica de
// íconos del repo es `iconoir-react`. Los 3 íconos de este archivo
// (places/messages/activity) se conservan inline en V1 del Hub porque:
// (a) ya están escritos y testeados, (b) son los únicos del slice y
// migrarlos no agrega valor inmediato, (c) la migración a Iconoir queda
// como deuda menor cuando se redibuje el Hub o aparezca un cuarto ícono.
// Para slices nuevos (nav-place, settings, futuras zonas) se usa
// `iconoir-react` desde día uno.
//
// Convención: SVG inline con `currentColor` y `aria-hidden` para que herede
// color del texto y no contamine el árbol accesible (el aria-label de la
// action vive en el botón padre, no en el ícono).
//
// Los íconos del frame agnóstico (menu/close/logout del drawer + account
// menu) viven en `src/shared/ui/app-shell/icons.tsx` — el shell los maneja
// sin conocimiento del dominio (ADR-0023).

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
