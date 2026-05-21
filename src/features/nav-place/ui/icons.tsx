import type { SVGProps } from "react";
import {
  Clock,
  ColorPicker,
  CreditCard,
  Crown,
  Group,
  Internet,
  Language,
  MultiplePages,
  ViewGrid,
} from "iconoir-react";

// SoT de iconografía del slice `nav-place` (zona settings) — V1.1, ADR-0025.
// Wraps semánticos sobre componentes de `iconoir-react` (librería canónica
// del producto, ADR-0025 §2). Cada función mapea un concepto del dominio
// (Idioma, Apariencia, Zonas, etc.) al icon component de Iconoir elegido.
// Per-icon imports → tree-shake automático: sólo los 9 iconos del sidebar
// V1.1 entran al bundle del cliente.
//
// Patrón "semantic wrapper" en lugar de re-exports directos:
// - Permite ajustar tamaño/strokeWidth uniformemente sin tocar `nav-place-
//   items.tsx` (9 callsites).
// - Si en futuro el ADR cambia un icono (e.g. Tiers Crown → Medal), se
//   reasigna acá una sola línea sin propagar.
// - Acopla los SVGProps de iconoir al type estándar del DOM — los tests del
//   slice y del shell tratan los iconos como SVG comunes (`querySelector
//   "svg"`).
//
// Sustituciones documentadas vs ADR-0025 §1 (alternativas disponibles en
// iconoir-react@7.11):
// - Apariencia → `ColorPicker` (alt: `DesignNib`; elegido por semántica
//   directa "color/paleta").
// - Idioma → `Language` (alt: `Translate`).
// - Dominio → `Internet` (alt original `World` NO existe en la librería).
// - Zonas → `ViewGrid` (alt original `Apps` NO existe; ViewGrid = 2×2 cells
//   = secciones del place).
// - Horario → `Clock` (único candidato).
// - Billing → `CreditCard` (alt: `Wallet`).
// - Miembros → `Group` (dos personas).
// - Grupos → `MultiplePages` (alt `Stack` NO existe; ADR primary).
// - Tiers → `Crown` (alts `Layers` NO existe, `Star` es "favoritos" =
//   mismatch semántico; `Crown` comunica "tier premium/monetización"
//   alineado con ADR-0003).
//
// Los iconos del frame agnóstico (menu/close/logout del drawer + account
// menu) viven en `src/shared/ui/app-shell/icons.tsx` (ADR-0023). El shell
// los maneja sin conocimiento del dominio.

const ICON_SIZE = { width: 20, height: 20 } as const;

type IconProps = SVGProps<SVGSVGElement>;

export function LanguageIcon(props: IconProps) {
  return <Language {...ICON_SIZE} {...props} />;
}

export function MembersIcon(props: IconProps) {
  return <Group {...ICON_SIZE} {...props} />;
}

export function AppearanceIcon(props: IconProps) {
  return <ColorPicker {...ICON_SIZE} {...props} />;
}

export function HoursIcon(props: IconProps) {
  return <Clock {...ICON_SIZE} {...props} />;
}

export function BillingIcon(props: IconProps) {
  return <CreditCard {...ICON_SIZE} {...props} />;
}

export function DomainIcon(props: IconProps) {
  return <Internet {...ICON_SIZE} {...props} />;
}

export function ZonesIcon(props: IconProps) {
  return <ViewGrid {...ICON_SIZE} {...props} />;
}

export function GroupsIcon(props: IconProps) {
  return <MultiplePages {...ICON_SIZE} {...props} />;
}

export function TiersIcon(props: IconProps) {
  return <Crown {...ICON_SIZE} {...props} />;
}
