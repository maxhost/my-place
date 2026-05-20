import type { ReactNode } from "react";
import "../../../globals.css";

// Layout de la zona Place (multi-root, Next 16 — `docs/multi-tenancy.md`).
// Creado en S5a del Hub junto al restructure del árbol `(app)` (el layout
// común `(app)/layout.tsx` se eliminó: cada sub-grupo provee su `<html>`
// para soportar `lang` propio). La zona Place es producto en español
// (CLAUDE.md: "la zona app es producto en español") y NO lleva path prefix
// de locale → `lang` fijo. Chrome del place (futuro), NO NavHub del Hub
// (spec §G5 del Hub: topbar/sidebar viven sólo en la zona Hub).
export default function PlaceLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body className="antialiased">{children}</body>
    </html>
  );
}
