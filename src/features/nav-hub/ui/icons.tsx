// SVG inline del slice `nav-hub` (S3 del Hub V1). El repo no tiene lib de
// iconos (lucide/heroicons/etc.) — convención es SVG inline con `currentColor`
// y `aria-hidden` para que herede color del texto y no contamine el árbol
// accesible (el aria-label de la action vive en el botón padre, no en el ícono).
//
// 6 íconos para V1: 3 del sidebar + 2 del drawer/topbar + 1 del logout. Si
// crece la familia, considerar instalar `lucide-react` (no antes — 6 íconos
// chicos no justifican dependencia externa).

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

export function MenuIcon(props: SVGProps<SVGSVGElement>) {
  // hamburger — abrir drawer en mobile
  return (
    <svg {...COMMON_PROPS} {...props}>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

export function CloseIcon(props: SVGProps<SVGSVGElement>) {
  // X — cerrar drawer
  return (
    <svg {...COMMON_PROPS} {...props}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function LogoutIcon(props: SVGProps<SVGSVGElement>) {
  // door + arrow — cerrar sesión
  return (
    <svg {...COMMON_PROPS} {...props}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
