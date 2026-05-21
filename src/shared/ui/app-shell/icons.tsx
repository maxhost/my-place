import type { SVGProps } from "react";

// SVG inline del shell agnóstico (ADR-0023). Los 3 íconos universales del
// frame (hamburger, close, logout) viven inline acá — son tan triviales y
// específicos del shell que no tiene sentido cargar la lib de iconos del
// repo (`iconoir-react`, canónica por ADR-0025) para ellos.
//
// Convención: SVG inline con `currentColor` + `aria-hidden` para que herede
// color del texto y no contamine el árbol accesible. El aria-label vive en
// el botón padre, no en el ícono.
//
// Los íconos del sidebar (Places/Messages/Activity para el Hub;
// Language/Members/etc. para el settings) son dominio del consumer — viajan
// como `icon: ReactNode` en cada `SidebarItem` (ya sea desde `iconoir-react`
// post-ADR-0025 o SVG inline propios). El shell sólo renderea sin conocer
// el origen del ícono.

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

export function MenuIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...COMMON_PROPS} {...props}>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

export function CloseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...COMMON_PROPS} {...props}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function LogoutIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...COMMON_PROPS} {...props}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
